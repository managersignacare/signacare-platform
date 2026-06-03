/**
 * BUG-042 regression — graceful-shutdown registry behaviour.
 *
 * Coverage (11 tests):
 *   T1 — GET /ready returns 200 when no shutdown in progress.
 *   T2 — runGracefulShutdown flips /ready to 503 immediately.
 *   T3 — Second runGracefulShutdown during active shutdown is idempotent (no-op).
 *   T4 — Hooks run in descending priority order.
 *   T5 — Hook that throws does not block subsequent hooks (isolated).
 *   T6 — Per-hook timeout cancels hung hook; overall completes within budget.
 *   T7 — WebSocket-style hook at priority 90 resolves BEFORE HTTP-style hook
 *        at priority 80 (pins the pre-L3-rejection ordering bug fix).
 *   T8 — Worker-style hook with timeoutMs=7000 gets its custom timeout,
 *        not the default 5s (pins the per-hook timeout override).
 *   T9 — Scheduler-style hook at priority 85 resolves BEFORE DB-style
 *        hook at priority 20 (pins the cron-vs-DB race fix).
 *   T10 — OTEL-style hook at priority 5 resolves AFTER DB + Redis hooks.
 *   T11 — Same-priority hooks preserve registration order (OTEL before pino flush).
 */

import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import request from 'supertest';
import { isIntegrationReady, loginAsAdmin } from './_helpers';
import app from '../../src/server';
import {
  registerShutdownHook,
  runGracefulShutdown,
  isReady,
  __resetForTests,
  __hookNamesForTests,
} from '../../src/shared/gracefulShutdown';

