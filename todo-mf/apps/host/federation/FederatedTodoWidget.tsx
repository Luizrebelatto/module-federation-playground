import { lazy, Suspense, useMemo, useRef } from 'react';

import { assertCompatible } from '../release/compatibility';
import { loadReleaseManifest, resolveRemote } from '../release/manifest';
import { useTodoStore } from '../store/TodoStoreContext';
import { loadTodoModule } from './loadTodoScreen';
import { RemoteErrorBoundary } from './RemoteErrorBoundary';
import { phaseOf } from './RemoteLoadError';
import { reportRemoteFallback } from './telemetry';

/** Widget remoto opcional: se qualquer fase falhar, ele simplesmente não aparece. */
export function FederatedTodoWidget() {
  const store = useTodoStore();
  const releaseIdRef = useRef<string | undefined>(undefined);

  const RemoteWidget = useMemo(
    () =>
      lazy(async () => {
        const release = resolveRemote(await loadReleaseManifest(), 'todo');
        releaseIdRef.current = release.releaseId;
        assertCompatible(release);
        const Component = await loadTodoModule(release, 'TodoWidget');
        return { default: () => <Component store={store} releaseId={release.releaseId} /> };
      }),
    [store],
  );

  return (
    <RemoteErrorBoundary
      onError={(error) =>
        reportRemoteFallback({
          remote: 'todo/TodoWidget',
          releaseId: releaseIdRef.current,
          phase: phaseOf(error),
          error,
        })
      }
      fallback={() => null}
    >
      <Suspense fallback={null}>
        <RemoteWidget />
      </Suspense>
    </RemoteErrorBoundary>
  );
}
