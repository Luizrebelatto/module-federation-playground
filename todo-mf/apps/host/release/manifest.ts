import { Platform } from 'react-native';

import devManifest from '../../../release/manifest.dev.json';
import prodManifest from '../../../release/manifest.prod.json';
import stagingManifest from '../../../release/manifest.staging.json';
import { RemoteLoadError } from '../federation/RemoteLoadError';
import { DEV_DASHBOARD_URL } from './devDashboard';

export type RemoteCompatibility = {
  runtimeApi: number;
  contract: string;
  react: string;
  reactNative: string;
  minHostVersion: string;
  maxHostVersionExclusive: string;
};

export type RemoteRelease = {
  enabled: boolean;
  container: string;
  releaseId: string;
  entries: Partial<Record<'ios' | 'android', string>>;
  compatibility: RemoteCompatibility;
};

export type ReleaseManifest = {
  schema: 1;
  channel: string;
  remotes: Record<string, RemoteRelease>;
};

export type ResolvedRemote = Omit<RemoteRelease, 'entries'> & { name: string; entry: string };

// CloudFront na frente do bucket S3 (privado, acesso via OAC). Layout do bucket: Fase 9 do apps/README.md.
const CDN_BASE_URL = 'https://d2agf17ues9yij.cloudfront.net/todo-mf';

// Cada canal tem a URL do manifesto remoto e o manifesto embarcado usado quando o remoto falha.
// Em dev, o dashboard de cenários entrega o manifesto; sem ele, vale o embarcado.
const CHANNELS = {
  dev: {
    url: DEV_DASHBOARD_URL && `${DEV_DASHBOARD_URL}/manifest.json?platform=${Platform.OS}`,
    embedded: devManifest,
  },
  staging: { url: `${CDN_BASE_URL}/manifests/staging.json`, embedded: stagingManifest },
  production: { url: `${CDN_BASE_URL}/manifests/production.json`, embedded: prodManifest },
} as const;

const { url: MANIFEST_URL, embedded: embeddedManifest } = CHANNELS[__RELEASE_CHANNEL__];
const MANIFEST_TIMEOUT_MS = 3000;

const isString = (value: unknown): value is string => typeof value === 'string';

function isRemoteRelease(value: unknown): value is RemoteRelease {
  if (typeof value !== 'object' || value === null) return false;
  const release = value as Record<string, any>;
  const compat = release.compatibility;
  return (
    typeof release.enabled === 'boolean' &&
    isString(release.container) &&
    isString(release.releaseId) &&
    typeof release.entries === 'object' &&
    release.entries !== null &&
    typeof compat === 'object' &&
    compat !== null &&
    typeof compat.runtimeApi === 'number' &&
    [compat.contract, compat.react, compat.reactNative, compat.minHostVersion, compat.maxHostVersionExclusive].every(isString)
  );
}

export function parseManifest(value: unknown): ReleaseManifest {
  const manifest = value as Partial<ReleaseManifest> | null;
  if (
    !manifest ||
    manifest.schema !== 1 ||
    !isString(manifest.channel) ||
    typeof manifest.remotes !== 'object' ||
    manifest.remotes === null ||
    !Object.values(manifest.remotes).every(isRemoteRelease)
  ) {
    throw new RemoteLoadError('manifest', 'Release manifest has an invalid schema');
  }
  // Manifesto de outro canal (ex.: staging publicado no caminho de produção) é erro de deploy.
  if (manifest.channel !== __RELEASE_CHANNEL__) {
    throw new RemoteLoadError('manifest', `Manifest channel ${manifest.channel} != ${__RELEASE_CHANNEL__}`);
  }
  return manifest as ReleaseManifest;
}

async function fetchManifest(url: string): Promise<ReleaseManifest> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), MANIFEST_TIMEOUT_MS);
  try {
    const response = await fetch(url, { signal: controller.signal });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return parseManifest(await response.json());
  } finally {
    clearTimeout(timer);
  }
}

let manifestPromise: Promise<ReleaseManifest> | null = null;

export function loadReleaseManifest(): Promise<ReleaseManifest> {
  manifestPromise ??= (async () => {
    if (MANIFEST_URL) {
      try {
        return await fetchManifest(MANIFEST_URL);
      } catch (error) {
        console.warn('[release] remote manifest unavailable, using embedded one', error);
      }
    }
    return parseManifest(embeddedManifest);
  })();
  return manifestPromise;
}

export function resolveRemote(manifest: ReleaseManifest, name: string): ResolvedRemote {
  const release = manifest.remotes[name];
  if (!release) throw new RemoteLoadError('manifest', `Remote "${name}" is not in the manifest`);
  if (!release.enabled) throw new RemoteLoadError('manifest', `Remote "${name}" is disabled`);

  const entry = release.entries[Platform.OS as 'ios' | 'android'];
  if (!entry) throw new RemoteLoadError('manifest', `Remote "${name}" has no entry for ${Platform.OS}`);

  const { entries: _entries, ...rest } = release;
  return { ...rest, name, entry };
}