import { logger } from '../utils/logger';

export interface PrescriberHpiiWarnSignalInput {
  staffId: string;
  clinicId: string;
  hpiiMissing: boolean;
  hpiiMalformed: boolean;
  strictModeEnv: string;
}

type SentryCaptureFn = (input: PrescriberHpiiWarnSignalInput) => Promise<void>;

interface PrescriberHpiiWarnSignalOptions {
  sentryDsn?: string;
  nowMs?: () => number;
  capture?: SentryCaptureFn;
}

export type PrescriberHpiiWarnSignalResult =
  | 'emitted'
  | 'skipped_no_dsn'
  | 'skipped_throttled'
  | 'capture_failed';

const BUG_338_ALERT_KIND = 'bug_296_warn_mode_prescriber_hpii';
const BUG_338_CAPTURE_FAILURE_KIND = 'bug_338_sentry_capture_failed';
const BUG_338_FINGERPRINT = ['BUG-338', 'BUG-296', 'STRICT_PRESCRIBER_HPII_WARN_MODE'];
const BUG_338_WINDOW_MS = 15 * 60 * 1000;
const BUG_338_CACHE_MAX = 2048;
const bug338LastSignalAt = new Map<string, number>();

function signalKey(input: PrescriberHpiiWarnSignalInput): string {
  return `${input.clinicId}:${input.staffId}:${input.hpiiMissing ? 'missing' : 'malformed'}`;
}

function trimSignalCache(now: number): void {
  if (bug338LastSignalAt.size <= BUG_338_CACHE_MAX) return;
  for (const [key, ts] of bug338LastSignalAt) {
    if (now - ts > BUG_338_WINDOW_MS) {
      bug338LastSignalAt.delete(key);
    }
  }
  if (bug338LastSignalAt.size <= BUG_338_CACHE_MAX) return;
  const target = Math.floor(BUG_338_CACHE_MAX / 2);
  for (const key of bug338LastSignalAt.keys()) {
    bug338LastSignalAt.delete(key);
    if (bug338LastSignalAt.size <= target) break;
  }
}

function shouldEmitSignal(key: string, now: number): boolean {
  const last = bug338LastSignalAt.get(key);
  if (last !== undefined && now - last < BUG_338_WINDOW_MS) {
    return false;
  }
  bug338LastSignalAt.set(key, now);
  trimSignalCache(now);
  return true;
}

async function defaultSentryCapture(input: PrescriberHpiiWarnSignalInput): Promise<void> {
  const Sentry = await import('@sentry/node');
  Sentry.withScope((scope) => {
    scope.setLevel('warning');
    scope.setTag('bug_id', 'BUG-338');
    scope.setTag('source_bug', 'BUG-296');
    scope.setTag('alert_kind', BUG_338_ALERT_KIND);
    scope.setTag('strict_mode_env', input.strictModeEnv);
    scope.setFingerprint(BUG_338_FINGERPRINT);
    scope.setContext('prescriber_hpii_warn_mode', {
      staffId: input.staffId,
      clinicId: input.clinicId,
      hpiiMissing: input.hpiiMissing,
      hpiiMalformed: input.hpiiMalformed,
    });
    Sentry.captureMessage(
      '[BUG-296] Prescriber HPI-I missing/malformed in WARN mode (set STRICT_PRESCRIBER_HPII=true to enforce)',
      'warning',
    );
  });
}

// R-FIX-BUG-338-SENTRY-WARN-SIGNAL
export async function emitPrescriberHpiiWarnModeSignal(
  input: PrescriberHpiiWarnSignalInput,
  options: PrescriberHpiiWarnSignalOptions = {},
): Promise<PrescriberHpiiWarnSignalResult> {
  const sentryDsn = options.sentryDsn ?? process.env.SENTRY_DSN ?? '';
  if (!sentryDsn) return 'skipped_no_dsn';

  const now = (options.nowMs ?? Date.now)();
  const key = signalKey(input);
  if (!shouldEmitSignal(key, now)) {
    return 'skipped_throttled';
  }

  const capture = options.capture ?? defaultSentryCapture;
  try {
    await capture(input);
    return 'emitted';
  } catch (err) {
    bug338LastSignalAt.delete(key);
    logger.warn(
      {
        err,
        kind: BUG_338_CAPTURE_FAILURE_KIND,
        bugId: 'BUG-338',
        staffId: input.staffId,
        clinicId: input.clinicId,
      },
      'BUG-338: failed to emit Sentry warning signal for BUG-296 WARN-mode HPI-I gate',
    );
    return 'capture_failed';
  }
}

export function __resetPrescriberHpiiWarnSignalCacheForTests(): void {
  bug338LastSignalAt.clear();
}
