# Module Federation Playground

## Arquitetura atual

O `host-app` inicia na porta `8081` e carrega o componente `ProductCard` exposto pelo `products-remote`, que inicia na porta `9000`. Ambos usam Module Federation v2 do Re.Pack e compartilham `react` e `react-native` como singletons.

```mermaid
flowchart TD
    subgraph H["Host — host-app"]
        H1["npm start — porta 8081"]
        H2["RNC CLI + Re.Pack/Rspack"]
        H3["index.js → App.tsx"]
        H4["App.tsx carrega products/ProductCard"]
        H1 --> H2 --> H3 --> H4
    end

    subgraph R["Remote — products-remote"]
        R1["npm start — porta 9000"]
        R2["RNC CLI + Re.Pack/Rspack"]
        R3["index.js → App.tsx"]
        R4["expõe ./ProductCard"]
        R1 --> R2 --> R3
        R2 --> R4
    end

    H4 --> R4
    S["Shared singletons: react 19.2.3 + react-native 0.86.3"]
    H4 -. "consome" .-> S
    R4 -. "compartilha" .-> S
```

O host resolve o bundle do remote por `ScriptManager`; no emulador Android, o endereço usa `10.0.2.2` para alcançar a máquina de desenvolvimento. O remote também mantém seu `App.tsx` para execução independente.

### Configuração das dependências compartilhadas

Este bloco está nos dois arquivos `rspack.config.mjs`:

```js
shared: {
  react: { singleton: true, eager: true, requiredVersion: '19.2.3' },
  'react-native': {
    singleton: true,
    eager: true,
    requiredVersion: '0.86.3',
  },
}
```
