# Arquitetura — todo-mf

App de tarefas em React Native (Expo + Re.Pack) dividido em **host** e **remote** com Module Federation v2. O host é o app instalado pela loja. O remote `todo` é código JavaScript baixado em runtime. Se o remote falhar, o host mostra uma tela Todo própria. Um **manifesto por canal** (dev / staging / produção), servido por uma **CDN** (S3 + CloudFront), decide qual versão do remote cada app carrega.

> O plano completo, passo a passo, está em [`README.md`](./README.md) e [`apps/README.md`](./apps/README.md). Este documento descreve **como as peças se encaixam**.

> **Diagramas:** os blocos `mermaid` aparecem renderizados no GitHub. Para editar no Excalidraw: **More tools → Mermaid to Excalidraw**, e cole o conteúdo do bloco.

---

## 1. Visão geral do sistema

```mermaid
flowchart LR
  subgraph Device["📱 Aparelho (iOS / Android)"]
    Host["Host app<br/>binário da loja<br/>React, React Native, Store"]
  end

  subgraph Dev["💻 Máquina de dev"]
    RemoteDev["todo-remote dev server<br/>:9000"]
    Dashboard["Dashboard de cenários<br/>:4000"]
  end

  subgraph AWS["☁️ AWS"]
    CF["CloudFront<br/>d2agf17ues9yij.cloudfront.net"]
    S3[("S3 privado<br/>todo-mf/")]
    CF -- "OAC" --> S3
  end

  Host -- "manifesto dev" --> Dashboard
  Host -- "telemetria dev" --> Dashboard
  Host -- "bundle do remote (dev)" --> RemoteDev
  Host -- "manifesto staging / produção" --> CF
  Host -. "bundle do remote (Fase 9)" .-> CF
```

| Peça | Onde | Papel |
|---|---|---|
| **Host** | `apps/host` | App instalado. Cria o store, a navegação e a tela Todo local de fallback. Lê o manifesto, checa compatibilidade e carrega o remote. |
| **Remote `todo`** | `apps/todo-remote` | Container MF `todo_remote` que expõe `./TodoScreen` e `./TodoWidget`. Não tem estado próprio: recebe o store por props. |
| **Contrato** | `packages/todo-contract` | Tipos `Todo`, `TodoStore` e `TodoRemoteProps`, mais `CONTRACT_VERSION`. É a única coisa que host e remote compartilham em código. |
| **Manifestos** | `release/manifest.*.json` | Dizem, por canal, se o remote está ligado, a URL do bundle por plataforma e as regras de compatibilidade. |
| **CDN** | AWS S3 + CloudFront | Serve os manifestos de staging e produção (hoje) e os bundles do remote (Fase 9). |
| **Dashboard de cenários** | repo `test-module-federation` (porta 4000) | Só em dev. Serve um manifesto alterado por cenário (falhas simuladas) e recebe a telemetria. |

---

## 2. Estrutura do repositório

```text
todo-mf/
├── apps/
│   ├── host/                       # app Expo + Re.Pack (o binário da loja)
│   │   ├── App.tsx                 # cria o TodoStore e monta Provider + navegação
│   │   ├── navigation/             # stack: Home, Todo (remote), LocalTodo
│   │   ├── screens/                # HomeScreen, TodoScreen (federada), LocalTodoScreen (fallback)
│   │   ├── store/                  # todoStore (zustand vanilla, escrita serializada) + Context
│   │   ├── federation/             # loader MF, Error Boundary, erros por fase, telemetria, preload
│   │   ├── release/                # manifesto por canal, compatibilidade, URL do dashboard
│   │   ├── rspack.config.mjs       # MF host + DefinePlugin(__RELEASE_CHANNEL__)
│   │   └── __tests__/              # store, loader, manifesto e compatibilidade
│   └── todo-remote/                # container MF "todo_remote"
│       ├── src/TodoScreen.tsx      # tela completa
│       ├── src/TodoWidget.tsx      # badge da Home
│       └── rspack.config.mjs       # exposes + shared (react, react-native)
├── packages/
│   └── todo-contract/              # tipos + CONTRACT_VERSION
└── release/
    ├── manifest.dev.json           # aponta para localhost:9000
    ├── manifest.staging.json       # embarcado de staging (enabled: false)
    ├── manifest.prod.json          # embarcado de produção (enabled: false)
    ├── publish-manifest.sh         # valida e publica o manifesto no S3
    ├── cdn.env.example             # modelo do destino da CDN
    └── cdn.env                     # bucket/conta reais (não commitado)
```

---

## 3. Dentro do host

