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

// Host fixo: não depende do RN/React que o ambiente de teste resolve.
const host = { ...hostInfo, react: '19.2.3', reactNative: '0.86.3' };

test('o manifesto dev é válido', () => {
  expect(() => parseManifest(devManifest)).not.toThrow();
});

test('manifesto com schema errado é recusado', () => {
  expect(() => parseManifest({ ...devManifest, schema: 2 })).toThrow(/invalid schema/);
});

// O Jest roda com __RELEASE_CHANNEL__ = 'dev' (package.json > jest.globals).
test.each([
  ['staging', stagingManifest],
  ['production', prodManifest],
])('manifesto de %s é recusado no canal dev', (_channel, manifest) => {
  expect(() => parseManifest(manifest)).toThrow(expect.objectContaining({ phase: 'manifest' }));
  expect(() => parseManifest(manifest)).toThrow(/channel/);
});

test('manifestos de staging e produção nascem desligados', () => {
  expect(stagingManifest.remotes.todo.enabled).toBe(false);
  expect(prodManifest.remotes.todo.enabled).toBe(false);
});

test('remote do manifesto dev é compatível com o host', () => {
  expect(() => assertCompatible(remote({}), host)).not.toThrow();
});

test.each([
  [{ react: '19.2.4' }],
  [{ contract: '2.0.0' }],
  [{ runtimeApi: 2 }],
  [{ minHostVersion: '9.0.0' }],
  [{ maxHostVersionExclusive: '1.0.0' }],
])('incompatível: %o', (overrides) => {
  expect(() => assertCompatible(remote(overrides), host)).toThrow(
    expect.objectContaining({ phase: 'compatibility' }),
  );
});
