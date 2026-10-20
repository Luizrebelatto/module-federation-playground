# Host — guia de implementação passo a passo

Este guia leva o `apps/host` do template Expo até o host descrito no [README raiz](../../README.md):

> **Host**: app Expo/React Native que inicializa runtime e navegação, lê configuração de releases e contém uma tela Todo local que serve de fallback.

Cada passo diz **o que fazer**, **para que serve** e **como verificar**. A ordem é proposital: primeiro o app funciona 100% local (sem rede, sem remote); só depois entra Module Federation. Assim, quando algo quebrar, você sabe se o problema é do app ou da federação.

## Como tudo se encaixa

```text
App.tsx
 └─ TodoStoreProvider (store Zustand criado 1x no host, exposto como TodoStore)
     └─ NavigationContainer
         ├─ Home
         ├─ LocalTodo ──────────────► LocalTodoScreen (embarcada)
         └─ Todo
             └─ RemoteErrorBoundary ─ erro? ─► LocalTodoScreen + aviso + retry
                 └─ Suspense ─ carregando? ─► spinner
                     └─ lazy(() =>
                          1. loadReleaseManifest()   lê release/manifest.*.json
                          2. resolveRemote()         escolhe entry da plataforma
                          3. assertCompatible()      versões batem com o host?
                          4. loadTodoScreen()        registerRemotes + loadRemote (MF runtime)
                        )
```

## Estrutura final

```text
todo-mf/
  packages/todo-contract/          # Passo 1
    package.json
    src/index.ts
  release/
    manifest.dev.json              # Passo 6
  apps/host/
    App.tsx                        # Passo 4
    rspack.config.mjs              # Passos 1 e 5
    tsconfig.json                  # Passo 1
    src/
      store/todoStore.ts           # Passo 2 (Zustand + adapter)
      store/TodoStoreContext.tsx   # Passo 2
      screens/LocalTodoScreen.tsx  # Passo 3
      screens/HomeScreen.tsx       # Passo 4
      navigation/AppNavigation.tsx # Passo 4
      release/manifest.ts          # Passo 6
      release/compatibility.ts     # Passo 7
      federation/RemoteLoadError.ts# Passo 6
      federation/loadTodoScreen.ts # Passo 8
      federation/telemetry.ts      # Passo 9
      federation/RemoteErrorBoundary.tsx # Passo 9
      screens/TodoScreen.tsx       # Passo 9
```

---

## Passo 0 — Rodar com Re.Pack, não com Metro

**O que fazer.** Hoje o `package.json` tem `"start": "expo start"`, e isso sobe o **Metro**. O `rspack.config.mjs` só é usado quando o bundler é o Re.Pack. Ajuste os scripts como no `mf-runtime/host-app`, que já funciona:

```json
"scripts": {
  "start": "react-native start",
  "ios": "expo run:ios --no-bundler",
  "android": "expo run:android --no-bundler"
}
```

**Para que serve.** `react-native start` usa os comandos do Re.Pack registrados em `react-native.config.js`. O `--no-bundler` impede o `expo run` de abrir um Metro na mesma porta 8081. Sem isso, nada do que você configurar no Rspack (alias, Module Federation) entra no bundle.

**Como verificar.** Em um terminal, rode `npm start`. Em outro, rode `npm run ios`. O log do servidor precisa mostrar Rspack/Re.Pack, não Metro.

---

## Passo 1 — Contrato compartilhado (`packages/todo-contract`)

**O que fazer.** Crie o pacote com os tipos que host e remote vão usar:

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
 * Contrato estável entre host e remote `todo`.
 * Mudança incompatível aqui = novo major de CONTRACT_VERSION.
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

Para o host enxergar o pacote sem configurar workspaces, use um alias no bundler e em `paths` no TypeScript:

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

