export type RemotePhase = 'manifest' | 'compatibility' | 'load' | 'timeout' | 'render';

export class RemoteLoadError extends Error {
  constructor(
    readonly phase: RemotePhase,
    message: string,
    options?: { cause?: unknown },
  ) {
    super(message, options);
    this.name = 'RemoteLoadError';
  }

  get retryable() {
    return this.phase !== 'manifest' && this.phase !== 'compatibility';
  }
}

export function phaseOf(error: unknown): RemotePhase {
  return error instanceof RemoteLoadError ? error.phase : 'render';
}