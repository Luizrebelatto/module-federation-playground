# Host — step-by-step implementation guide

This guide takes `apps/host` from the Expo template to the host described in the [root README](../../README.md):

> **Host**: Expo/React Native app that initializes runtime and navigation, reads the release configuration, and contains a local Todo screen that serves as a fallback.

Each step says **what to do**, **why it matters**, and **how to verify**. The order is deliberate: first the app works 100% locally (no network, no remote); only then does Module Federation come in. That way, when something breaks, you know whether the problem is in the app or in the federation.

## How it all fits together

```text
App.tsx
 └─ TodoStoreProvider (Zustand store created once in the host, exposed as TodoStore)
     └─ NavigationContainer
         ├─ Home
         ├─ LocalTodo ──────────────► LocalTodoScreen (embedded)
         └─ Todo
             └─ RemoteErrorBoundary ─ error? ─► LocalTodoScreen + notice + retry
                 └─ Suspense ─ loading? ─► spinner
                     └─ lazy(() =>
                          1. loadReleaseManifest()   reads release/manifest.*.json
                          2. resolveRemote()         picks the platform entry
                          3. assertCompatible()      versions match the host?
                          4. loadTodoScreen()        registerRemotes + loadRemote (MF runtime)
                        )
```

## Final structure

```text
todo-mf/
  packages/todo-contract/          # Step 1
    package.json
    src/index.ts
  release/
    manifest.dev.json              # Step 6
  apps/host/
    App.tsx                        # Step 4
    rspack.config.mjs              # Steps 1 and 5
    tsconfig.json                  # Step 1
    src/
      store/todoStore.ts           # Step 2 (Zustand + adapter)
      store/TodoStoreContext.tsx   # Step 2
      screens/LocalTodoScreen.tsx  # Step 3
      screens/HomeScreen.tsx       # Step 4
      navigation/AppNavigation.tsx # Step 4
      release/manifest.ts          # Step 6
      release/compatibility.ts     # Step 7
      federation/RemoteLoadError.ts# Step 6
      federation/loadTodoScreen.ts # Step 8
      federation/telemetry.ts      # Step 9
      federation/RemoteErrorBoundary.tsx # Step 9
      screens/TodoScreen.tsx       # Step 9
```

---

## Step 0 — Run with Re.Pack, not Metro

**What to do.** Today `package.json` has `"start": "expo start"`, and that brings up **Metro**. `rspack.config.mjs` is only used when the bundler is Re.Pack. Adjust the scripts like in `mf-runtime/host-app`, which already works:

```json
"scripts": {
  "start": "react-native start",
  "ios": "expo run:ios --no-bundler",
  "android": "expo run:android --no-bundler"
}
```

**Why it matters.** `react-native start` uses the Re.Pack commands registered in `react-native.config.js`. `--no-bundler` prevents `expo run` from opening a Metro on the same port 8081. Without it, nothing you configure in Rspack (alias, Module Federation) makes it into the bundle.

**How to verify.** In one terminal, run `npm start`. In another, run `npm run ios`. The server log must show Rspack/Re.Pack, not Metro.

---

## Step 1 — Shared contract (`packages/todo-contract`)

**What to do.** Create the package with the types that host and remote will use:

```json
// packages/todo-contract/package.json
{
  "name": "@todo-mf/todo-contract",
  "version": "1.0.0",
  "private": true,
  "main": "src/index.ts",
  "types": "src/index.ts"
}
```

```ts
// packages/todo-contract/src/index.ts
/**
 * Stable contract between host and the `todo` remote.
 * An incompatible change here = a new major of CONTRACT_VERSION.
 */
export const CONTRACT_VERSION = '1.0.0';

export type Todo = { id: string; title: string; completed: boolean };

export interface TodoStore {
  getSnapshot(): readonly Todo[];
  subscribe(listener: () => void): () => void;
  add(title: string): Promise<void>;
  toggle(id: string): Promise<void>;
  remove(id: string): Promise<void>;
}

export type TodoRemoteProps = { store: TodoStore; releaseId: string };
```

For the host to see the package without configuring workspaces, use an alias in the bundler and in `paths` in TypeScript:

```js
// apps/host/rspack.config.mjs
resolve: {
  ...Repack.getResolveOptions({ enablePackageExports: true }),
  alias: {
    '@todo-mf/todo-contract': path.resolve(__dirname, '../../packages/todo-contract/src'),
  },
},
```

```json
// apps/host/tsconfig.json
{
  "extends": "expo/tsconfig.base",
  "compilerOptions": {
    "strict": true,
    "paths": {
      "@todo-mf/todo-contract": ["../../packages/todo-contract/src"]
    }
  }
}
```