**Para que serve.**
- O contrato é a **única coisa** que host e remote precisam ter em comum sobre o Todo. O remote não conhece o store real, só a interface.
- `CONTRACT_VERSION` existe em runtime, não só nos tipos. É ele que o Passo 7 compara para recusar um remote feito para outro contrato. Tipos TypeScript somem no build e não protegem nada em produção.
- `TodoRemoteProps` define que o store **chega por prop**. Assim não há dois React Contexts (um do host, outro do remote) atravessando o limite federado.

**Como verificar.** Rode `npx tsc --noEmit` em `apps/host`. Um `import type { Todo } from '@todo-mf/todo-contract'` em qualquer arquivo precisa resolver sem erro.

---

## Passo 2 — Store do Todo com Zustand e escrita serializada

**O que fazer.**

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
          // Devolver o mesmo state faz o Zustand não notificar ninguém.
          return next === state.todos ? state : { todos: next };
        });
      });
      // Uma mutação que falhou não pode travar as próximas.
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

// Adapter: o Zustand é detalhe de implementação do host; para fora só sai o contrato.
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

// Contexto só do host. O remote não usa este contexto: recebe o store por prop.
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

**Para que serve.**
- **Zustand (`zustand/vanilla`)** guarda o estado e notifica quem está inscrito. Usamos o `createStore` *vanilla* (sem hook) porque o store vive fora do React e é criado uma vez no `App.tsx` (Passo 4).
- **Adapter para o contrato**: `createTodoStore` devolve um `TodoStore` (Passo 1), não o store do Zustand. Assim o Zustand não entra no contrato: o remote não importa `zustand`, ele não precisa ir para o `shared` do Module Federation, e um upgrade de major (ou a troca do Zustand por outra lib) não exige host e remote sincronizados. A lib de estado fica escondida atrás da fronteira.
- **Store fora do React** (`getSnapshot` e `subscribe`): o host passa o mesmo objeto para a tela local e para o remote, e os dois enxergam o mesmo estado. Adicionar um item no remote aparece na tela local, e o contrário também vale.
- **`useSyncExternalStore`**: é o hook oficial do React para ler stores externos sem *tearing*, ou seja, sem partes da UI mostrando versões diferentes do estado. Ele funciona direto com o adapter: o `subscribe` do Zustand já devolve a função de unsubscribe, e `todos` só muda de referência quando muda de fato (requisito do `getSnapshot`).
- **Fila (`queue`)**: o `set` do Zustand é síncrono, mas o Zustand **não serializa actions assíncronas**. Quando entrar persistência ou API com `await`, duas actions poderiam ler o mesmo estado antigo e uma sobrescrever a outra. Com a fila, cada escrita espera a anterior e lê o `state.todos` mais recente dentro do `set`. Com dois toques rápidos em "toggle", ou um `add` do host junto com um do remote, nenhuma atualização se perde.
- **Actions como closures**, não `this`: `store.toggle` pode ser passado solto (`onPress={store.toggle}`) sem `bind`, inclusive pelo remote.
- **O store é criado no host, nunca no remote.** Quem controla concorrência e persistência é o host. Quando a persistência entrar, o caminho natural é o middleware `persist` do Zustand com AsyncStorage. Como AsyncStorage tem código nativo, ele precisa estar no binário do host.

**Como verificar.** Escreva um teste rápido: chame `add('a')`, `add('b')` e `toggle(...)` sem `await` entre eles e depois espere a última Promise. O snapshot precisa conter tudo. Confira também que `getSnapshot()` devolve a **mesma** referência em duas chamadas seguidas sem mutação no meio.

---

## Passo 3 — Tela Todo local (o fallback)

**O que fazer.**