```mermaid
flowchart TB
  App["App.tsx<br/>createTodoStore()"] --> Provider["TodoStoreProvider"]
  Provider --> Nav["AppNavigation"]

  Nav --> Home["HomeScreen"]
  Nav --> TodoScreen["TodoScreen<br/>remote com fallback"]
  Nav --> LocalRoute["LocalTodo<br/>sempre local"]

  Home --> Widget["FederatedTodoWidget<br/>falhou → some"]
  Home --> Preload["preloadTodoScreen<br/>esquenta o cache"]

  subgraph Release["release/"]
    Manifest["manifest.ts<br/>loadReleaseManifest + resolveRemote"]
    Compat["compatibility.ts<br/>assertCompatible"]
  end

  subgraph Federation["federation/"]
    Loader["loadTodoScreen.ts<br/>registerRemotes + loadRemote<br/>dedupe + timeout"]
    Boundary["RemoteErrorBoundary"]
    Telemetry["telemetry.ts<br/>reportRemoteFallback"]
  end

  TodoScreen --> Manifest --> Compat --> Loader
  Widget --> Manifest
  Preload --> Manifest
  TodoScreen --> Boundary
  Boundary -- "erro" --> Fallback["LocalTodoScreen<br/>+ banner + Tentar novamente"]
  Boundary -- "erro" --> Telemetry
```

### Estado compartilhado
- O **store é criado uma vez no host** (`App.tsx`) e vive fora do React. Host e remote usam **a mesma instância**.
- O remote recebe o store **por props** (`TodoRemoteProps`), não por Context. Assim, uma cópia diferente de React/Context do lado do remote não quebra nada.
- Leitura: `useSyncExternalStore(store.subscribe, store.getSnapshot)`, igual no host e no remote.
- Escrita: `add`, `toggle` e `remove` passam por uma **fila de Promises**. Toques concorrentes nunca sobrescrevem um ao outro.
- Ainda é só memória: a persistência é a Fase 4.

### Dependências compartilhadas (share scope do MF)
| Lib | Host | Remote |
|---|---|---|
| `react` 19.2.3 | `singleton`, `eager: true` (fornece) | `singleton`, `eager: false` (usa a do host) |
| `react-native` 0.86.3 | `singleton`, `eager: true` | `singleton`, `eager: false` |

Módulo nativo **não** vem pela federação. Se o remote precisar de algo nativo, o host precisa ser publicado na loja antes.

---

## 4. Fluxo ao abrir a tela Todo

```mermaid
sequenceDiagram
  participant U as Usuário
  participant TS as TodoScreen
  participant M as manifest.ts
  participant CDN as CDN / Dashboard
  participant C as compatibility.ts
  participant L as loader MF
  participant R as Remote todo

  U->>TS: abre "Todo"
  TS->>M: loadReleaseManifest()
  M->>CDN: GET manifesto do canal, timeout 3s
  alt baixou e é válido do mesmo canal
    CDN-->>M: manifesto remoto
  else falhou, inválido ou outro canal
    M->>M: usa o manifesto embarcado
  end
  M-->>TS: resolveRemote("todo"): enabled, entry da plataforma
  TS->>C: assertCompatible(release)
  TS->>L: loadTodoScreen(release), timeout 10s
  L->>R: registerRemotes + loadRemote("todo_remote/TodoScreen")
  R-->>L: componente
  L-->>TS: TodoScreen remota
  TS->>R: render com store e releaseId
  Note over TS: qualquer erro → Error Boundary →<br/>LocalTodoScreen + telemetria
```

### Fases de falha
Qualquer erro vira um `RemoteLoadError` com a fase em que aconteceu. A fase decide se o botão "Tentar novamente" aparece (no máximo 2 tentativas).

| Fase | Quando acontece | Retry? |
|---|---|---|
| `manifest` | Remote ausente, `enabled: false`, sem entry para a plataforma, schema inválido | ❌ |
| `compatibility` | `runtimeApi`, major do contrato, React, RN ou versão do host fora da faixa | ❌ |
| `load` | Bundle 404, erro de rede, módulo sem `default` | ✅ |
| `timeout` | Carga do remote acima de 10 s | ✅ |
| `render` | O remote quebrou ao renderizar | ✅ |

Outros pontos do fluxo:
- **Cache do manifesto:** o manifesto é buscado uma vez por execução do app.
- **Dedupe do loader:** pedidos simultâneos para o mesmo `container@releaseId/módulo` compartilham uma Promise.
- **Troca de bundle:** se o manifesto mudar o `entry`, o loader re-registra o container com `force`. É assim que um rollback funciona sem reinstalar o app.

---

## 5. Canais (dev / staging / produção)

O canal é escolhido **no build**: `RELEASE_CHANNEL=staging` vira a constante `__RELEASE_CHANNEL__` (via `DefinePlugin`), que seleciona a URL do manifesto e o manifesto embarcado.

```mermaid
flowchart LR
  Env["RELEASE_CHANNEL<br/>no build"] --> Define["DefinePlugin<br/>__RELEASE_CHANNEL__"]
  Define --> Channels{"CHANNELS"}
  Channels -- dev --> D["URL: dashboard :4000 só em __DEV__<br/>embarcado: manifest.dev.json"]
  Channels -- staging --> S["URL: CDN /manifests/staging.json<br/>embarcado: manifest.staging.json"]
  Channels -- production --> P["URL: CDN /manifests/production.json<br/>embarcado: manifest.prod.json"]
```

