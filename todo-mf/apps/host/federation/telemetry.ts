import { Platform } from 'react-native';

import { DEV_DASHBOARD_URL } from '../release/devDashboard';
import type { RemotePhase } from './RemoteLoadError';

export type RemoteFallbackEvent = {
  remote: string;
  releaseId: string | undefined;
  phase: RemotePhase;
  error: unknown;
};

function sanitize(error: unknown) {
  if (error instanceof Error) return { name: error.name, message: error.message.slice(0, 200) };
  return { name: 'UnknownError', message: String(error).slice(0, 200) };
}

export function reportRemoteFallback({ remote, releaseId, phase, error }: RemoteFallbackEvent) {
  const event = { remote, releaseId, phase, platform: Platform.OS, error: sanitize(error) };
  console.warn('[remote_fallback]', event);
  forwardToDevDashboard(event);
}

function forwardToDevDashboard(event: object) {
  if (!DEV_DASHBOARD_URL) return;
  fetch(`${DEV_DASHBOARD_URL}/api/telemetry`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(event),
  }).catch(() => undefined);
}
