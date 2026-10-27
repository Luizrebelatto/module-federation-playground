import type { ComponentType } from 'react';
import { loadRemote, registerRemotes } from '@module-federation/enhanced/runtime';
import type { TodoRemoteProps } from '@todo-mf/todo-contract';

import type { ResolvedRemote } from '../release/manifest';
import { RemoteLoadError } from './RemoteLoadError';

const LOAD_TIMEOUT_MS = 10_000;

type TodoScreenComponent = ComponentType<TodoRemoteProps>;

// Pedidos simultâneos para o mesmo release compartilham a mesma Promise.
const inFlight = new Map<string, Promise<TodoScreenComponent>>();
// container -> entry registrado no runtime MF.
const registered = new Map<string, string>();

function loadOnce(key: string, load: () => Promise<TodoScreenComponent>) {
  const existing = inFlight.get(key);
  if (existing) return existing;
  const promise = load().catch((error) => {
    inFlight.delete(key); // permite retry posterior
    throw error;
  });
  inFlight.set(key, promise);
  return promise;
}

function withTimeout<T>(promise: Promise<T>, ms: number, releaseId: string) {
  let timer: ReturnType<typeof setTimeout>;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => reject(new RemoteLoadError('timeout', `Remote ${releaseId} took more than ${ms}ms`)),
      ms,
    );
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

function register(release: ResolvedRemote) {
  const current = registered.get(release.container);
  if (current === release.entry) return;
  // `force` troca o entry de um container já registrado (ex.: rollback no manifesto).
  registerRemotes([{ name: release.container, entry: release.entry }], { force: current !== undefined });
  registered.set(release.container, release.entry);
}

async function importTodoScreen(release: ResolvedRemote): Promise<TodoScreenComponent> {
  register(release);
  let mod: { default?: TodoScreenComponent } | null;
  try {
    mod = await withTimeout(
      loadRemote<{ default?: TodoScreenComponent }>(`${release.container}/TodoScreen`),
      LOAD_TIMEOUT_MS,
      release.releaseId,
    );
  } catch (error) {
    if (error instanceof RemoteLoadError) throw error;
    throw new RemoteLoadError('load', `Failed to load ${release.releaseId}`, { cause: error });
  }
  if (!mod?.default) {
    throw new RemoteLoadError('load', `${release.releaseId} does not expose a default TodoScreen`);
  }
  return mod.default;
}

export function loadTodoScreen(release: ResolvedRemote): Promise<TodoScreenComponent> {
  return loadOnce(`${release.container}@${release.releaseId}`, () => importTodoScreen(release));
}