**Why it matters.**
- The contract is the **only thing** host and remote need to have in common about the Todo. The remote does not know the real store, only the interface.
- `CONTRACT_VERSION` exists at runtime, not just in the types. It is what Step 7 compares to reject a remote built for a different contract. TypeScript types vanish at build time and protect nothing in production.
- `TodoRemoteProps` defines that the store **arrives by prop**. This way there are not two React Contexts (one from the host, one from the remote) crossing the federated boundary.

**How to verify.** Run `npx tsc --noEmit` in `apps/host`. An `import type { Todo } from '@todo-mf/todo-contract'` in any file must resolve without error.

---

## Step 2 — Todo store with Zustand and serialized writes

**What to do.**

```bash
cd apps/host
npx expo install zustand
```

```ts
// apps/host/src/store/todoStore.ts
import { createStore } from 'zustand/vanilla';
import type { Todo, TodoStore } from '@todo-mf/todo-contract';

let nextId = 0;
const createId = () => `${Date.now().toString(36)}-${(nextId++).toString(36)}`;

type TodoState = {
  todos: readonly Todo[];
  add: (title: string) => Promise<void>;
  toggle: (id: string) => Promise<void>;
  remove: (id: string) => Promise<void>;
};

const createTodoState = (initial: readonly Todo[]) =>
  createStore<TodoState>()((set) => {
    let queue: Promise<void> = Promise.resolve();

    const mutate = (update: (current: readonly Todo[]) => readonly Todo[]) => {
      const run = queue.then(() => {
        set((state) => {
          const next = update(state.todos);
          // Returning the same state makes Zustand notify no one.
          return next === state.todos ? state : { todos: next };
        });
      });
      // A failed mutation must not block the following ones.
      queue = run.catch(() => undefined);
      return run;
    };

    return {
      todos: initial,
      add: (title) =>
        mutate((current) => [...current, { id: createId(), title, completed: false }]),
      toggle: (id) =>
        mutate((current) =>
          current.map((todo) => (todo.id === id ? { ...todo, completed: !todo.completed } : todo)),
        ),
      remove: (id) => mutate((current) => current.filter((todo) => todo.id !== id)),
    };
  });

// Adapter: Zustand is a host implementation detail; only the contract leaves the boundary.
export function createTodoStore(initial: readonly Todo[] = []): TodoStore {
  const state = createTodoState(initial);
  const { add, toggle, remove } = state.getState();

  return {
    getSnapshot: () => state.getState().todos,
    subscribe: (listener) => state.subscribe(() => listener()),
    add,
    toggle,
    remove,
  };
}
```

```tsx
// apps/host/src/store/TodoStoreContext.tsx
import { createContext, useContext, useSyncExternalStore, type ReactNode } from 'react';
import type { TodoStore } from '@todo-mf/todo-contract';

// Host-only context. The remote does not use this context: it receives the store by prop.
const TodoStoreContext = createContext<TodoStore | null>(null);

export function TodoStoreProvider({ store, children }: { store: TodoStore; children: ReactNode }) {
  return <TodoStoreContext.Provider value={store}>{children}</TodoStoreContext.Provider>;
}

export function useTodoStore(): TodoStore {
  const store = useContext(TodoStoreContext);
  if (!store) throw new Error('useTodoStore must be used inside <TodoStoreProvider>');
  return store;
}

export function useTodos(store: TodoStore) {
  return useSyncExternalStore(store.subscribe, store.getSnapshot);
}
```

**Why it matters.**
- **Zustand (`zustand/vanilla`)** holds the state and notifies subscribers. We use the *vanilla* `createStore` (no hook) because the store lives outside React and is created once in `App.tsx` (Step 4).
- **Adapter to the contract**: `createTodoStore` returns a `TodoStore` (Step 1), not the Zustand store. This way Zustand does not enter the contract: the remote does not import `zustand`, it does not need to go into Module Federation's `shared`, and a major upgrade (or swapping Zustand for another lib) does not require host and remote to be in sync. The state lib stays hidden behind the boundary.
- **Store outside React** (`getSnapshot` and `subscribe`): the host passes the same object to the local screen and to the remote, and both see the same state. Adding an item in the remote shows up on the local screen, and vice versa.
- **`useSyncExternalStore`**: this is React's official hook for reading external stores without *tearing*, that is, without parts of the UI showing different versions of the state. It works directly with the adapter: Zustand's `subscribe` already returns the unsubscribe function, and `todos` only changes reference when it actually changes (a requirement of `getSnapshot`).
- **Queue (`queue`)**: Zustand's `set` is synchronous, but Zustand **does not serialize async actions**. Once persistence or an API with `await` comes in, two actions could read the same stale state and one could overwrite the other. With the queue, each write waits for the previous one and reads the most recent `state.todos` inside `set`. With two quick taps on "toggle", or an `add` from the host together with one from the remote, no update is lost.
- **Actions as closures**, not `this`: `store.toggle` can be passed around loose (`onPress={store.toggle}`) without `bind`, including by the remote.
- **The store is created in the host, never in the remote.** The host is what controls concurrency and persistence. When persistence comes in, the natural path is Zustand's `persist` middleware with AsyncStorage. Since AsyncStorage has native code, it must be in the host binary.

