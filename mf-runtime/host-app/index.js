import { Platform } from 'react-native';
import { registerRootComponent } from 'expo';
import { Federated, Script, ScriptManager } from '@callstack/repack/client';

import App from './App';

const remoteHost = Platform.OS === 'android' ? '10.0.2.2' : 'localhost';
const resolveURL = Federated.createURLResolver({
  containers: {
    products: `http://${remoteHost}:9000/[name][ext]`,
  },
});

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
