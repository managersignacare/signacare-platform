import { describe, expect, it, vi } from 'vitest';
import { withTiming, type TimingEvent } from '../../src/shared/observability/withTiming';

describe('withTiming', () => {
  it('WT-1: returns the wrapped result and emits timing metadata on success', async () => {
    const emit = vi.fn<(event: TimingEvent) => void>();
    const now = vi.fn()
      .mockReturnValueOnce(1_000)
      .mockReturnValueOnce(1_042);

    const result = await withTiming(
      'login.lookupStaff',
      async () => 'ok',
      {
        requestId: 'req-1',
        userId: 'staff-1',
        emit,
        now,
      },
    );

    expect(result).toBe('ok');
    expect(emit).toHaveBeenCalledTimes(1);
    expect(emit).toHaveBeenCalledWith({
      kind: 'TIMING',
      stage: 'login.lookupStaff',
      durationMs: 42,
      requestId: 'req-1',
      userId: 'staff-1',
    });
  });

  it('WT-2: emits timing metadata on failure and rethrows the original error', async () => {
    const emit = vi.fn<(event: TimingEvent) => void>();
    const boom = new Error('boom');

    await expect(
      withTiming(
        'login.issueJwt',
        async () => {
          throw boom;
        },
        {
          emit,
          now: vi.fn().mockReturnValueOnce(50).mockReturnValueOnce(65),
        },
      ),
    ).rejects.toThrow(boom);

    expect(emit).toHaveBeenCalledWith({
      kind: 'TIMING',
      stage: 'login.issueJwt',
      durationMs: 15,
      requestId: undefined,
      userId: undefined,
    });
  });

  it('WT-3: trims surrounding whitespace from the stage name before emitting', async () => {
    const emit = vi.fn<(event: TimingEvent) => void>();

    await withTiming(
      '  login.auditWrite  ',
      async () => null,
      {
        emit,
        now: vi.fn().mockReturnValueOnce(10).mockReturnValueOnce(11),
      },
    );

    expect(emit).toHaveBeenCalledWith({
      kind: 'TIMING',
      stage: 'login.auditWrite',
      durationMs: 1,
      requestId: undefined,
      userId: undefined,
    });
  });

  it('WT-4: rejects blank stage names before executing the wrapped function', async () => {
    const run = vi.fn(async () => 'never');

    await expect(
      withTiming('   ', run),
    ).rejects.toThrow('withTiming stage is required');

    expect(run).not.toHaveBeenCalled();
  });

  it('WT-5: tolerates missing emit handler', async () => {
    const result = await withTiming(
      'login.noEmit',
      async () => ({ ok: true }),
      {
        now: vi.fn().mockReturnValueOnce(100).mockReturnValueOnce(101),
      },
    );

    expect(result).toEqual({ ok: true });
  });

  it('WT-6: clamps negative clock skew to zero duration', async () => {
    const emit = vi.fn<(event: TimingEvent) => void>();

    await withTiming(
      'login.clockSkew',
      async () => undefined,
      {
        emit,
        now: vi.fn().mockReturnValueOnce(500).mockReturnValueOnce(490),
      },
    );

    expect(emit).toHaveBeenCalledWith({
      kind: 'TIMING',
      stage: 'login.clockSkew',
      durationMs: 0,
      requestId: undefined,
      userId: undefined,
    });
  });
});