```tsx
// apps/host/src/screens/LocalTodoScreen.tsx
import { useState, type ReactNode } from 'react';
import { FlatList, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import type { TodoStore } from '@todo-mf/todo-contract';

import { useTodos } from '../store/TodoStoreContext';

type Props = {
  store: TodoStore;
  /** Conteúdo opcional no topo (ex.: aviso de que o remote caiu no fallback). */
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
          placeholder="Nova tarefa"
          value={title}
          onChangeText={setTitle}
          onSubmitEditing={submit}
          returnKeyType="done"
        />
        <Pressable style={styles.addButton} onPress={submit} accessibilityRole="button">
          <Text style={styles.addButtonText}>Adicionar</Text>
        </Pressable>
      </View>
      <FlatList
        data={todos}
        keyExtractor={(todo) => todo.id}
        ListEmptyComponent={<Text style={styles.empty}>Nenhuma tarefa ainda.</Text>}
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
              <Text style={styles.remove}>Remover</Text>
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

**Para que serve.**
- É a **garantia de produto**: com remote fora do ar, manifesto quebrado ou versão incompatível, o usuário ainda consegue usar o Todo.
- Recebe `store` por prop, igual ao remote (`TodoRemoteProps`). Assim a tela local e a remota são intercambiáveis, e o estado é preservado quando uma substitui a outra.
- A prop `banner` existe para o Passo 9, que avisa "você está na versão local" sem criar uma segunda tela.

**Como verificar.** Renderize temporariamente `<LocalTodoScreen store={createTodoStore()} />` no `App.tsx` e teste o CRUD **em modo avião**.

---

## Passo 4 — Navegação

**O que fazer.** Instale o React Navigation com o native stack:

```bash
cd apps/host
npx expo install @react-navigation/native @react-navigation/native-stack react-native-screens react-native-safe-area-context
npm run ios   # rebuild nativo obrigatório (react-native-screens e safe-area têm código nativo)
```

```tsx
// apps/host/src/screens/HomeScreen.tsx
import { Button, StyleSheet, View } from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';

import type { RootStackParamList } from '../navigation/AppNavigation';

export function HomeScreen({ navigation }: NativeStackScreenProps<RootStackParamList, 'Home'>) {
  return (
    <View style={styles.container}>
      <Button title="Todo (remote, com fallback)" onPress={() => navigation.navigate('Todo')} />
      <Button title="Todo local" onPress={() => navigation.navigate('LocalTodo')} />
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
        <Stack.Screen name="LocalTodo" component={LocalTodoRoute} options={{ title: 'Todo local' }} />
      </Stack.Navigator>
    </NavigationContainer>
  );
}
```

```tsx
// apps/host/src/screens/LocalTodoRoute.tsx — rota que liga a tela local ao store do contexto
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

// Criado uma vez, fora do componente: sobrevive a re-renders e é o mesmo para host e remote.
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

> Enquanto o Passo 9 não estiver pronto, faça a rota `Todo` apontar para `LocalTodoRoute`.

**Para que serve.**
- A navegação é do **host**. O remote vira só uma tela dentro dela, sem `NavigationContainer` próprio e sem segunda árvore raiz. Se o remote quebrar, Home e as outras rotas continuam funcionando (**isolamento de falha**).
- Ter uma rota `LocalTodo` separada ajuda a testar e comparar: as duas telas compartilham o store.
- **Por que React Navigation e não Expo Router?** O `AGENTS.md` sugere Expo Router, mas ele depende de recursos do Metro (descoberta de rotas por arquivos via transform/config do Metro). Como este host usa Re.Pack no lugar do Metro, o React Navigation é a opção sem integração extra. O Expo Router por baixo também usa React Navigation.
- **Por que rebuild?** `react-native-screens` e `react-native-safe-area-context` têm código nativo. Lembre do limite 1 do README raiz: um remote **nunca** pode trazer dependência nativa que o binário do host não tenha.

**Como verificar.** O app abre na Home, você navega para as duas rotas e o estado é o mesmo nas duas.

---

## Passo 5 — Inicializar o runtime de Module Federation

**O que fazer.**

```bash
cd apps/host
npm install @module-federation/enhanced@2.9.2   # mesma versão do mf-runtime/host-app
```

