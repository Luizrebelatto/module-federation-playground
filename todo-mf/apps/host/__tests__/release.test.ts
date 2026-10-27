import { assertCompatible, hostInfo } from '../release/compatibility';
import { parseManifest, type ResolvedRemote } from '../release/manifest';
import devManifest from '../../../release/manifest.dev.json';

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
