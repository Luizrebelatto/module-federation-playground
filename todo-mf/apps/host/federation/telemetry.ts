import { Platform } from 'react-native';

import type { RemotePhase } from './RemoteLoadError';

export type RemoteFallbackEvent = {
  remote: string;
  releaseId: string | undefined;
  phase: RemotePhase;
  error: unknown;
};

// Só nome + mensagem truncada: nunca enviar conteúdo das tarefas do usuário.
function sanitize(error: unknown) {
  if (error instanceof Error) return { name: error.name, message: error.message.slice(0, 200) };
  return { name: 'UnknownError', message: String(error).slice(0, 200) };
}

/** Ponto único de telemetria; troque o console por Sentry/Datadog/etc. depois. */
export function reportRemoteFallback({ remote, releaseId, phase, error }: RemoteFallbackEvent) {
  console.warn('[remote_fallback]', { remote, releaseId, phase, platform: Platform.OS, error: sanitize(error) });
}