```js
// apps/host/rspack.config.mjs  (dentro de plugins)
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

**Para que serve.**
- O `ModuleFederationPluginV2` injeta no bundle do host o **runtime de MF**: o código que sabe registrar remotes, baixar o container e negociar dependências compartilhadas. Também adiciona os plugins de runtime do Re.Pack (`core-plugin` e `resolver-plugin`), que fazem o download passar pelo `ScriptManager`, o carregador nativo de scripts do Re.Pack.
- O Re.Pack **exige** `@module-federation/enhanced` instalado: o plugin lança erro se não encontrar o pacote. Ele também fornece `@module-federation/enhanced/runtime`, usado no Passo 8.
- **`shared` com `singleton: true`**: só pode existir **uma** cópia de React e de React Native no processo. Duas cópias de React = hooks quebrando ("Invalid hook call").
- **`eager: true`** no host: React/RN vão no bundle principal, porque o host precisa deles antes de qualquer remote existir.
- **`requiredVersion` exata**: o remote precisa usar exatamente essas versões. O `singleton` evita duplicar, mas não torna versões diferentes compatíveis.
- **`zustand` fica fora do `shared`, de propósito.** Ele é detalhe interno do host (Passo 2); o remote só conhece o contrato `TodoStore`. Só entraria aqui como singleton se o remote passasse a importar Zustand.
- **Sem `remotes` aqui, de propósito.** No `mf-runtime` o remote fica fixo no config (`products@dynamic`). Aqui a URL vem do **manifesto de releases** (Passo 6). Por isso dá para trocar a versão ou fazer rollback sem rebuildar o host.

**Como verificar.** `npm start` compila sem erro e o app abre igual ao Passo 4. Nada muda visualmente: o runtime está lá, só ainda não é usado.

---

## Passo 6 — Manifesto de releases e leitura dele

**O que fazer.** Crie o manifesto na raiz do monorepo:

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

> ⚠️ O caminho exato do `entry` (`/ios/todo_remote.container.js.bundle`) só pode ser confirmado quando o `todo-remote` existir: depende do `filename` e de como o dev server do Re.Pack serve o container. Ajuste aqui, porque é o único lugar que precisa mudar.

Um tipo de erro com a **fase** da falha, usado por todo o resto:

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

  /** Manifesto e compatibilidade não mudam num retry; download/timeout podem. */
  get retryable() {
    return this.phase !== 'manifest' && this.phase !== 'compatibility';
  }
}

export function phaseOf(error: unknown): RemotePhase {
  return error instanceof RemoteLoadError ? error.phase : 'render';
}
```

O leitor do manifesto:

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

/** Release já resolvida para a plataforma atual: é o que o loader consome. */
export type ResolvedRemote = Omit<RemoteRelease, 'entries'> & { name: string; entry: string };

// URL do manifesto publicado (CDN). `null` = usar só o manifesto embarcado no binário.
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

/** Lê a configuração de releases uma vez por sessão. */
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

**Para que serve.**
- O manifesto é o **ponteiro** "qual versão do remote este app deve usar". Trocar o ponteiro faz deploy ou **rollback** sem passar pelas lojas. Os artefatos do remote são imutáveis, e o que muda é só para onde o manifesto aponta.
- **`entries` por plataforma**: o bundle de iOS e o de Android são artefatos diferentes (limite 4 do README raiz).
- **`enabled`**: um *kill switch*. Com `false`, todo mundo cai na tela local na hora.
- **`compatibility`**: os metadados que o Passo 7 compara com o host.
- **Manifesto embarcado + remoto opcional**: hoje `MANIFEST_URL = null` e só o JSON embutido no binário é usado. No passo da CDN você preenche a URL. Se o manifesto remoto falhar (rede, timeout de 3s, schema inválido), o host **cai no embarcado** em vez de quebrar.
- **Validação de schema**: um JSON malformado vindo da rede não pode virar URL de script executável.
- **Memoizado** (`manifestPromise`): é lido uma vez por sessão, mesmo que várias telas peçam.