**How to verify.** Write a quick test: call `add('a')`, `add('b')`, and `toggle(...)` with no `await` between them and then await the last Promise. The snapshot must contain everything. Also check that `getSnapshot()` returns the **same** reference across two consecutive calls with no mutation in between.

---

## Step 3 — Local Todo screen (the fallback)

**What to do.**

```tsx
// apps/host/src/screens/LocalTodoScreen.tsx
import { useState, type ReactNode } from 'react';
import { FlatList, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import type { TodoStore } from '@todo-mf/todo-contract';

import { useTodos } from '../store/TodoStoreContext';

type Props = {
  store: TodoStore;
  /** Optional content at the top (e.g. a notice that the remote fell back). */
  banner?: ReactNode;
};

export function LocalTodoScreen({ store, banner }: Props) {
  const todos = useTodos(store);
  const [title, setTitle] = useState('');

  const submit = () => {
    const trimmed = title.trim();
    if (!trimmed) return;
    setTitle('');
    void store.add(trimmed);
  };

  return (
    <View style={styles.container}>
      {banner}
      <View style={styles.form}>
        <TextInput
          style={styles.input}
          placeholder="New task"
          value={title}
          onChangeText={setTitle}
          onSubmitEditing={submit}
          returnKeyType="done"
        />
        <Pressable style={styles.addButton} onPress={submit} accessibilityRole="button">
          <Text style={styles.addButtonText}>Add</Text>
        </Pressable>
      </View>
      <FlatList
        data={todos}
        keyExtractor={(todo) => todo.id}
        ListEmptyComponent={<Text style={styles.empty}>No tasks yet.</Text>}
        renderItem={({ item }) => (
          <View style={styles.row}>
            <Pressable
              style={styles.rowTitle}
              onPress={() => void store.toggle(item.id)}
              accessibilityRole="checkbox"
              accessibilityState={{ checked: item.completed }}
            >
              <Text style={[styles.title, item.completed && styles.completed]}>
                {item.completed ? '☑' : '☐'} {item.title}
              </Text>
            </Pressable>
            <Pressable onPress={() => void store.remove(item.id)} accessibilityRole="button" hitSlop={8}>
              <Text style={styles.remove}>Remove</Text>
            </Pressable>
          </View>
        )}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#fff' },
  form: { flexDirection: 'row', gap: 8, padding: 16 },
  input: { flex: 1, borderWidth: 1, borderColor: '#ccc', borderRadius: 8, paddingHorizontal: 12, paddingVertical: 8 },
  addButton: { backgroundColor: '#1f6feb', borderRadius: 8, paddingHorizontal: 16, justifyContent: 'center' },
  addButtonText: { color: '#fff', fontWeight: '600' },
  empty: { textAlign: 'center', color: '#888', marginTop: 32 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#ddd',
  },
  rowTitle: { flex: 1 },
  title: { fontSize: 16 },
  completed: { textDecorationLine: 'line-through', color: '#888' },
  remove: { color: '#d1242f' },
});
```

**Why it matters.**
- It is the **product guarantee**: with the remote down, a broken manifest, or an incompatible version, the user can still use the Todo.
- It receives `store` by prop, just like the remote (`TodoRemoteProps`). This way the local screen and the remote one are interchangeable, and state is preserved when one replaces the other.
- The `banner` prop exists for Step 9, which warns "you are on the local version" without creating a second screen.

**How to verify.** Temporarily render `<LocalTodoScreen store={createTodoStore()} />` in `App.tsx` and test the CRUD **in airplane mode**.

---

## Step 4 — Navigation

**What to do.** Install React Navigation with the native stack:

```bash
cd apps/host
npx expo install @react-navigation/native @react-navigation/native-stack react-native-screens react-native-safe-area-context
npm run ios   # mandatory native rebuild (react-native-screens and safe-area have native code)
```

```tsx
// apps/host/src/screens/HomeScreen.tsx
import { Button, StyleSheet, View } from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';

import type { RootStackParamList } from '../navigation/AppNavigation';

export function HomeScreen({ navigation }: NativeStackScreenProps<RootStackParamList, 'Home'>) {
  return (
    <View style={styles.container}>
      <Button title="Todo (remote, with fallback)" onPress={() => navigation.navigate('Todo')} />
      <Button title="Local Todo" onPress={() => navigation.navigate('LocalTodo')} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12 },
});
```

