const DEFAULT_LIVE_TRANSCRIPT_BATCH_MS = 3000;
const MIN_LIVE_TRANSCRIPT_BATCH_MS = 2000;
const MAX_LIVE_TRANSCRIPT_BATCH_MS = 10000;

export function resolveLiveTranscriptBatchMs(raw: unknown): number {
  const parsed = Number.parseInt(String(raw ?? ''), 10);
  if (!Number.isFinite(parsed)) {
    return DEFAULT_LIVE_TRANSCRIPT_BATCH_MS;
  }

  return Math.min(
    MAX_LIVE_TRANSCRIPT_BATCH_MS,
    Math.max(MIN_LIVE_TRANSCRIPT_BATCH_MS, parsed),
  );
}

export function formatLiveTranscriptCadence(batchMs: number): string {
  const seconds = batchMs / 1000;
  return `Updates every ${Number.isInteger(seconds) ? seconds : seconds.toFixed(1)} second${seconds === 1 ? '' : 's'}`;
}

export const LIVE_TRANSCRIPT_BATCH_MS = resolveLiveTranscriptBatchMs(
  import.meta.env.VITE_SCRIBE_LIVE_TRANSCRIPT_BATCH_MS ?? DEFAULT_LIVE_TRANSCRIPT_BATCH_MS,
);