**Como verificar.** Logue `await loadReleaseManifest()` e `resolveRemote(..., 'todo')`. Mude `enabled` para `false` e confira que `resolveRemote` lança `RemoteLoadError` com `phase: 'manifest'`.

---

## Passo 7 — Checagem de compatibilidade

**O que fazer.**

```ts
// apps/host/src/release/compatibility.ts
import { version as reactVersion } from 'react';
import { Platform } from 'react-native';
import { CONTRACT_VERSION } from '@todo-mf/todo-contract';

import appConfig from '../../app.json';
import { RemoteLoadError } from '../federation/RemoteLoadError';
import type { ResolvedRemote } from './manifest';

/** Versão da API de runtime que este binário host oferece aos remotes. */
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

**Para que serve.**
- Recusa o remote **antes de baixar e executar** o código. Um remote incompatível que chega a rodar pode quebrar de formas difíceis de diagnosticar, como hooks inválidos, props faltando ou módulo nativo inexistente.
- Cada regra cobre um risco diferente:
  - `react` / `reactNative` **exatos**: o remote foi compilado contra o mesmo runtime JS e nativo.
  - `contract` (mesmo **major**): o remote espera o mesmo formato de `TodoStore`/`TodoRemoteProps`. Minor e patch são compatíveis por definição.
  - `runtimeApi`: número que você incrementa quando o **binário** muda algo que os remotes usam, como um módulo nativo novo ou removido.
  - `minHostVersion` / `maxHostVersionExclusive`: faixa de versões do app (`app.json → expo.version`) em que o remote foi testado.
- Retorna **todos** os problemas de uma vez na mensagem, o que facilita o diagnóstico pela telemetria.

**Como verificar.** No manifesto, mude `"react": "19.0.0"` e confira que `assertCompatible` lança um erro de `phase: 'compatibility'` com a mensagem explicando o motivo.

---

## Passo 8 — Loader do remote (cache de Promise + timeout)

**O que fazer.**

```ts
// apps/host/src/federation/loadTodoScreen.ts
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
```

**Para que serve.**
- **`registerRemotes` em runtime** substitui o `remotes: {...}` fixo do config. O container e a URL vêm do manifesto. O `resolver-plugin` do Re.Pack ouve esse registro e passa a resolver os scripts daquele container a partir do `entry`.
- **`loadRemote('todo_remote/TodoScreen')`** baixa o container, inicializa o share scope (React/RN do host) e devolve o módulo exposto.
- **`loadOnce` (cache de Promise)**: se o preload e a navegação pedirem o remote ao mesmo tempo, há **uma** carga só. Se a carga falhar, a Promise sai do cache, então o retry faz uma tentativa nova de verdade.
- **Timeout**: rede ruim não pode deixar o usuário vendo spinner para sempre. Depois de 10s, o fluxo cai no fallback. Atenção: o timeout só **para de esperar**, não cancela o download em andamento.
- **Fase `load` junta download e avaliação**: o `core-plugin` do Re.Pack captura o erro de download e só loga `Failed to load remote entry`, então o host não consegue distinguir as duas. Se precisar separar, dá para criar um runtime plugin próprio (hook `errorLoadRemote`).
- **Checa `mod.default`**: um remote que exporta errado é tratado como falha de carga, não como crash na renderização.

**Como verificar.** Chame `loadTodoScreen(release)` duas vezes seguidas sem `await` e confira que as duas Promises são **a mesma** (`===`). Sem remote rodando, a Promise rejeita com `phase: 'load'` (porta fechada) ou `'timeout'`.

---

## Passo 9 — Error Boundary, telemetria e a tela federada

**O que fazer.** Telemetria:

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

// Só nome + mensagem truncada: nunca enviar conteúdo das tarefas do usuário.
function sanitize(error: unknown) {
  if (error instanceof Error) return { name: error.name, message: error.message.slice(0, 200) };
  return { name: 'UnknownError', message: String(error).slice(0, 200) };
}

/** Ponto único de telemetria; troque o console por Sentry/Datadog/etc. depois. */
export function reportRemoteFallback({ remote, releaseId, phase, error }: RemoteFallbackEvent) {
  console.warn('[remote_fallback]', { remote, releaseId, phase, platform: Platform.OS, error: sanitize(error) });
}
```

