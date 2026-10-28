import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as Repack from '@callstack/repack';
import { ExpoModulesPlugin } from "@callstack/repack-plugin-expo-modules";
import { DefinePlugin } from '@rspack/core';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Canal de release embutido no bundle. Um valor inválido quebra o build em vez de gerar um app sem manifesto.
const RELEASE_CHANNEL = process.env.RELEASE_CHANNEL ?? 'dev';
if (!['dev', 'staging', 'production'].includes(RELEASE_CHANNEL)) {
  throw new Error(`RELEASE_CHANNEL inválido: "${RELEASE_CHANNEL}" (use dev, staging ou production)`);
}

export default Repack.defineRspackConfig({
  context: __dirname,
  entry: './index.ts',
  resolve: {
    ...Repack.getResolveOptions({ enablePackageExports: true }),
    alias: {
      '@todo-mf/todo-contract': path.resolve(__dirname, "../../packages/todo-contract")
    }
  },
  module: {
    rules: [
      {
        test: /\.[cm]?[jt]sx?$/,
        type: 'javascript/auto',
        use: {
          loader: '@callstack/repack/babel-swc-loader',
          parallel: true,
          options: {},
        },
      },
      ...Repack.getAssetTransformRules(),
    ],
  },
  plugins: [
    new Repack.RepackPlugin(),
    new ExpoModulesPlugin(),
    new DefinePlugin({
      __RELEASE_CHANNEL__: JSON.stringify(RELEASE_CHANNEL),
    }),
    new Repack.plugins.ModuleFederationPluginV2({
      name: 'host',
      dts: false,
      shared: {
        react: { singleton: true, eager: true, requiredVersion: '19.2.3' },
        'react-native': { singleton: true, eager: true, requiredVersion: '0.86.3' },
      },
    }),
  ],
});
