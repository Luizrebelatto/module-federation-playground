import { assertCompatible } from '../release/compatibility';
import { loadReleaseManifest, resolveRemote } from '../release/manifest';
import { loadTodoScreen } from './loadTodoScreen';

export async function preloadTodoScreen() {
  try {
    const release = resolveRemote(await loadReleaseManifest(), 'todo');
    assertCompatible(release);
    await loadTodoScreen(release);
  } catch {}
}
