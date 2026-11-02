# Todo with Expo, React Native and Re.Pack

End-to-end guide for studying an app with **host + remote**, shared state, Module Federation, compatibility, fallback, failure isolation, rollback and loading the remote from a CDN.

> **Project status:** this repository starts empty. The document defines an incremental implementation, with a code base and passing criteria. The Expo + Re.Pack combination requires custom integration: Re.Pack documents React Native and replacing Metro, but does not provide a ready-made official Expo flow. Therefore, treat the prebuild, native integration and bundler steps as a mandatory technical spike before investing in the CDN. Re.Pack recommends RN 0.74+ and currently works with Module Federation v2. [Re.Pack quick start](https://re-pack.dev/docs/getting-started/quick-start) · [Re.Pack](https://re-pack.dev/)

## What we are going to build

- **Host**: Expo/React Native app that bootstraps the runtime and navigation, reads the release configuration and contains a local Todo screen that serves as a fallback.
- **Remote `todo`**: federated module that exposes `./TodoScreen` and `./TodoWidget`.
- **Shared state**: a stable TypeScript contract and a `TodoStore` created in the host. The host injects the store into the remote via props; it does not rely on two copies of Context/React crossing the federated boundary.
- **Concurrency**: two simultaneous requests for the remote share the same loading Promise; store mutations are serialized to avoid lost updates.
- **Dependencies**: React, React Native and libraries with state/context are aligned as shared singletons. Stateless UI libraries can be bundled into the remote, as long as they are compatible with the host's native runtime.
- **Operations**: versioned manifest, compatibility policy, timeout, local fallback, telemetry, gradual rollout and rollback by swapping the manifest version.
- **CDN**: the last step; the JS/Hermes artifacts and assets are published per platform and immutable version.

## Important limits

1. Module Federation swaps **JavaScript/bytecode** at runtime. It does not install new native code on the device. A dependency that needs a native module (Expo Module, CocoaPod, Android AAR, config plugin) must be in the host binary before the remote can use it. Changing that layer requires a new store build.
2. Compatibility is not solved by `singleton` alone. Host and remote must agree on platform, RN architecture, React/RN version, store contract and bundle format. `singleton` prevents duplicate copies in a share scope; it does not make incompatible versions compatible.
3. `fallback` recovers from download/evaluation/render failures and detected incompatibility. It does not recover from native crashes, a process killed by the OS, or irreversible side effects that have already run.
4. In React Native, a remote artifact must be produced for the same target (iOS/Android, Hermes/JS) and runtime matrix as the host. Do not assume that a browser `remoteEntry.js` is loadable in a native app.
5. Expo Go is not the validation target for this architecture. Use a development build/prebuild and test on devices/simulators. Expo Go does not let you replace its native runtime with arbitrary native modules from the project.

## Suggested stack and structure

Use a Node LTS compatible with the selected Re.Pack version, mutually compatible Expo SDK/RN, TypeScript, Re.Pack/Rspack and Module Federation v2. Pin exact versions in the lockfile instead of using `latest` in CI scripts. The Expo ↔ React Native matrix must come from the Expo documentation for the chosen SDK.

```text
todo-mf/
  apps/
    host/                 # Expo app, runtime, navigation, store and fallback
    todo-remote/          # federated app/bundle
  packages/
    todo-contract/        # types and stable store contract
    todo-ui/              # optional: stateless shared components
  release/
    manifest.dev.json
    manifest.staging.json
    manifest.prod.json
```

During the first spike, keep host, remote and contract in the same repository/monorepo. If the pipeline of the chosen Expo tooling does not allow Re.Pack to produce the native bundle in the intended workflow, stop here and decide between: (a) Expo prebuild + custom integration with Re.Pack, (b) React Native Community CLI + Re.Pack as the bundler, or (c) Expo/Metro with a different dynamic loading solution. Do not mix Metro and Re.Pack examples as if they were interchangeable configurations.

## Step 1 — Create and validate the base Expo app

Create the Expo host first without federation; run it in an iOS and Android development build and record the resolved versions. An example starting point (choose/record the SDK supported at implementation time):

```bash
npx create-expo-app@latest apps/host --template blank-typescript
cd apps/host
npx expo install expo-dev-client
npx expo prebuild
npx expo run:ios
# on another machine/environment: npx expo run:android
```

Confirm that the app boots and that `npx expo-doctor` reports no issues before swapping the bundler. Commit this working state. Prebuild generates native projects; preserve changes via config plugins and regenerate only when you know which changes are generated vs. manual.

## Step 2 — Do a Re.Pack spike on the host

Follow the current [quick start](https://re-pack.dev/docs/getting-started/quick-start) and the [manual migration](https://re-pack.dev/docs) for the pinned version. Re.Pack is a bundler based on Rspack/Webpack and replaces Metro on the targets it compiles. The Expo integration has to align the development command, export/build, asset resolution, Hermes, the native entry point and the Expo development configuration.

Checklist for this spike:

1. Install Re.Pack at the chosen version and generate/adjust `rspack.config.*` following the template for that same version.
2. Point the host's native JS entry point to the entry expected by Re.Pack and configure the start/build scripts to invoke it.
3. Keep `app.json`/Expo config as the source of truth for name, icons, plugins and identifiers; verify the prebuild result.
4. Generate development and release bundles for iOS and Android; confirm Hermes, sourcemaps, assets and loading without a remote.
5. Make a native development build and open it on a device/emulator. Expo Go does not validate the custom integration.

Plugin, loader and script names change between Re.Pack majors; copy them from the documentation for the pinned version, not from an old blog post. Only move forward when both targets work offline with the local screen.

## Step 3 — Extract the contract and shared state

The store belongs to the host. The remote receives a minimal interface; this avoids duplicated contexts and makes it clear who controls concurrency and persistence.

```ts
// packages/todo-contract/src/index.ts
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

In the host, implement the store with `useSyncExternalStore` or adapt it to a host Context. All asynchronous write operations go through a queue/mutex (or a reducer with a queue); each operation reads the most recent snapshot inside the serialized section, writes once and notifies listeners. This defines the concurrency rule for rapid taps, duplicate requests and eventual persistence. Do not create a store inside the remote.

```tsx
// host: context created once at the root
const todoStore = createTodoStore();

<TodoStoreProvider store={todoStore}>
  <AppNavigation />
</TodoStoreProvider>
```

The remote receives the same object via a prop (`store`) and uses `useSyncExternalStore(store.subscribe, store.getSnapshot)`. If an API needs to cross React context, share the package/context itself as a singleton too and validate identity (`HostContext === RemoteContext`) at runtime; explicit injection via props remains the preferred contract.

## Step 4 — Assemble the remote and Module Federation

Configure the remote to expose pure components, without initializing a second React Native root tree:

```ts
// apps/todo-remote/src/TodoScreen.tsx
import type { TodoRemoteProps } from '@todo-mf/todo-contract';

export function TodoScreen({ store, releaseId }: TodoRemoteProps) {
  const todos = useSyncExternalStore(store.subscribe, store.getSnapshot);
  // Native UI for the list, form and actions using the store.
  return <TodoList todos={todos} onToggle={store.toggle} releaseId={releaseId} />;
}
```

In Re.Pack's Module Federation v2 configuration, use unique container names, `filename`/entry and `exposes` following the official examples for the pinned version. Conceptual example (the exact syntax varies by major):

```js
new ModuleFederationPlugin({
  name: 'todo_remote',
  filename: 'remoteEntry.js',
  exposes: {
    './TodoScreen': './src/TodoScreen',
  },
  shared: {
    react: { singleton: true, requiredVersion: 'EXACT_HOST_VERSION' },
    'react-native': { singleton: true, requiredVersion: 'EXACT_HOST_VERSION' },
    '@todo-mf/todo-contract': { singleton: true, requiredVersion: 'CONTRACT_VERSION' },
  },
});
```

This block describes the policy; it is not meant to be pasted without adapting it to Re.Pack's plugin/runtime: keep `react` and `react-native` at identical versions resolved by the host; check the official shared modules example to make sure `requiredVersion`, `eager`, `import` and the share scope format are supported in the chosen plugin/runtime. Do not mark every dependency as a singleton indiscriminately. Libraries with hooks/context or global state are singleton candidates. Purely visual packages can be duplicated when that reduces coupling and does not create incompatibility.

In the host, initialize the runtime/container once and import the module asynchronously. Declare the federated type for the compiler (types do not validate runtime compatibility):

```ts
// apps/host/src/federation.d.ts
declare module 'todo_remote/TodoScreen' {
  import type { ComponentType } from 'react';
  import type { TodoRemoteProps } from '@todo-mf/todo-contract';
  const TodoScreen: ComponentType<TodoRemoteProps>;
  export default TodoScreen;
}
```

## Step 5 — Compatibility, version mapping and conflicts

Create an explicit matrix in the repository and include it in every remote build:

```json
{
  "remote": "todo",
  "releaseId": "todo-2026.10.12.1",
  "platform": ["ios", "android"],
  "bundleFormat": "<identifier supported by the chosen runtime>",
  "runtimeApi": "1",
  "contract": "1.x",
  "react": "<exact version>",
  "reactNative": "<exact version>",
  "expoSdk": "<exact version or n/a in the remote>",
  "minHostVersion": "1.0.0",
  "maxHostVersionExclusive": "2.0.0"
}
```

`expoSdk` informs the build matrix; the federated code must not load a second Expo runtime. Version mapping is done by a host manifest that maps **platform + channel + host range** to an immutable remote version. Example:

```json
{
  "schema": 1,
  "channel": "production",
  "remotes": {
    "todo": {
      "ios": { "releaseId": "todo-2026.10.12.1", "entry": "https://cdn.example.com/todo/ios/2026.10.12.1/remoteEntry.js" },
      "android": { "releaseId": "todo-2026.10.12.1", "entry": "https://cdn.example.com/todo/android/2026.10.12.1/remoteEntry.js" }
    }
  }
}
```

Before importing, compare metadata with the host: platform, `runtimeApi`, contract, exact React/RN versions, host range and format. Reject the remote and open the local implementation if any rule fails. For dependency conflicts: (1) deduplicate and lock shared versions; (2) keep native libraries in the host; (3) use adapters for API compatibility; (4) bundle dependencies without global state in isolation; (5) never resolve a conflict by hiding version warnings.

## Step 6 — Loading concurrency and fallback

Use a per-remote/release Promise cache: if host, preload and navigation request the same module at the same time, they all await the same Promise. Remove the rejected Promise from the cache to allow a controlled retry. Avoid loading the same exposure repeatedly or running global initialization more than once.

```ts
const inFlight = new Map<string, Promise<unknown>>();

function loadOnce(key: string, load: () => Promise<unknown>) {
  const existing = inFlight.get(key);
  if (existing) return existing;
  const promise = load().catch((error) => {
    inFlight.delete(key); // allows a later retry
    throw error;
  });
  inFlight.set(key, promise);
  return promise;
}
```

Integrate this with the real federation loader/runtime; do not use the snippet as a replacement for the loader. Set a network/evaluation timeout and a retry limit with backoff. For mutations, the store serializes writes and must be idempotent when it can be retried.

In React, `Suspense` covers the wait; an Error Boundary covers import/render errors; the product fallback is the host's local list:

```tsx
<RemoteErrorBoundary fallback={<LocalTodoScreen store={todoStore} />}>
  <Suspense fallback={<TodoLoading /> }>
    <FederatedTodoScreen store={todoStore} releaseId={releaseId} />
  </Suspense>
</RemoteErrorBoundary>
```

The Error Boundary must log `releaseId`, platform, phase (`manifest`, `download`, `evaluate`, `render`) and a sanitized error, offer a limited retry and then stay on the local screen. Do not send personal task data in telemetry.

## Step 7 — Failure isolation, rollout and rollback

- Each remote screen/feature sits behind its own boundary; an error in Todo does not unmount navigation or other host functions.
- Load the manifest with a timeout and validate the schema/signature before using URLs. An invalid manifest means using the embedded local configuration.
- Record the last known-good release in local storage. If the new release fails to load, mark it as bad for the session and try the previous compatible release; if that fails, use the local fallback.
- Roll out by channel (dev → staging → production) and percentage/segment. Keep the previous version and assets on the CDN during the rollback window.
- Operational rollback: revert the manifest pointer to the previous immutable release. Do not overwrite published directories/version IDs. Clients already running may keep the module in memory until the feature/app restarts.
- If the remote changes the contract or a required native API, publish a new host version; a JS rollback does not replace a binary rollback.

## Step 8 — Test before the CDN

Run it manually on iOS and Android, in development and release, with normal network and airplane mode. The user asked for the end-to-end implementation; at this stage of the guide, the criteria are:

1. The local host opens and Todo CRUD works without a network.
2. The local remote loads on both systems with the same store/context: adding an item in the remote updates the host view and vice versa.
3. Two concurrent calls to the loader result in a single load; concurrent taps do not lose updates.
4. An incompatible version, a 404 entry, a timeout, an evaluation error and a render error show the local fallback and identifiable telemetry.
5. Switching the manifest from the new release to the previous release reverts the remote without reinstalling the binary.
6. The remote build does not import native modules the host does not include; verify the dependency tree and the per-platform bundle.

Do not publish to real users until the cycle above works with a local bundle/staging environment. The CDN is a change of artifact origin, not a replacement for this validation matrix.

## Step 9 — Publish the remote to a CDN (final stage)

1. Build the remote separately for each platform/engine and generate the entry, chunks, assets, metadata, private sourcemaps and checksums. Use the command documented by Re.Pack for the chosen target.
2. Publish to an immutable path, for example `todo/android/1.4.2/` and `todo/ios/1.4.2/`. Configure MIME types and CORS if applicable to the runtime; validate TLS, cache and URLs from real devices. Re.Pack supports splitting/loading remote bundles, but the format and deploy configuration depend on the runtime and version used. [Re.Pack](https://re-pack.dev/)
3. Configure long cache for versioned files (`immutable`) and short cache for the manifest. The entry and chunks of the same release must stay together; do not overwrite published files.
4. The manifest must point to the correct URL for the platform, channel and host version. Sign/verify the manifest and artifacts if the runtime/pipeline supports it; otherwise, validate a hash obtained over an authenticated channel and use HTTPS.
5. Start in an internal environment, then staging and a small rollout. Watch download success, compatibility, render, load time and fallback rate per release. Revert the manifest if it exceeds the defined limits.

**Expected result:** the host boots locally, queries the manifest, chooses a compatible version, downloads the remote from the CDN, injects the host store and renders the screen; any failure falls back to the local Todo and allows rollback via the manifest.

## Primary sources

- [Re.Pack quick start](https://re-pack.dev/docs/getting-started/quick-start) — requirements and usage.
- [Re.Pack](https://re-pack.dev/) — React Native bundler and Module Federation v2.
- [Expo guide: New Architecture](https://docs.expo.dev/guides/new-architecture/) — Expo/RN architecture and support per SDK.
- [Re.Pack issue #1396 about Expo](https://github.com/callstack/repack/issues/1396) — discussion of Expo integration; an issue is not an official support contract.