```tsx
// apps/host/src/navigation/AppNavigation.tsx
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';

import { HomeScreen } from '../screens/HomeScreen';
import { LocalTodoRoute } from '../screens/LocalTodoRoute';
import { TodoScreen } from '../screens/TodoScreen';

export type RootStackParamList = {
  Home: undefined;
  Todo: undefined;
  LocalTodo: undefined;
};

const Stack = createNativeStackNavigator<RootStackParamList>();

export function AppNavigation() {
  return (
    <NavigationContainer>
      <Stack.Navigator>
        <Stack.Screen name="Home" component={HomeScreen} options={{ title: 'Host' }} />
        <Stack.Screen name="Todo" component={TodoScreen} options={{ title: 'Todo' }} />
        <Stack.Screen name="LocalTodo" component={LocalTodoRoute} options={{ title: 'Local Todo' }} />
      </Stack.Navigator>
    </NavigationContainer>
  );
}
```

```tsx
// apps/host/src/screens/LocalTodoRoute.tsx — route that wires the local screen to the context store
import { useTodoStore } from '../store/TodoStoreContext';
import { LocalTodoScreen } from './LocalTodoScreen';

export function LocalTodoRoute() {
  return <LocalTodoScreen store={useTodoStore()} />;
}
```

```tsx
// apps/host/App.tsx
import { StatusBar } from 'expo-status-bar';

import { AppNavigation } from './src/navigation/AppNavigation';
import { createTodoStore } from './src/store/todoStore';
import { TodoStoreProvider } from './src/store/TodoStoreContext';

// Created once, outside the component: survives re-renders and is the same for host and remote.
const todoStore = createTodoStore();

export default function App() {
  return (
    <TodoStoreProvider store={todoStore}>
      <AppNavigation />
      <StatusBar style="auto" />
    </TodoStoreProvider>
  );
}
```

> Until Step 9 is ready, make the `Todo` route point to `LocalTodoRoute`.

