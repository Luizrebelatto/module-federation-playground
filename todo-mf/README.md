# Todo federado com Expo, React Native e Re.Pack

Guia de ponta a ponta para estudar um app com **host + remote**, estado compartilhado, Module Federation, compatibilidade, fallback, isolamento de falhas, rollback e carregamento do remote por CDN.

> **Estado do projeto:** este repositório começa vazio. O documento define uma implementação incremental, com código-base e critérios de passagem. A combinação Expo + Re.Pack exige integração customizada: Re.Pack documenta React Native e substituição do Metro, mas não oferece um fluxo Expo oficial pronto. Portanto, trate os passos de prebuild, integração nativa e bundler como um spike técnico obrigatório antes de investir na CDN. O Re.Pack recomenda RN 0.74+ e atualmente trabalha com Module Federation v2. [Quick start Re.Pack](https://re-pack.dev/docs/getting-started/quick-start) · [Re.Pack](https://re-pack.dev/)

## O que vamos construir

- **Host**: app Expo/React Native que inicializa runtime e navegação, lê configuração de releases e contém uma tela Todo local que serve de fallback.
- **Remote `todo`**: módulo federado que expõe `./TodoScreen` e `./TodoWidget`.
- **Estado compartilhado**: contrato TypeScript estável e um `TodoStore` criado no host. O host injeta o store via props ao remote; não se depende de duas cópias de Context/React atravessando o limite federado.
- **Concorrência**: duas solicitações simultâneas para o remote compartilham a mesma Promise de carregamento; mutações do store são serializadas para evitar perda de atualização.
- **Dependências**: React, React Native e bibliotecas com estado/contexto são alinhadas como shared singleton. Bibliotecas de UI sem estado podem ser empacotadas no remote, desde que compatíveis com o runtime nativo do host.
- **Operação**: manifesto versionado, política de compatibilidade, timeout, fallback local, telemetria, rollout gradual e rollback por troca de versão do manifesto.
- **CDN**: último passo; os artefatos JS/Hermes e assets são publicados por plataforma e versão imutável.

## Limites importantes

1. Module Federation troca **código JavaScript/bytecode** em runtime. Não instala código nativo novo no aparelho. Uma dependência que precise de módulo nativo (Expo Module, CocoaPod, Android AAR, config plugin) deve estar no binário host antes do remote usá-la. Alterar essa camada exige novo build das lojas.
2. A compatibilidade não é resolvida por `singleton` sozinho. Host e remote precisam concordar em plataforma, arquitetura RN, versão de React/RN, contrato do store e formato de bundle. `singleton` evita cópias duplicadas em um share scope; não faz versões incompatíveis virarem compatíveis.
3. `fallback` recupera falhas de download/avaliação/renderização e incompatibilidade detectada. Não recupera crashes nativos, processo encerrado pelo SO ou efeitos colaterais irreversíveis já executados.
4. No React Native, artefato remoto deve ser produzido para o mesmo alvo (iOS/Android, Hermes/JS) e matriz de runtime do host. Não presuma que um `remoteEntry.js` de navegador é carregável em um app nativo.
5. Expo Go não é o alvo de validação desta arquitetura. Use development build/prebuild e teste em dispositivos/simuladores. Expo Go não permite substituir seu runtime nativo por módulos nativos arbitrários do projeto.

## Stack e estrutura sugeridas

Use Node LTS compatível com a versão de Re.Pack selecionada, Expo SDK/RN compatíveis entre si, TypeScript, Re.Pack/Rspack e Module Federation v2. Fixe versões exatas no lockfile em vez de usar `latest` nos scripts de CI. A matriz Expo ↔ React Native deve vir da documentação Expo do SDK escolhido.

```text
todo-mf/
  apps/
    host/                 # Expo app, runtime, navegação, store e fallback
    todo-remote/          # app/bundle federado
  packages/
    todo-contract/        # tipos e contrato estável do store
    todo-ui/              # opcional: componentes sem estado compartilhado
  release/
    manifest.dev.json
    manifest.staging.json
    manifest.prod.json
```

Durante o primeiro spike, mantenha host, remote e contrato no mesmo repositório/monorepo. Se o pipeline da ferramenta Expo escolhida não permitir que Re.Pack produza o bundle nativo no workflow pretendido, pare neste ponto e decida entre: (a) Expo prebuild + integração customizada com Re.Pack, (b) React Native Community CLI + Re.Pack como bundler, ou (c) Expo/Metro com uma solução de carregamento dinâmica diferente. Não misture exemplos Metro e Re.Pack como se fossem configurações intercambiáveis.

## Passo 1 — Criar e validar o app Expo base

Crie primeiro o host Expo sem federation; rode-o em development build iOS e Android e registre as versões resolvidas. Um exemplo de início (escolha/registre o SDK suportado no momento da implementação):

```bash
npx create-expo-app@latest apps/host --template blank-typescript
cd apps/host
npx expo install expo-dev-client
npx expo prebuild
npx expo run:ios
# em outra máquina/ambiente: npx expo run:android
```

Confirme que o app sobe e que `npx expo-doctor` não aponta problemas antes de trocar o bundler. Faça commit deste estado funcional. O prebuild gera projetos nativos; preserve as alterações via config plugins e regenere somente sabendo quais mudanças são geradas/manuais.

## Passo 2 — Fazer um spike Re.Pack no host

Siga a versão atual do [quick start](https://re-pack.dev/docs/getting-started/quick-start) e a [migração manual](https://re-pack.dev/docs) para a versão fixada. Re.Pack é um bundler baseado em Rspack/Webpack e substitui Metro nos alvos que ele compila. A integração Expo tem de alinhar o comando de desenvolvimento, export/build, resolução de assets, Hermes, entry point nativo e configuração de desenvolvimento do Expo.

Checklist deste spike:

1. Instalar Re.Pack na versão escolhida e gerar/ajustar `rspack.config.*` seguindo o template da mesma versão.
2. Apontar o entry point JS nativo do host para o entry esperado por Re.Pack e configurar os scripts de start/build para invocá-lo.
3. Manter `app.json`/config Expo como fonte de verdade para nome, ícones, plugins e identificadores; verificar o resultado do prebuild.
4. Gerar bundles de desenvolvimento e release para iOS e Android; confirmar Hermes, sourcemaps, assets e carregamento sem remote.
5. Fazer build nativo de development e abrir em dispositivo/emulador. Expo Go não valida a integração customizada.

Os nomes de plugins, loaders e scripts mudam entre majors do Re.Pack; copie-os da documentação da versão fixada, não de um blog antigo. Só avance quando ambos os alvos funcionarem offline com a tela local.

## Passo 3 — Extrair contrato e estado compartilhado

O store pertence ao host. O remote recebe uma interface mínima; isso evita contextos duplicados e deixa claro quem controla concorrência e persistência.

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

No host, implemente o store com `useSyncExternalStore` ou adapte-o a um Context do host. Todas as operações assíncronas de escrita passam por uma fila/mutex (ou por um reducer com fila); cada operação lê o snapshot mais recente dentro da seção serializada, grava uma vez e notifica listeners. Isso define a regra de concorrência para toques rápidos, requests duplicados e eventual persistência. Não crie um store dentro do remote.

```tsx
// host: contexto criado uma vez na raiz
const todoStore = createTodoStore();

<TodoStoreProvider store={todoStore}>
  <AppNavigation />
</TodoStoreProvider>
```

O remote recebe o mesmo objeto por prop (`store`) e usa `useSyncExternalStore(store.subscribe, store.getSnapshot)`. Se uma API precisar atravessar contexto React, compartilhe também o próprio pacote/contexto como singleton e valide identidade (`HostContext === RemoteContext`) em runtime; a injeção explícita por prop continua sendo o contrato preferido.

## Passo 4 — Montar remote e Module Federation

Configure o remote para expor componentes puros, sem inicializar uma segunda árvore raiz React Native:

```ts
// apps/todo-remote/src/TodoScreen.tsx
import type { TodoRemoteProps } from '@todo-mf/todo-contract';

export function TodoScreen({ store, releaseId }: TodoRemoteProps) {
  const todos = useSyncExternalStore(store.subscribe, store.getSnapshot);
  // UI nativa da lista, formulário e ações usando store.
  return <TodoList todos={todos} onToggle={store.toggle} releaseId={releaseId} />;
}
```

Na configuração Module Federation v2 do Re.Pack, use nomes de container exclusivos, `filename`/entry e `exposes` conforme os exemplos oficiais da versão fixada. Exemplo conceitual (a sintaxe exata varia por major):

```js
new ModuleFederationPlugin({
  name: 'todo_remote',
  filename: 'remoteEntry.js',
  exposes: {
    './TodoScreen': './src/TodoScreen',
  },
  shared: {
    react: { singleton: true, requiredVersion: 'VERSAO_EXATA_DO_HOST' },
    'react-native': { singleton: true, requiredVersion: 'VERSAO_EXATA_DO_HOST' },
    '@todo-mf/todo-contract': { singleton: true, requiredVersion: 'VERSAO_DO_CONTRATO' },
  },
});
```

Este bloco descreve a política, não é para colar sem adaptar ao plugin/runtime do Re.Pack: mantenha `react` e `react-native` em versões idênticas e resolvidas pelo host; confira o exemplo oficial de shared modules para garantir que `requiredVersion`, `eager`, `import` e formato do share scope sejam suportados no plugin/runtime escolhido. Não marque toda dependência como singleton indiscriminadamente. Bibliotecas com hooks/contexto ou estado global são candidatas a singleton. Pacotes puramente visuais podem ser duplicados quando isso reduz acoplamento e não gera incompatibilidade.

No host, inicialize o runtime/container uma única vez e importe o módulo de modo assíncrono. Declare o tipo federado para o compilador (tipos não validam compatibilidade em runtime):

```ts
// apps/host/src/federation.d.ts
declare module 'todo_remote/TodoScreen' {
  import type { ComponentType } from 'react';
  import type { TodoRemoteProps } from '@todo-mf/todo-contract';
  const TodoScreen: ComponentType<TodoRemoteProps>;
  export default TodoScreen;
}
```

## Passo 5 — Compatibilidade, version mapping e conflitos

Crie uma matriz explícita no repositório e inclua-a em cada build do remote:

```json
{
  "remote": "todo",
  "releaseId": "todo-2026.10.12.1",
  "platform": ["ios", "android"],
  "bundleFormat": "<identificador suportado pelo runtime escolhido>",
  "runtimeApi": "1",
  "contract": "1.x",
  "react": "<versao exata>",
  "reactNative": "<versao exata>",
  "expoSdk": "<versao exata ou n/a no remote>",
  "minHostVersion": "1.0.0",
  "maxHostVersionExclusive": "2.0.0"
}
```

`expoSdk` informa a matriz de build; o código federado não deve carregar outro runtime Expo. Version mapping é feito por um manifesto do host que mapeia **plataforma + canal + faixa de host** para uma versão imutável do remote. Exemplo:

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

Antes de importar, compare metadados com host: plataforma, `runtimeApi`, contrato, versões exatas de React/RN, faixa do host e formato. Recuse o remote e abra a implementação local se qualquer regra falhar. Para conflitos de dependências: (1) deduplicar e travar versões compartilhadas; (2) manter libs nativas no host; (3) usar adapters para compatibilidade de API; (4) empacotar isoladamente dependências sem estado global; (5) nunca resolver conflito escondendo warnings de versão.

## Passo 6 — Concorrência de carregamento e fallback

Use cache de Promise por remote/release: se host, preload e navegação pedirem o mesmo módulo ao mesmo tempo, todos aguardam a mesma Promise. Remova a Promise rejeitada do cache para permitir nova tentativa controlada. Evite carregar a mesma exposição repetidamente ou executar inicialização global mais de uma vez.

```ts
const inFlight = new Map<string, Promise<unknown>>();

function loadOnce(key: string, load: () => Promise<unknown>) {
  const existing = inFlight.get(key);
  if (existing) return existing;
  const promise = load().catch((error) => {
    inFlight.delete(key); // permite retry posterior
    throw error;
  });
  inFlight.set(key, promise);
  return promise;
}
```

Integre isso ao loader/runtime federation real, não use o snippet como substituto do loader. Defina timeout de rede/avaliação e limite de retry com backoff. Para mutations, o store serializa writes e deve ser idempotente quando puder receber retry.

No React, `Suspense` cobre espera; Error Boundary cobre erro de import/render; fallback de produto é a lista local host:

```tsx
<RemoteErrorBoundary fallback={<LocalTodoScreen store={todoStore} />}>
  <Suspense fallback={<TodoLoading /> }>
    <FederatedTodoScreen store={todoStore} releaseId={releaseId} />
  </Suspense>
</RemoteErrorBoundary>
```

O Error Boundary deve registrar `releaseId`, plataforma, fase (`manifest`, `download`, `evaluate`, `render`) e erro sanitizado, oferecer retry limitado e então permanecer na tela local. Não envie dados de tarefas pessoais em telemetria.

## Passo 7 — Isolamento de falha, rollout e rollback

- Cada tela/feature remota fica atrás de boundary próprio; erro no Todo não desmonta navegação ou outras funções do host.
- Carregue o manifesto com timeout e valide schema/assinatura antes de usar URLs. Um manifesto inválido significa usar configuração local embarcada.
- Registre em armazenamento local o último release conhecido como bom. Se o novo release falhar ao carregar, marque-o como bad para a sessão e tente o release anterior compatível; se falhar, use fallback local.
- Faça rollout por canal (dev → staging → produção) e percentual/segmento. Mantenha a versão anterior e assets no CDN durante a janela de rollback.
- Rollback operacional: reverter o ponteiro do manifesto para o release imutável anterior. Não sobrescrever diretórios/version IDs publicados. Os clientes já em execução podem manter o módulo na memória até reiniciar a feature/app.
- Se o remote muda contrato ou API nativa necessária, publique uma versão nova do host; rollback de JS não substitui rollback de binário.

## Passo 8 — Testar antes da CDN

Execute manualmente em iOS e Android, development e release, com rede normal e modo avião. O usuário pediu a implementação ponta a ponta; nesta fase do guia, critérios são:

1. Host local abre e CRUD Todo funciona sem rede.
2. Remote local é carregado em ambos sistemas com o mesmo store/contexto: adicionar item no remote atualiza a visão host e vice-versa.
3. Duas chamadas concorrentes ao loader resultam em uma carga; toques concorrentes não perdem updates.
4. Versão incompatível, entry 404, timeout, erro ao avaliar e erro de render exibem fallback local e telemetria identificável.
5. Trocar o manifesto de release novo para release anterior reverte o remote sem reinstalar binário.
6. Build remoto não importa módulos nativos que o host não inclua; verifique árvore de dependências e bundle por plataforma.

Não publique para usuários reais até o ciclo acima funcionar com bundle local/ambiente de staging. A CDN é uma mudança de origem do artefato, não substitui essa matriz de validação.

## Passo 9 — Publicar remote em CDN (etapa final)

1. Construa remote separadamente para cada plataforma/engine e gere entry, chunks, assets, metadados, sourcemaps privados e checksums. Use o comando documentado pelo Re.Pack para o alvo escolhido.
2. Publique em caminho imutável, por exemplo `todo/android/1.4.2/` e `todo/ios/1.4.2/`. Configure MIME types e CORS se aplicável ao runtime; valide TLS, cache e URLs a partir de dispositivos reais. Re.Pack suporta divisão/carregamento de bundles remotos, mas formato e configuração de deploy dependem do runtime e versão usados. [Re.Pack](https://re-pack.dev/)
3. Configure cache longo para arquivos versionados (`immutable`) e cache curto para manifesto. Entry e chunks da mesma release devem permanecer juntos; não sobrescreva arquivos publicados.
4. O manifesto deve apontar a URL correta para a plataforma, canal e versão de host. Assine/verifique manifesto e artefatos se o runtime/pipeline oferecer suporte; caso contrário, valide hash obtido por canal autenticado e use HTTPS.
5. Comece em ambiente interno, depois staging e rollout pequeno. Observe sucesso de download, compatibilidade, render, tempo de carga e taxa de fallback por release. Reverta o manifesto se ultrapassar os limites definidos.

**Resultado esperado:** o host inicializa localmente, consulta manifesto, escolhe versão compatível, baixa o remote da CDN, injeta o store do host e renderiza a tela; qualquer falha retorna ao Todo local e permite rollback pelo manifesto.

## Fontes primárias

- [Re.Pack quick start](https://re-pack.dev/docs/getting-started/quick-start) — requisitos e modo de uso.
- [Re.Pack](https://re-pack.dev/) — bundler React Native e Module Federation v2.
- [Guia Expo: New Architecture](https://docs.expo.dev/guides/new-architecture/) — arquitetura e suporte Expo/RN por SDK.
- [Issue Re.Pack #1396 sobre Expo](https://github.com/callstack/repack/issues/1396) — discussão de integração Expo; issue não é contrato oficial de suporte.

