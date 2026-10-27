import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as Repack from '@callstack/repack';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export default Repack.defineRspackConfig({
  context: __dirname,
  entry: './index.ts',
  resolve: {
    ...Repack.getResolveOptions({ enablePackageExports: true }),
    alias: {
      '@todo-mf/todo-contract': path.resolve(__dirname, '../../packages/todo-contract'),
    },
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
    new Repack.plugins.ModuleFederationPluginV2({
      name: 'todo_remote',
      // Tem que bater com o entry do release/manifest.dev.json.
      filename: 'todo_remote.container.js.bundle',
      dts: false,
      exposes: {
        './TodoScreen': './src/TodoScreen',
        './TodoWidget': './src/TodoWidget',
      },
      shared: {
        // eager: false → usa as cópias que o host já colocou no share scope.
        react: { singleton: true, eager: false, requiredVersion: '19.2.3' },
        'react-native': { singleton: true, eager: false, requiredVersion: '0.86.3' },
      },
    }),
  ],
});