**Why it matters.**
- Navigation belongs to the **host**. The remote becomes just one screen inside it, with no `NavigationContainer` of its own and no second root tree. If the remote breaks, Home and the other routes keep working (**fault isolation**).
- Having a separate `LocalTodo` route helps to test and compare: the two screens share the store.
- **Why React Navigation and not Expo Router?** `AGENTS.md` suggests Expo Router, but it depends on Metro features (file-based route discovery via Metro's transform/config). Since this host uses Re.Pack instead of Metro, React Navigation is the option with no extra integration. Expo Router also uses React Navigation underneath.
- **Why rebuild?** `react-native-screens` and `react-native-safe-area-context` have native code. Remember limit 1 from the root README: a remote can **never** bring in a native dependency that the host binary does not have.

**How to verify.** The app opens on Home, you navigate to both routes, and the state is the same in both.

---

## Step 5 — Initialize the Module Federation runtime

**What to do.**

```bash
cd apps/host
npm install @module-federation/enhanced@2.9.2   # same version as mf-runtime/host-app
```

```js
// apps/host/rspack.config.mjs  (inside plugins)
plugins: [
  new Repack.RepackPlugin(),
  new ExpoModulesPlugin(),
  new Repack.plugins.ModuleFederationPluginV2({
    name: 'host',
    shared: {
      react: { singleton: true, eager: true, requiredVersion: '19.2.3' },
      'react-native': { singleton: true, eager: true, requiredVersion: '0.86.3' },
    },
  }),
],
```

**Why it matters.**
- `ModuleFederationPluginV2` injects the **MF runtime** into the host bundle: the code that knows how to register remotes, download the container, and negotiate shared dependencies. It also adds Re.Pack's runtime plugins (`core-plugin` and `resolver-plugin`), which route the download through `ScriptManager`, Re.Pack's native script loader.
- Re.Pack **requires** `@module-federation/enhanced` to be installed: the plugin throws an error if it cannot find the package. It also provides `@module-federation/enhanced/runtime`, used in Step 8.
- **`shared` with `singleton: true`**: there can be only **one** copy of React and of React Native in the process. Two copies of React = broken hooks ("Invalid hook call").
- **`eager: true`** in the host: React/RN go into the main bundle, because the host needs them before any remote exists.
- **Exact `requiredVersion`**: the remote must use exactly these versions. `singleton` avoids duplication, but it does not make different versions compatible.
- **`zustand` stays out of `shared`, on purpose.** It is an internal host detail (Step 2); the remote only knows the `TodoStore` contract. It would only come in here as a singleton if the remote started importing Zustand.
- **No `remotes` here, on purpose.** In `mf-runtime` the remote is fixed in the config (`products@dynamic`). Here the URL comes from the **release manifest** (Step 6). That is why you can change the version or roll back without rebuilding the host.

**How to verify.** `npm start` compiles without error and the app opens just like in Step 4. Nothing changes visually: the runtime is there, it is just not used yet.

---

## Step 6 — Release manifest and reading it

**What to do.** Create the manifest at the root of the monorepo:

```json
// release/manifest.dev.json
{
  "schema": 1,
  "channel": "dev",
  "remotes": {
    "todo": {
      "enabled": true,
      "container": "todo_remote",
      "releaseId": "todo-dev-local",
      "entries": {
        "ios": "http://localhost:9000/ios/todo_remote.container.js.bundle",
        "android": "http://10.0.2.2:9000/android/todo_remote.container.js.bundle"
      },
      "compatibility": {
        "runtimeApi": 1,
        "contract": "1.0.0",
        "react": "19.2.3",
        "reactNative": "0.86.3",
        "minHostVersion": "1.0.0",
        "maxHostVersionExclusive": "2.0.0"
      }
    }
  }
}
```

> ⚠️ The exact `entry` path (`/ios/todo_remote.container.js.bundle`) can only be confirmed once the `todo-remote` exists: it depends on the `filename` and on how Re.Pack's dev server serves the container. Adjust it here, because it is the only place that needs to change.

An error type carrying the **phase** of the failure, used by everything else:

```ts
// apps/host/src/federation/RemoteLoadError.ts
export type RemotePhase = 'manifest' | 'compatibility' | 'load' | 'timeout' | 'render';

export class RemoteLoadError extends Error {
  constructor(
    readonly phase: RemotePhase,
    message: string,
    options?: { cause?: unknown },
  ) {
    super(message, options);
    this.name = 'RemoteLoadError';
  }

  /** Manifest and compatibility do not change on a retry; download/timeout can. */
  get retryable() {
    return this.phase !== 'manifest' && this.phase !== 'compatibility';
  }
}

export function phaseOf(error: unknown): RemotePhase {
  return error instanceof RemoteLoadError ? error.phase : 'render';
}
```

The manifest reader:

```ts
// apps/host/src/release/manifest.ts
import { Platform } from 'react-native';

import embeddedManifest from '../../../../release/manifest.dev.json';
import { RemoteLoadError } from '../federation/RemoteLoadError';

export type RemoteCompatibility = {
  runtimeApi: number;
  contract: string;
  react: string;
  reactNative: string;
  minHostVersion: string;
  maxHostVersionExclusive: string;
};

export type RemoteRelease = {
  enabled: boolean;
  container: string;
  releaseId: string;
  entries: Partial<Record<'ios' | 'android', string>>;
  compatibility: RemoteCompatibility;
};

export type ReleaseManifest = {
  schema: 1;
  channel: string;
  remotes: Record<string, RemoteRelease>;
};

/** Release already resolved for the current platform: this is what the loader consumes. */
export type ResolvedRemote = Omit<RemoteRelease, 'entries'> & { name: string; entry: string };

// Published manifest URL (CDN). `null` = use only the manifest embedded in the binary.
const MANIFEST_URL: string | null = null;
const MANIFEST_TIMEOUT_MS = 3000;

const isString = (value: unknown): value is string => typeof value === 'string';

function isRemoteRelease(value: unknown): value is RemoteRelease {
  if (typeof value !== 'object' || value === null) return false;
  const release = value as Record<string, any>;
  const compat = release.compatibility;
  return (
    typeof release.enabled === 'boolean' &&
    isString(release.container) &&
    isString(release.releaseId) &&
    typeof release.entries === 'object' &&
    release.entries !== null &&
    typeof compat === 'object' &&
    compat !== null &&
    typeof compat.runtimeApi === 'number' &&
    [compat.contract, compat.react, compat.reactNative, compat.minHostVersion, compat.maxHostVersionExclusive].every(isString)
  );
}

export function parseManifest(value: unknown): ReleaseManifest {
  const manifest = value as Partial<ReleaseManifest> | null;
  if (
    !manifest ||
    manifest.schema !== 1 ||
    !isString(manifest.channel) ||
    typeof manifest.remotes !== 'object' ||
    manifest.remotes === null ||
    !Object.values(manifest.remotes).every(isRemoteRelease)
  ) {
    throw new RemoteLoadError('manifest', 'Release manifest has an invalid schema');
  }
  return manifest as ReleaseManifest;
}

async function fetchManifest(url: string): Promise<ReleaseManifest> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), MANIFEST_TIMEOUT_MS);
  try {
    const response = await fetch(url, { signal: controller.signal });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return parseManifest(await response.json());
  } finally {
    clearTimeout(timer);
  }
}

let manifestPromise: Promise<ReleaseManifest> | null = null;

/** Reads the release configuration once per session. */
export function loadReleaseManifest(): Promise<ReleaseManifest> {
  manifestPromise ??= (async () => {
    if (MANIFEST_URL) {
      try {
        return await fetchManifest(MANIFEST_URL);
      } catch (error) {
        console.warn('[release] remote manifest unavailable, using embedded one', error);
      }
    }
    return parseManifest(embeddedManifest);
  })();
  return manifestPromise;
}

export function resolveRemote(manifest: ReleaseManifest, name: string): ResolvedRemote {
  const release = manifest.remotes[name];
  if (!release) throw new RemoteLoadError('manifest', `Remote "${name}" is not in the manifest`);
  if (!release.enabled) throw new RemoteLoadError('manifest', `Remote "${name}" is disabled`);

  const entry = release.entries[Platform.OS as 'ios' | 'android'];
  if (!entry) throw new RemoteLoadError('manifest', `Remote "${name}" has no entry for ${Platform.OS}`);

  const { entries: _entries, ...rest } = release;
  return { ...rest, name, entry };
}
```

**Why it matters.**
- The manifest is the **pointer** "which version of the remote this app should use". Changing the pointer performs a deploy or **rollback** without going through the app stores. The remote's artifacts are immutable, and all that changes is where the manifest points.
- **`entries` per platform**: the iOS bundle and the Android bundle are different artifacts (limit 4 from the root README).
- **`enabled`**: a *kill switch*. With `false`, everyone falls back to the local screen immediately.
- **`compatibility`**: the metadata that Step 7 compares against the host.
- **Embedded manifest + optional remote**: today `MANIFEST_URL = null` and only the JSON embedded in the binary is used. In the CDN step you fill in the URL. If the remote manifest fails (network, 3s timeout, invalid schema), the host **falls back to the embedded one** instead of breaking.
- **Schema validation**: a malformed JSON coming from the network must not become the URL of an executable script.
- **Memoized** (`manifestPromise`): it is read once per session, even if several screens ask for it.

**How to verify.** Log `await loadReleaseManifest()` and `resolveRemote(..., 'todo')`. Change `enabled` to `false` and check that `resolveRemote` throws `RemoteLoadError` with `phase: 'manifest'`.

---

## Step 7 — Compatibility check

**What to do.**

```ts
// apps/host/src/release/compatibility.ts
import { version as reactVersion } from 'react';
import { Platform } from 'react-native';
import { CONTRACT_VERSION } from '@todo-mf/todo-contract';

import appConfig from '../../app.json';
import { RemoteLoadError } from '../federation/RemoteLoadError';
import type { ResolvedRemote } from './manifest';

/** Runtime API version that this host binary offers to remotes. */
export const HOST_RUNTIME_API = 1;

const { major, minor, patch } = Platform.constants.reactNativeVersion;

export const hostInfo = {
  version: appConfig.expo.version,
  runtimeApi: HOST_RUNTIME_API,
  contract: CONTRACT_VERSION,
  react: reactVersion,
  reactNative: `${major}.${minor}.${patch}`,
};

function compareVersions(a: string, b: string) {
  const pa = a.split('.').map(Number);
  const pb = b.split('.').map(Number);
  for (let i = 0; i < 3; i++) {
    const diff = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

const majorOf = (version: string) => version.split('.')[0];

export function assertCompatible(remote: ResolvedRemote, host = hostInfo) {
  const c = remote.compatibility;
  const problems: string[] = [];

  if (c.runtimeApi !== host.runtimeApi) problems.push(`runtimeApi ${c.runtimeApi} != ${host.runtimeApi}`);
  if (majorOf(c.contract) !== majorOf(host.contract)) problems.push(`contract ${c.contract} vs ${host.contract}`);
  if (c.react !== host.react) problems.push(`react ${c.react} != ${host.react}`);
  if (c.reactNative !== host.reactNative) problems.push(`react-native ${c.reactNative} != ${host.reactNative}`);
  if (compareVersions(host.version, c.minHostVersion) < 0) problems.push(`host ${host.version} < ${c.minHostVersion}`);
  if (compareVersions(host.version, c.maxHostVersionExclusive) >= 0)
    problems.push(`host ${host.version} >= ${c.maxHostVersionExclusive}`);

  if (problems.length > 0) {
    throw new RemoteLoadError('compatibility', `Remote ${remote.releaseId} incompatible: ${problems.join('; ')}`);
  }
}
```

**Why it matters.**
- It rejects the remote **before downloading and running** the code. An incompatible remote that gets to run can break in ways that are hard to diagnose, such as invalid hooks, missing props, or a nonexistent native module.
- Each rule covers a different risk:
  - `react` / `reactNative` **exact**: the remote was compiled against the same JS and native runtime.
  - `contract` (same **major**): the remote expects the same shape of `TodoStore`/`TodoRemoteProps`. Minor and patch are compatible by definition.
  - `runtimeApi`: a number you increment when the **binary** changes something the remotes use, such as a native module added or removed.
  - `minHostVersion` / `maxHostVersionExclusive`: the range of app versions (`app.json → expo.version`) the remote was tested against.
- It returns **all** the problems at once in the message, which makes diagnosis via telemetry easier.

**How to verify.** In the manifest, change `"react": "19.0.0"` and check that `assertCompatible` throws an error with `phase: 'compatibility'` and a message explaining why.

---

## Step 8 — Remote loader (Promise cache + timeout)

**What to do.**

```ts
// apps/host/src/federation/loadTodoScreen.ts
import type { ComponentType } from 'react';
import { loadRemote, registerRemotes } from '@module-federation/enhanced/runtime';
import type { TodoRemoteProps } from '@todo-mf/todo-contract';

import type { ResolvedRemote } from '../release/manifest';
import { RemoteLoadError } from './RemoteLoadError';

const LOAD_TIMEOUT_MS = 10_000;

type TodoScreenComponent = ComponentType<TodoRemoteProps>;

// Simultaneous requests for the same release share the same Promise.
const inFlight = new Map<string, Promise<TodoScreenComponent>>();
// container -> entry registered in the MF runtime.
const registered = new Map<string, string>();

function loadOnce(key: string, load: () => Promise<TodoScreenComponent>) {
  const existing = inFlight.get(key);
  if (existing) return existing;
  const promise = load().catch((error) => {
    inFlight.delete(key); // allows a later retry
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
  // `force` swaps the entry of an already-registered container (e.g. rollback in the manifest).
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
```

**Why it matters.**
- **`registerRemotes` at runtime** replaces the fixed `remotes: {...}` in the config. The container and the URL come from the manifest. Re.Pack's `resolver-plugin` listens to this registration and starts resolving that container's scripts from the `entry`.
- **`loadRemote('todo_remote/TodoScreen')`** downloads the container, initializes the share scope (the host's React/RN), and returns the exposed module.
- **`loadOnce` (Promise cache)**: if the preload and the navigation ask for the remote at the same time, there is only **one** load. If the load fails, the Promise leaves the cache, so a retry makes a genuinely new attempt.
- **Timeout**: a bad network must not leave the user staring at a spinner forever. After 10s, the flow falls back. Note: the timeout only **stops waiting**, it does not cancel the download in progress.
- **The `load` phase bundles download and evaluation**: Re.Pack's `core-plugin` catches the download error and only logs `Failed to load remote entry`, so the host cannot tell the two apart. If you need to separate them, you can create your own runtime plugin (the `errorLoadRemote` hook).
- **Checks `mod.default`**: a remote that exports incorrectly is treated as a load failure, not as a render crash.

**How to verify.** Call `loadTodoScreen(release)` twice in a row with no `await` and check that the two Promises are **the same** (`===`). With no remote running, the Promise rejects with `phase: 'load'` (closed port) or `'timeout'`.

---

## Step 9 — Error Boundary, telemetry, and the federated screen

**What to do.** Telemetry:

```ts
// apps/host/src/federation/telemetry.ts
import { Platform } from 'react-native';

import type { RemotePhase } from './RemoteLoadError';

export type RemoteFallbackEvent = {
  remote: string;
  releaseId: string | undefined;
  phase: RemotePhase;
  error: unknown;
};

// Only name + truncated message: never send the content of the user's tasks.
function sanitize(error: unknown) {
  if (error instanceof Error) return { name: error.name, message: error.message.slice(0, 200) };
  return { name: 'UnknownError', message: String(error).slice(0, 200) };
}

/** Single telemetry point; swap the console for Sentry/Datadog/etc. later. */
export function reportRemoteFallback({ remote, releaseId, phase, error }: RemoteFallbackEvent) {
  console.warn('[remote_fallback]', { remote, releaseId, phase, platform: Platform.OS, error: sanitize(error) });
}
```

The boundary:

```tsx
// apps/host/src/federation/RemoteErrorBoundary.tsx
import { Component, type ErrorInfo, type ReactNode } from 'react';

type Props = {
  fallback: (error: unknown) => ReactNode;
  onError: (error: unknown, info: ErrorInfo) => void;
  children: ReactNode;
};

type State = { error: unknown; hasError: boolean };

export class RemoteErrorBoundary extends Component<Props, State> {
  state: State = { error: null, hasError: false };

  static getDerivedStateFromError(error: unknown): State {
    return { error, hasError: true };
  }

  componentDidCatch(error: unknown, info: ErrorInfo) {
    this.props.onError(error, info);
  }

  render() {
    return this.state.hasError ? this.props.fallback(this.state.error) : this.props.children;
  }
}
```

The screen that ties it all together:

```tsx
// apps/host/src/screens/TodoScreen.tsx
import { lazy, Suspense, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Button, StyleSheet, Text, View } from 'react-native';

import { loadTodoScreen } from '../federation/loadTodoScreen';
import { RemoteErrorBoundary } from '../federation/RemoteErrorBoundary';
import { phaseOf, RemoteLoadError } from '../federation/RemoteLoadError';
import { reportRemoteFallback } from '../federation/telemetry';
import { assertCompatible } from '../release/compatibility';
import { loadReleaseManifest, resolveRemote } from '../release/manifest';
import { useTodoStore } from '../store/TodoStoreContext';
import { LocalTodoScreen } from './LocalTodoScreen';

const MAX_RETRIES = 2;

export function TodoScreen() {
  const store = useTodoStore();
  const [attempt, setAttempt] = useState(0);
  const releaseIdRef = useRef<string | undefined>(undefined);

  // React.lazy keeps the result (including the rejection) forever;
  // so we create a new lazy on each attempt.
  const RemoteTodo = useMemo(
    () =>
      lazy(async () => {
        const release = resolveRemote(await loadReleaseManifest(), 'todo');
        releaseIdRef.current = release.releaseId;
        assertCompatible(release);
        const Component = await loadTodoScreen(release);
        return { default: () => <Component store={store} releaseId={release.releaseId} /> };
      }),
    [attempt, store],
  );

  return (
    <RemoteErrorBoundary
      key={attempt} // changing the key remounts the boundary = clears the error
      onError={(error) =>
        reportRemoteFallback({ remote: 'todo', releaseId: releaseIdRef.current, phase: phaseOf(error), error })
      }
      fallback={(error) => {
        const retryable = !(error instanceof RemoteLoadError) || error.retryable;
        const canRetry = retryable && attempt < MAX_RETRIES;
        return (
          <LocalTodoScreen
            store={store}
            banner={
              <View style={styles.banner}>
                <Text style={styles.bannerText}>Local version (remote unavailable)</Text>
                {canRetry && <Button title="Try again" onPress={() => setAttempt((n) => n + 1)} />}
              </View>
            }
          />
        );
      }}
    >
      <Suspense fallback={<ActivityIndicator style={styles.loading} />}>
        <RemoteTodo />
      </Suspense>
    </RemoteErrorBoundary>
  );
}

const styles = StyleSheet.create({
  loading: { flex: 1 },
  banner: { backgroundColor: '#fff8c5', padding: 12, gap: 8 },
  bannerText: { color: '#6b5900' },
});
```

Finally, in `AppNavigation`, point the `Todo` route to this `TodoScreen`.

**Why it matters.**
- **`Suspense`** covers the **wait** (manifest + download) with a spinner.
- **`RemoteErrorBoundary`** covers the **error**: a `lazy` rejection (the manifest, compatibility, load, and timeout phases) **and** an exception during the remote's rendering (the render phase). Without it, a `throw` in the remote would take down the whole app. With it, the failure stays contained within this route.
- It must be a **class component**: React only offers `getDerivedStateFromError`/`componentDidCatch` in classes.
- **Fallback = `LocalTodoScreen` with the same store**: the user does not lose their tasks when the remote fails, even if it fails mid-use.
- **Limited retry (`MAX_RETRIES`)**: avoids an infinite loop of downloads. Manifest and compatibility errors do **not** offer a retry, because trying again would give the same result.
- **Telemetry with phase and `releaseId`**: in production you need to know *which release*, *on which platform*, and *at which step* it failed, in order to decide on the rollback. `sanitize` ensures no task title leaks.
- **The `releaseId` is passed to the remote**: the remote can also log and display its own version.

**How to verify.** This is the good part: **the fallback can be tested without having the remote.**
1. With nothing running on port 9000, open "Todo (remote, with fallback)". The spinner appears, then the local screen with the yellow notice, and the log shows `[remote_fallback] { phase: 'load', ... }`.
2. "Try again" appears twice and then disappears.
3. In the manifest, `"enabled": false` falls straight to the local screen, with no retry button (`phase: 'manifest'`).
4. In the manifest, `"reactNative": "0.0.0"` gives `phase: 'compatibility'`, with no retry.
5. Add tasks on the local screen, go into the Todo route and come back: the tasks are still there (the store is the same).

---

## Final checklist

| Item from the host definition | Where |
|---|---|
| Initializes runtime (Module Federation) | Step 5 (`rspack.config.mjs`) + Step 8 (`registerRemotes`/`loadRemote`) |
| Navigation | Step 4 |
| Reads the release configuration | Step 6 (manifest) + Step 7 (compatibility) |
| Local Todo screen (fallback) | Steps 2 and 3 |
| Error Boundary that falls back | Step 9 |

Run `npx tsc --noEmit` at the end of each step.

## Next steps (outside the host)

- Create `apps/todo-remote` exposing `./TodoScreen` with `ModuleFederationPluginV2({ name: 'todo_remote', exposes: {...}, shared: <same as the host> })`, and then confirm the `entry` URL in the manifest.
- Store persistence with Zustand's `persist` middleware + AsyncStorage (the Step 2 queue is already ready for async writes).
- "Last known good release" + `manifest.staging.json` / `manifest.prod.json` + `MANIFEST_URL` pointing to the CDN (Steps 7 and 9 of the root README).
