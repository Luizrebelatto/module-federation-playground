import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as Repack from '@callstack/repack';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export default Repack.defineRspackConfig({
  context: __dirname,
  entry: './index.js',
  resolve: {
    ...Repack.getResolveOptions({ enablePackageExports: true }),
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
      name: 'profile',

      filename: 'profile.container.js.bundle',

      exposes: {
        './ProfileComponent': './src/profileComponent.tsx',
      },

      dts: false,

      shared: {
        react: {
          singleton: true,
          eager: false,
        },

        'react-native': {
          singleton: true,
          eager: false,
        },
      },
    }),
  ],
});



