import { lazy, Suspense, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Button, StyleSheet, Text, View } from 'react-native';

import { loadTodoScreen } from '../federation/loadTodoScreen';
import { RemoteErrorBoundary } from '../federation/RemoteErrorBoundary';
import { phaseOf, RemoteLoadError } from '../federation/RemoteLoadError';
import { reportRemoteFallback } from '../federation/telemetry';
import { assertCompatible } from '../release/compatibility';
import { loadReleaseManifest, resolveRemote } from '../release/manifest';
import { useTodoStore } from '../store/TodoStoreContext';
import { LocalTodoScreen } from './LocalTodoScreen';

const MAX_RETRIES = 2;

export function TodoScreen() {
  const store = useTodoStore();
  const [attempt, setAttempt] = useState(0);
  const releaseIdRef = useRef<string | undefined>(undefined);

  // React.lazy guarda o resultado (inclusive a rejeição) para sempre;
  // por isso criamos um lazy novo a cada tentativa.
  const RemoteTodo = useMemo(
    () =>
      lazy(async () => {
        const release = resolveRemote(await loadReleaseManifest(), 'todo');
        releaseIdRef.current = release.releaseId;
        assertCompatible(release);
        const Component = await loadTodoScreen(release);
        return { default: () => <Component store={store} releaseId={release.releaseId} /> };
      }),
    [attempt, store],
  );

  return (
    <RemoteErrorBoundary
      key={attempt} // trocar a key remonta o boundary = limpa o erro
      onError={(error) =>
        reportRemoteFallback({ remote: 'todo', releaseId: releaseIdRef.current, phase: phaseOf(error), error })
      }
      fallback={(error) => {
        const retryable = !(error instanceof RemoteLoadError) || error.retryable;
        const canRetry = retryable && attempt < MAX_RETRIES;
        return (
          <LocalTodoScreen
            store={store}
            banner={
              <View style={styles.banner}>
                <Text style={styles.bannerText}>Versão local (remote indisponível)</Text>
                {canRetry && <Button title="Tentar novamente" onPress={() => setAttempt((n) => n + 1)} />}
              </View>
            }
          />
        );
      }}
    >
      <Suspense fallback={<ActivityIndicator style={styles.loading} />}>
        <RemoteTodo />
      </Suspense>
    </RemoteErrorBoundary>
  );
}

const styles = StyleSheet.create({
  loading: { flex: 1 },
  banner: { backgroundColor: '#fff8c5', padding: 12, gap: 8 },
  bannerText: { color: '#6b5900' },
});
