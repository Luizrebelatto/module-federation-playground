jest.mock('@module-federation/enhanced/runtime', () => ({
  registerRemotes: jest.fn(),
  loadRemote: jest.fn(),
}));

import { loadRemote } from '@module-federation/enhanced/runtime';
import { loadTodoScreen } from '../federation/loadTodoScreen';
import type { ResolvedRemote } from '../release/manifest';

const mockedLoadRemote = loadRemote as jest.Mock;

const release = (releaseId: string): ResolvedRemote => ({
  name: 'todo',
  enabled: true,
  container: 'todo_remote',
  releaseId,
  entry: `http://cdn.test/${releaseId}/todo_remote.container.js.bundle`,
  compatibility: {
    runtimeApi: 1,
    contract: '1.0.0',
    react: '19.2.3',
    reactNative: '0.86.3',
    minHostVersion: '1.0.0',
    maxHostVersionExclusive: '2.0.0',
  },
});

beforeEach(() => mockedLoadRemote.mockReset());

test('two concurrent calls trigger a single load', async () => {
  mockedLoadRemote.mockResolvedValue({ default: () => null });
  const [a, b] = await Promise.all([loadTodoScreen(release('r1')), loadTodoScreen(release('r1'))]);
  expect(mockedLoadRemote).toHaveBeenCalledTimes(1);
  expect(a).toBe(b);
});

test('a failure is not cached: the next call tries again', async () => {
  mockedLoadRemote.mockRejectedValueOnce(new Error('network')).mockResolvedValueOnce({ default: () => null });
  await expect(loadTodoScreen(release('r2'))).rejects.toMatchObject({ phase: 'load' });
  await expect(loadTodoScreen(release('r2'))).resolves.toBeDefined();
  expect(mockedLoadRemote).toHaveBeenCalledTimes(2);
});

test('a module without a default becomes a load error', async () => {
  mockedLoadRemote.mockResolvedValue({});
  await expect(loadTodoScreen(release('r3'))).rejects.toMatchObject({ phase: 'load' });
});
