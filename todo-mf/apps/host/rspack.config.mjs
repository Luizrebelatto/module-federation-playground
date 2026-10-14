import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as Repack from '@callstack/repack';
import { ExpoModulesPlugin } from "@callstack/repack-plugin-expo-modules";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export default Repack.defineRspackConfig({
  context: __dirname,
  entry: './index.ts',
  resolve: {
    ...Repack.getResolveOptions({ enablePackageExports: true }),
    alias: {
      '@todo-mf/packages': path.resolve(__dirname, "../../packages/todo-contract")
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
    new ExpoModulesPlugin()
  ],
});
