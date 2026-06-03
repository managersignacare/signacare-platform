import { beforeEach, describe, expect, it } from 'vitest';
import {
  __resetForTests,
  getGracefulShutdownObservabilitySnapshot,
  registerShutdownHook,
  runGracefulShutdown,
} from '../../src/shared/gracefulShutdown';

describe('BUG-308 graceful shutdown observability metrics', () => {
  beforeEach(() => {
    __resetForTests();
  });

  it('BUG-308-1: returns an empty snapshot before any shutdown run', () => {
    const snapshot = getGracefulShutdownObservabilitySnapshot(new Date('2026-05-14T00:00:00.000Z'));

    expect(snapshot.runCount).toBe(0);
    expect(snapshot.runsLast24Hours).toBe(0);
    expect(snapshot.lastRun).toBeNull();
    expect(snapshot.perHookLast24Hours).toEqual([]);
    expect(snapshot.aggregatesLast24Hours.hooksCompleted).toBe(0);
    expect(snapshot.aggregatesLast24Hours.hooksFailed).toBe(0);
    expect(snapshot.aggregatesLast24Hours.hooksTimedOut).toBe(0);
    expect(snapshot.aggregatesLast24Hours.hooksSkippedBudget).toBe(0);
  });

  it('BUG-308-2: captures per-hook duration + timeout outcomes for complete/fail/timeout paths', async () => {
    registerShutdownHook({
      name: 'fast-success',
      priority: 90,
      timeoutMs: 50,
      handler: async () => {
        await new Promise((resolve) => setTimeout(resolve, 1));
      },
    });
    registerShutdownHook({
      name: 'throws-failure',
      priority: 80,
      timeoutMs: 50,
      handler: async () => {
        throw new Error('intentional_failure');
      },
    });
    registerShutdownHook({
      name: 'times-out',
      priority: 70,
      timeoutMs: 10,
      handler: async () => new Promise<void>(() => undefined),
    });

    await runGracefulShutdown('TEST');

    const snapshot = getGracefulShutdownObservabilitySnapshot();
    expect(snapshot.runCount).toBe(1);
    expect(snapshot.runsLast24Hours).toBe(1);
    expect(snapshot.lastRun).not.toBeNull();

    const hooks = snapshot.lastRun?.hooks ?? [];
    expect(hooks.length).toBe(3);

    const byName = new Map(hooks.map((h) => [h.hookName, h]));
    expect(byName.get('fast-success')?.outcome).toBe('completed');
    expect(byName.get('throws-failure')?.outcome).toBe('failed');
    expect(byName.get('times-out')?.outcome).toBe('timed_out');
    expect(byName.get('times-out')?.timeoutMs).toBe(10);
    expect((byName.get('times-out')?.durationMs ?? 0) >= 10).toBe(true);

    expect(snapshot.aggregatesLast24Hours.hooksCompleted).toBe(1);
    expect(snapshot.aggregatesLast24Hours.hooksFailed).toBe(1);
    expect(snapshot.aggregatesLast24Hours.hooksTimedOut).toBe(1);
    expect(snapshot.aggregatesLast24Hours.hooksSkippedBudget).toBe(0);

    const timeoutAggregate = snapshot.perHookLast24Hours.find((row) => row.hookName === 'times-out');
    expect(timeoutAggregate?.timedOut).toBe(1);
    expect(timeoutAggregate?.maxTimeoutMs).toBe(10);
  });
});
