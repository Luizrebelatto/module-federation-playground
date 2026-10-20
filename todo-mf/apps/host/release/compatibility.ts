// apps/host/release/compatibility.ts
import { version as reactVersion } from 'react';
import { Platform } from 'react-native';
import { CONTRACT_VERSION } from '@todo-mf/packages';

import appConfig from '../app.json';
import { RemoteLoadError } from '../federation/RemoteLoadError';
import type { ResolvedRemote } from './manifest';

/** Versão da API de runtime que este binário host oferece aos remotes. */
export const HOST_RUNTIME_API = 1;

const { major, minor, patch } = Platform.constants.reactNativeVersion;

export const hostInfo = {
  version: appConfig.expo.version,
  runtimeApi: HOST_RUNTIME_API,
  contract: CONTRACT_VERSION,
  react: reactVersion,
  reactNative: `${major}.${minor}.${patch}`,
};

function compareVersions(a: string, b: string) {
  const pa = a.split('.').map(Number);
  const pb = b.split('.').map(Number);
  for (let i = 0; i < 3; i++) {
    const diff = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

const majorOf = (version: string) => version.split('.')[0];

export function assertCompatible(remote: ResolvedRemote, host = hostInfo) {
  const c = remote.compatibility;
  const problems: string[] = [];

  if (c.runtimeApi !== host.runtimeApi) problems.push(`runtimeApi ${c.runtimeApi} != ${host.runtimeApi}`);
  if (majorOf(c.contract) !== majorOf(host.contract)) problems.push(`contract ${c.contract} vs ${host.contract}`);
  if (c.react !== host.react) problems.push(`react ${c.react} != ${host.react}`);
  if (c.reactNative !== host.reactNative) problems.push(`react-native ${c.reactNative} != ${host.reactNative}`);
  if (compareVersions(host.version, c.minHostVersion) < 0) problems.push(`host ${host.version} < ${c.minHostVersion}`);
  if (compareVersions(host.version, c.maxHostVersionExclusive) >= 0)
    problems.push(`host ${host.version} >= ${c.maxHostVersionExclusive}`);

  if (problems.length > 0) {
    throw new RemoteLoadError('compatibility', `Remote ${remote.releaseId} incompatible: ${problems.join('; ')}`);
  }
}