| Canal | Manifesto remoto | Manifesto embarcado (se o remoto falhar) |
|---|---|---|
| `dev` | Dashboard de cenários (`localhost:4000` / `10.0.2.2:4000`), só em `__DEV__` | `manifest.dev.json`: remote ligado em `localhost:9000` |
| `staging` | `https://d2agf17ues9yij.cloudfront.net/todo-mf/manifests/staging.json` | `manifest.staging.json`: `enabled: false` |
| `production` | `https://d2agf17ues9yij.cloudfront.net/todo-mf/manifests/production.json` | `manifest.prod.json`: `enabled: false` |

Regras do canal:
- **Manifesto de outro canal é recusado.** Um manifesto de staging publicado no caminho de produção cai no embarcado, em vez de mandar usuários reais para um build de teste.
- **Os embarcados de staging e produção nascem desligados.** Sem CDN, o app usa o Todo local, que é o comportamento seguro.
- **Valor inválido em `RELEASE_CHANNEL` quebra o build.**

---

## 6. CDN (AWS)

```mermaid
flowchart LR
  Dev["publish-manifest.sh<br/>perfil AWS todo-mf"] -- "aws s3 cp<br/>Cache-Control: max-age=60" --> S3
  CI["CI / GitHub Actions<br/>Fase 9"] -. "aws s3 sync<br/>immutable, 1 ano" .-> S3

  subgraph AWS["AWS"]
    S3[("S3 bucket privado<br/>Block Public Access<br/>versionamento ligado")]
    CF["CloudFront<br/>HTTPS + CachingOptimized"]
    CF -- "Origin Access Control" --> S3
  end

  App["📱 Host"] -- "HTTPS" --> CF
```

### Peças
| Peça | Configuração | Por quê |
|---|---|---|
| **S3** | Privado, *Block all public access*, versionamento ligado | Ninguém lê o bucket direto. Um arquivo sobrescrito por engano pode ser recuperado. |
| **OAC** | Só o CloudFront tem permissão de leitura (bucket policy com `cloudfront.amazonaws.com`) | O bucket continua privado. Arquivo inexistente responde **403**, não 404. |
| **CloudFront** | *Redirect HTTP to HTTPS*, cache policy `CachingOptimized`, sem WAF | Entrega HTTPS e cache perto do usuário. O cache respeita o `Cache-Control` de cada arquivo, então nenhuma *invalidation* é necessária. |
| **IAM** | Usuário `todo-mf-cli` com escrita só em `<bucket>/todo-mf/*` | Uma credencial vazada só afeta este prefixo. |

### Layout do bucket
```text
<bucket>/todo-mf/
├── manifests/
│   ├── staging.json            # mutável · Cache-Control: public, max-age=60
│   └── production.json         # mutável · Cache-Control: public, max-age=60
└── todo/                       # Fase 9
    ├── ios/<versão>/todo_remote.container.js.bundle + chunks + assets
    └── android/<versão>/...    # imutável · Cache-Control: public, max-age=31536000, immutable
```

### Regras
- **O manifesto é o único arquivo mutável.** Com cache de 60 s, um rollback ou kill switch chega rápido aos clientes.
- **Bundles ficam em pastas por versão e nunca são sobrescritos.** Versão nova vai para uma pasta nova.
- **O manifesto sobe sempre por último**, depois dos bundles. Assim, nenhum cliente recebe uma URL que ainda não existe.
- **Sourcemaps** vão para um lugar privado, nunca para a CDN pública.

### Publicação dos manifestos
```bash
release/publish-manifest.sh staging                  # manifesto oficial de staging
release/publish-manifest.sh production               # manifesto oficial de produção
release/publish-manifest.sh staging --local-remote   # teste: staging apontando para o remote em localhost
DRY_RUN=1 release/publish-manifest.sh staging        # só valida
```
Antes de subir, o script:
- valida o schema e o canal;
- exige HTTPS nas entries (exceto em `--local-remote`);
- confere se o perfil da CLI está logado na conta certa (`CDN_ACCOUNT_ID`).

O destino fica em `release/cdn.env`, que **não é commitado**, porque o repositório é público.

### Operação
| Ação | Como | Efeito |
|---|---|---|
| **Kill switch** | Publicar o manifesto com `enabled: false` | Todos vão para o Todo local na próxima abertura do app |
| **Rollback** | Publicar o manifesto com o `releaseId`/`entries` da versão anterior | Volta sem passar pela loja. Quem já tem o módulo em memória só troca ao reiniciar. |
| **Rollout %** | `rolloutPercent` + `previous` no manifesto | Fase 6 (ainda não existe) |
| **Mudança de contrato (major) ou módulo nativo novo** | Publicar um host novo na loja e só então subir `minHostVersion` | O manifesto sozinho não resolve |

---



https://github.com/user-attachments/assets/5c3397dd-019b-41f6-9304-60cbb1359fc8