describe.skipIf(!(await isIntegrationReady()))('BUG-042 graceful shutdown registry', () => {
  beforeEach(() => {
    __resetForTests();
  });

  afterAll(() => {
    __resetForTests();
  });

  it('T1 — GET /ready returns 200 (not "draining") when no shutdown in progress', async () => {
    await loginAsAdmin();
    const res = await request(app).get('/ready');
    expect(res.body.status).not.toBe('draining');
    expect(isReady()).toBe(true);
  });

  it('T2 — runGracefulShutdown flips /ready to 503 immediately', async () => {
    let hookStarted = false;
    registerShutdownHook({
      name: 'test-slow-hook',
      priority: 80,
      handler: async () => {
        hookStarted = true;
        await new Promise((r) => setTimeout(r, 80));
      },
    });
    const shutdownPromise = runGracefulShutdown('TEST');
    await new Promise((r) => setTimeout(r, 5));
    expect(hookStarted).toBe(true);
    expect(isReady()).toBe(false);
    const res = await request(app).get('/ready');
    expect(res.status).toBe(503);
    expect(res.body.status).toBe('draining');
    expect(res.body.reason).toBe('graceful_shutdown_in_progress');
    await shutdownPromise;
  });

  it('T3 — second runGracefulShutdown during active shutdown is a no-op', async () => {
    let runCount = 0;
    registerShutdownHook({
      name: 'test-counter',
      priority: 80,
      handler: async () => { runCount += 1; await new Promise((r) => setTimeout(r, 40)); },
    });
    const first = runGracefulShutdown('TEST-1');
    const second = runGracefulShutdown('TEST-2');
    await Promise.all([first, second]);
    expect(runCount).toBe(1);
  });

  it('T4 — hooks run in descending priority order', async () => {
    const fired: string[] = [];
    registerShutdownHook({ name: 'low', priority: 10, handler: async () => { fired.push('low'); } });
    registerShutdownHook({ name: 'high', priority: 80, handler: async () => { fired.push('high'); } });
    registerShutdownHook({ name: 'mid', priority: 40, handler: async () => { fired.push('mid'); } });
    expect(__hookNamesForTests()).toEqual(['high', 'mid', 'low']);
    await runGracefulShutdown('TEST');
    expect(fired).toEqual(['high', 'mid', 'low']);
  });

  it('T5 — hook that throws does not block subsequent hooks', async () => {
    const fired: string[] = [];
    registerShutdownHook({ name: 'first-ok', priority: 80, handler: async () => { fired.push('first-ok'); } });
    registerShutdownHook({ name: 'middle-throws', priority: 50, handler: async () => { fired.push('middle-threw'); throw new Error('deliberate'); } });
    registerShutdownHook({ name: 'last-ok', priority: 10, handler: async () => { fired.push('last-ok'); } });
    await runGracefulShutdown('TEST');
    expect(fired).toEqual(['first-ok', 'middle-threw', 'last-ok']);
  });

  it('T6 — per-hook default 5s timeout cancels hung hook; overall completes', async () => {
    const fired: string[] = [];
    registerShutdownHook({ name: 'fast', priority: 80, handler: async () => { fired.push('fast'); } });
    registerShutdownHook({
      name: 'hung',
      priority: 50,
      handler: () => new Promise(() => { fired.push('hung-started'); /* never resolves */ }),
    });
    registerShutdownHook({ name: 'after-hung', priority: 10, handler: async () => { fired.push('after-hung'); } });
    const start = Date.now();
    await runGracefulShutdown('TEST');
    const elapsed = Date.now() - start;
    expect(elapsed).toBeGreaterThanOrEqual(5_000);
    expect(elapsed).toBeLessThan(7_000);
    expect(fired).toContain('fast');
    expect(fired).toContain('hung-started');
    expect(fired).toContain('after-hung');
  }, 20_000);

  // BUG-042 L3 absorption — pins the priority ordering fix.
  // WebSocket close (90) MUST resolve before HTTP close (80). Pre-L3 the
  // priorities were 50 vs 80 which meant HTTP close hung waiting for the
  // WebSocket socket. Test records resolution order; mutation (flipping
  // the priorities) flips this test red.
  it('T7 — WebSocket-style hook at priority 90 resolves BEFORE HTTP-style at 80', async () => {
    const completed: string[] = [];
    registerShutdownHook({
      name: 'ws-style',
      priority: 90,
      handler: async () => { await new Promise((r) => setTimeout(r, 20)); completed.push('ws'); },
    });
    registerShutdownHook({
      name: 'http-style',
      priority: 80,
      handler: async () => { await new Promise((r) => setTimeout(r, 20)); completed.push('http'); },
    });
    await runGracefulShutdown('TEST');
    expect(completed).toEqual(['ws', 'http']);
  });

  // BUG-042 L3 absorption — per-hook timeout override. Long-running
  // workers (aiWorker=20s, OCR=15s) need more than 5s default. This
  // test proves the override is honoured.
  it('T8 — hook with custom timeoutMs honours its override, not the 5s default', async () => {
    let hookResolvedNormally = false;
    const start = Date.now();
    registerShutdownHook({
      name: 'long-worker',
      priority: 60,
      timeoutMs: 7_000,
      // Resolves at ~6s — would time out at default 5s, but 7s override lets it complete.
      handler: () => new Promise<void>((resolve) => setTimeout(() => { hookResolvedNormally = true; resolve(); }, 6_000)),
    });
    await runGracefulShutdown('TEST');
    const elapsed = Date.now() - start;
    expect(hookResolvedNormally).toBe(true);
    expect(elapsed).toBeGreaterThanOrEqual(6_000);
    expect(elapsed).toBeLessThan(7_100);
  }, 15_000);

  // BUG-042 L3 absorption — scheduler vs DB race. Scheduler stop at 85
  // MUST resolve before DB pool destroy at 20. Pre-L3 there was no
  // scheduler priority; this test pins it.
  it('T9 — scheduler hook at priority 85 resolves BEFORE DB-style hook at 20', async () => {
    const completed: string[] = [];
    registerShutdownHook({
      name: 'scheduler-style',
      priority: 85,
      handler: async () => { completed.push('scheduler'); },
    });
    registerShutdownHook({
      name: 'db-style',
      priority: 20,
      handler: async () => { completed.push('db'); },
    });
    await runGracefulShutdown('TEST');
    expect(completed).toEqual(['scheduler', 'db']);
  });

  // BUG-042 L5 absorption — OTEL SDK flush at priority 5 must run
  // AFTER DB (20) and Redis (10) so teardown spans are captured in
  // the trace. Pins the OTEL-is-last ordering L5 required after
  // folding otel.ts's parallel process.on SIGTERM into the registry.
  it('T10 — OTEL-style hook at priority 5 resolves AFTER DB-style at 20 and Redis-style at 10', async () => {
    const completed: string[] = [];
    registerShutdownHook({ name: 'otel-style', priority: 5, handler: async () => { completed.push('otel'); } });
    registerShutdownHook({ name: 'redis-style', priority: 10, handler: async () => { completed.push('redis'); } });
    registerShutdownHook({ name: 'db-style', priority: 20, handler: async () => { completed.push('db'); } });
    await runGracefulShutdown('TEST');
    expect(completed).toEqual(['db', 'redis', 'otel']);
  });

  // BUG-306 — pino sync flush is also priority 5. We rely on stable
  // same-priority order so OTEL teardown logs are emitted before the
  // pino flush hook forces destination sync.
  it('T11 — same-priority hooks preserve registration order (OTEL before pino flush)', async () => {
    const completed: string[] = [];
    registerShutdownHook({ name: 'otel-style', priority: 5, handler: async () => { completed.push('otel'); } });
    registerShutdownHook({ name: 'pino-style', priority: 5, handler: async () => { completed.push('pino'); } });
    await runGracefulShutdown('TEST');
    expect(completed).toEqual(['otel', 'pino']);
  });
});