O boundary:

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

A tela que junta tudo:

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

  // React.lazy guarda o resultado (inclusive a rejeição) para sempre;
  // por isso criamos um lazy novo a cada tentativa.
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
      key={attempt} // trocar a key remonta o boundary = limpa o erro
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
                <Text style={styles.bannerText}>Versão local (remote indisponível)</Text>
                {canRetry && <Button title="Tentar novamente" onPress={() => setAttempt((n) => n + 1)} />}
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

Por fim, em `AppNavigation`, aponte a rota `Todo` para este `TodoScreen`.

**Para que serve.**
- **`Suspense`** cobre a **espera** (manifesto + download) com um spinner.
- **`RemoteErrorBoundary`** cobre o **erro**: rejeição do `lazy` (fases manifest, compatibility, load e timeout) **e** exceção durante a renderização do remote (fase render). Sem ele, um `throw` no remote derrubaria o app inteiro. Com ele, a falha fica contida nesta rota.
- Precisa ser **componente de classe**: o React só oferece `getDerivedStateFromError`/`componentDidCatch` em classes.
- **Fallback = `LocalTodoScreen` com o mesmo store**: o usuário não perde as tarefas quando o remote falha, mesmo que falhe no meio do uso.
- **Retry limitado (`MAX_RETRIES`)**: evita loop infinito de downloads. Erros de manifesto e de compatibilidade **não** oferecem retry, porque tentar de novo daria o mesmo resultado.
- **Telemetria com fase e `releaseId`**: em produção você precisa saber *qual release*, *em que plataforma* e *em que etapa* falhou, para decidir o rollback. `sanitize` garante que nenhum título de tarefa vaze.
- **O `releaseId` é passado ao remote**: o remote também consegue logar e exibir a própria versão.

**Como verificar.** Esta é a parte boa: **o fallback dá para testar sem ter o remote.**
1. Sem nada rodando na porta 9000, abra "Todo (remote, com fallback)". Aparece o spinner, depois a tela local com o aviso amarelo, e o log mostra `[remote_fallback] { phase: 'load', ... }`.
2. "Tentar novamente" aparece 2 vezes e depois some.
3. No manifesto, `"enabled": false` cai direto no local, sem botão de retry (`phase: 'manifest'`).
4. No manifesto, `"reactNative": "0.0.0"` dá `phase: 'compatibility'`, sem retry.
5. Adicione tarefas na tela local, entre na rota Todo e volte: as tarefas continuam lá (o store é o mesmo).

---

## Checklist final

| Item da definição de host | Onde |
|---|---|
| Inicializa runtime (Module Federation) | Passo 5 (`rspack.config.mjs`) + Passo 8 (`registerRemotes`/`loadRemote`) |
| Navegação | Passo 4 |
| Lê configuração de releases | Passo 6 (manifesto) + Passo 7 (compatibilidade) |
| Tela Todo local (fallback) | Passos 2 e 3 |
| Error Boundary que cai no fallback | Passo 9 |

Rode `npx tsc --noEmit` ao fim de cada passo.

## Próximos passos (fora do host)

- Criar `apps/todo-remote` expondo `./TodoScreen` com `ModuleFederationPluginV2({ name: 'todo_remote', exposes: {...}, shared: <igual ao host> })`, e então confirmar a URL do `entry` no manifesto.
- Persistência do store com o middleware `persist` do Zustand + AsyncStorage (a fila do Passo 2 já está pronta para escritas assíncronas).
- "Último release bom" + `manifest.staging.json` / `manifest.prod.json` + `MANIFEST_URL` apontando para a CDN (Passos 7 e 9 do README raiz).
