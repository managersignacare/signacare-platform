import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  __resetPrescriberHpiiWarnSignalCacheForTests,
  emitPrescriberHpiiWarnModeSignal,
  type PrescriberHpiiWarnSignalInput,
} from '../../src/shared/prescriberHpiiWarnSignal';

const BASE_INPUT: PrescriberHpiiWarnSignalInput = {
  staffId: '22222222-2222-2222-2222-222222222222',
  clinicId: '11111111-1111-1111-1111-111111111111',
  hpiiMissing: true,
  hpiiMalformed: false,
  strictModeEnv: 'STRICT_PRESCRIBER_HPII',
};

describe('BUG-338 prescriber HPI-I WARN-mode signal', () => {
  beforeEach(() => {
    __resetPrescriberHpiiWarnSignalCacheForTests();
  });

  it('BUG-338-1: no SENTRY_DSN => skip without capture', async () => {
    const capture = vi.fn<() => Promise<void>>();
    const result = await emitPrescriberHpiiWarnModeSignal(BASE_INPUT, {
      sentryDsn: '',
      capture,
    });

    expect(result).toBe('skipped_no_dsn');
    expect(capture).not.toHaveBeenCalled();
  });

  it('BUG-338-2: emits once when DSN present', async () => {
    const capture = vi.fn(async () => undefined);
    const result = await emitPrescriberHpiiWarnModeSignal(BASE_INPUT, {
      sentryDsn: 'https://example@o0.ingest.sentry.io/1',
      capture,
      nowMs: () => 1000,
    });

    expect(result).toBe('emitted');
    expect(capture).toHaveBeenCalledTimes(1);
    expect(capture).toHaveBeenCalledWith(BASE_INPUT);
  });

  it('BUG-338-3: throttles duplicate signal inside 15-minute window', async () => {
    const capture = vi.fn(async () => undefined);
    const opts = {
      sentryDsn: 'https://example@o0.ingest.sentry.io/1',
      capture,
      nowMs: () => 10_000,
    };

    const first = await emitPrescriberHpiiWarnModeSignal(BASE_INPUT, opts);
    const second = await emitPrescriberHpiiWarnModeSignal(BASE_INPUT, opts);

    expect(first).toBe('emitted');
    expect(second).toBe('skipped_throttled');
    expect(capture).toHaveBeenCalledTimes(1);
  });

  it('BUG-338-4: re-emits after throttle window elapses', async () => {
    const capture = vi.fn(async () => undefined);

    const first = await emitPrescriberHpiiWarnModeSignal(BASE_INPUT, {
      sentryDsn: 'https://example@o0.ingest.sentry.io/1',
      capture,
      nowMs: () => 0,
    });
    const second = await emitPrescriberHpiiWarnModeSignal(BASE_INPUT, {
      sentryDsn: 'https://example@o0.ingest.sentry.io/1',
      capture,
      nowMs: () => (15 * 60 * 1000) + 1,
    });

    expect(first).toBe('emitted');
    expect(second).toBe('emitted');
    expect(capture).toHaveBeenCalledTimes(2);
  });
});
