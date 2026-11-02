import { assertCompatible, hostInfo } from '../release/compatibility';
import { parseManifest, type ResolvedRemote } from '../release/manifest';
import devManifest from '../../../release/manifest.dev.json';
import prodManifest from '../../../release/manifest.prod.json';
import stagingManifest from '../../../release/manifest.staging.json';

const remote = (overrides: Partial<ResolvedRemote['compatibility']>): ResolvedRemote => ({
  name: 'todo',
  enabled: true,
  container: 'todo_remote',
  releaseId: 'r1',
  entry: 'http://x',
  compatibility: { ...devManifest.remotes.todo.compatibility, ...overrides },
});

const host = { ...hostInfo, react: '19.2.3', reactNative: '0.86.3' };

test('the dev manifest is valid', () => {
  expect(() => parseManifest(devManifest)).not.toThrow();
});

test('a manifest with the wrong schema is rejected', () => {
  expect(() => parseManifest({ ...devManifest, schema: 2 })).toThrow(/invalid schema/);
});

test.each([
  ['staging', stagingManifest],
  ['production', prodManifest],
])('a %s manifest is rejected on the dev channel', (_channel, manifest) => {
  expect(() => parseManifest(manifest)).toThrow(expect.objectContaining({ phase: 'manifest' }));
  expect(() => parseManifest(manifest)).toThrow(/channel/);
});

test('staging and production manifests start disabled', () => {
  expect(stagingManifest.remotes.todo.enabled).toBe(false);
  expect(prodManifest.remotes.todo.enabled).toBe(false);
});

test('the dev manifest remote is compatible with the host', () => {
  expect(() => assertCompatible(remote({}), host)).not.toThrow();
});

test.each([
  [{ react: '19.2.4' }],
  [{ contract: '2.0.0' }],
  [{ runtimeApi: 2 }],
  [{ minHostVersion: '9.0.0' }],
  [{ maxHostVersionExclusive: '1.0.0' }],
])('incompatible: %o', (overrides) => {
  expect(() => assertCompatible(remote(overrides), host)).toThrow(
    expect.objectContaining({ phase: 'compatibility' }),
  );
});
