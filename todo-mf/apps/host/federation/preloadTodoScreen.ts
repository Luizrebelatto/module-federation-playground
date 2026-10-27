import { assertCompatible } from '../release/compatibility';
import { loadReleaseManifest, resolveRemote } from '../release/manifest';
import { loadTodoScreen } from './loadTodoScreen';

/** Esquenta o cache do loader. Erros são ignorados aqui: a TodoScreen trata e reporta. */
export async function preloadTodoScreen() {
  try {
    const release = resolveRemote(await loadReleaseManifest(), 'todo');
    assertCompatible(release);
    await loadTodoScreen(release);
  } catch {
    // a tela federada vai cair no fallback e registrar a telemetria
  }
}
