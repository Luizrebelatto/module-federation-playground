import path from 'node:path';
import {fileURLToPath} from 'node:url';

import * as Repack from '@callstack/repack';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PROFILE_REMOTE_PORT = 9000;

export default Repack.defineRspackConfig((env) => ({
  context: __dirname,

  entry: './index.js',

  resolve: {
    ...Repack.getResolveOptions(),
  },

  output: {
    uniqueName: 'host',
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
      name: 'host',

      dts: false,

      remotes: {
        profile:
          `profile@http://localhost:${PROFILE_REMOTE_PORT}/${env.platform}/mf-manifest.json`,
      },

      shared: {
        react: {
          singleton: true,
          eager: true,
        },

        'react-native': {
          singleton: true,
          eager: true,
        },
      },
    }),
  ],
}));