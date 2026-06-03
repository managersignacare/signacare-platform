export interface TimingEvent {
  readonly kind: 'TIMING';
  readonly stage: string;
  readonly durationMs: number;
  readonly requestId?: string;
  readonly userId?: string;
}

export interface WithTimingOptions {
  readonly requestId?: string;
  readonly userId?: string;
  readonly emit?: (event: TimingEvent) => void;
  readonly now?: () => number;
}

export async function withTiming<T>(
  stage: string,
  run: () => Promise<T>,
  options: WithTimingOptions = {},
): Promise<T> {
  const normalizedStage = stage.trim();
  if (!normalizedStage) {
    throw new Error('withTiming stage is required');
  }

  const now = options.now ?? Date.now;
  const startedAt = now();

  try {
    return await run();
  } finally {
    const durationMs = Math.max(0, now() - startedAt);
    options.emit?.({
      kind: 'TIMING',
      stage: normalizedStage,
      durationMs,
      requestId: options.requestId,
      userId: options.userId,
    });
  }
}
