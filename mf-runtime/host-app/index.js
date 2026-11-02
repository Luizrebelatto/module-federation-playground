import { Platform } from 'react-native';
import { registerRootComponent } from 'expo';
import { Federated, Script, ScriptManager } from '@callstack/repack/client';

import App from './App';
import manifest from './manifest.json';

const HOST_CONTRACT = {
  runtimeApi: 1,
  react: '19.2.3',
  reactNative: '0.86.3',
};

const platform = Platform.OS === 'android' ? 'android' : 'ios';

function isCompatible(name, compatibility) {
  const mismatches = [
    ['runtimeApi', compatibility.runtimeApi, HOST_CONTRACT.runtimeApi],
    ['react', compatibility.react, HOST_CONTRACT.react],
    ['react-native', compatibility.reactNative, HOST_CONTRACT.reactNative],
  ].filter(([, remote, host]) => remote !== host);

  if (mismatches.length > 0) {
    const detail = mismatches.map(([k, r, h]) => `${k} ${r} != ${h}`).join(', ');
    console.warn(`[manifest] remote "${name}" ignorado — incompatível: ${detail}`);
    return false;
  }
  return true;
}

const containers = Object.fromEntries(
  Object.entries(manifest.remotes)
    .filter(([name, remote]) => {
      if (!remote.enabled) {
        console.warn(`[manifest] remote "${name}" está desativado (enabled: false)`);
        return false;
      }
      return isCompatible(name, remote.compatibility);
    })
    .map(([name, remote]) => {
      const entry = remote.entries[platform] ?? remote.entries.ios;
      const baseUrl = entry.slice(0, entry.lastIndexOf('/'));
      return [name, `${baseUrl}/[name][ext]`];
    }),
);

const resolveURL = Federated.createURLResolver({ containers });

ScriptManager.shared.addResolver(async (scriptId, caller) => {
  const url =
    caller === 'main'
      ? Script.getDevServerURL(scriptId)
      : resolveURL(scriptId, caller);

  if (!url) {
    return undefined;
  }

  return {
    url,
    cache: false,
    query: { platform: Platform.OS },
  };
});

// registerRootComponent calls AppRegistry.registerComponent('main', () => App);
// It also ensures that whether you load the app in Expo Go or in a native build,
// the environment is set up appropriately
registerRootComponent(App);
