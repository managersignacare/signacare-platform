// apps/api/tests/integration/dbPoolPressure.int.test.ts
//
// BUG-187 mitigation-regression test.
//
// Scope (per docs/audit-2026-04-19/follow-up-on-cloud-deploy.md §9.1):
// this test proves the statement_timeout + idle_in_transaction_session_timeout
// GUARDRAILS are in force. It does NOT prove the original pool-exhaustion
// symptom is eliminated — the mechanism that caused the observed 21h
// drain on a prior dev process was NOT reproduced in the 2026-04-20
// audit, and root cause remains OPEN (tracked in the follow-up doc §2).
//
// Full root-cause reproduction requires a replication harness with
// simulated clinician LLM load over multiple hours (follow-up doc §6).
// That test is deferred until the harness exists.
//
// Red-first evidence (G.1 requirement): reverting db.ts afterCreate
// to "SELECT 1" only, without the SET statements, causes tests 1, 2,
// and 3 to FAIL (SHOW returns '0'; pg_sleep hangs for 35s). Restoring
// the afterCreate passes all 4. Both traces attached to PR body.

import { describe, it, expect } from 'vitest';
import { appPoolRaw } from '../../src/db/db';

describe('BUG-187 — pool connection-level timeouts', () => {
  it('every new app_user connection has statement_timeout = 30s', async () => {
    // Force a fresh connection acquisition
    const row = await appPoolRaw.raw<{ rows: Array<{ statement_timeout: string }> }>(
      "SHOW statement_timeout",
    );
    // Postgres SHOW returns the value as-configured. '30s' is set by afterCreate.
    // Values like '30s', '30000ms', '30 s' are all equivalent — check for 30-second semantics.
    const value = row.rows[0].statement_timeout;
    expect(value).toMatch(/^30\s*s$|^30000\s*ms$/);
  });

  it('every new app_user connection has idle_in_transaction_session_timeout = 60s', async () => {
    const row = await appPoolRaw.raw<{ rows: Array<{ idle_in_transaction_session_timeout: string }> }>(
      "SHOW idle_in_transaction_session_timeout",
    );
    const value = row.rows[0].idle_in_transaction_session_timeout;
    expect(value).toMatch(/^1min$|^60\s*s$|^60000\s*ms$/);
  });

  it('stalled query is cancelled at 30s rather than holding connection forever', async () => {
    // pg_sleep(35) exceeds the 30s statement_timeout.
    // Pre-fix: this would hang for 35s and return.
    // Post-fix: Postgres cancels the query, Knex throws with SQLSTATE 57014.
    const start = Date.now();
    await expect(
      appPoolRaw.raw("SELECT pg_sleep(35)")
    ).rejects.toThrow(/canceling statement due to statement timeout|statement timeout/i);
    const elapsed = Date.now() - start;
    // Should fail in ~30s, not ~35s. Allow 2s jitter window.
    expect(elapsed).toBeGreaterThanOrEqual(29_000);
    expect(elapsed).toBeLessThan(33_000);
  }, 40_000);

  // Scheduler-iteration test asserting pool
  // returns to baseline after each iteration. The leak class appears
  // over uptime; if any scheduler helper holds a connection after
  // completing, this test catches it by running a typical scheduler
  // workload 20 times and checking pool metrics stay bounded.
  it('scheduler-shaped workload returns pool to baseline after 20 iterations', async () => {
    interface TarnPool {
      numUsed?: () => number;
      numFree?: () => number;
      numPendingAcquires?: () => number;
    }
    const tarn = (appPoolRaw.client as unknown as { pool: TarnPool }).pool;

    // Baseline snapshot after a brief quiesce period so the pool has
    // returned any recently-used connections to the idle set.
    await new Promise((r) => setTimeout(r, 200));
    const baseUsed = tarn.numUsed?.() ?? 0;

    // Simulate 20 scheduler ticks. Each tick does a small query burst
    // that mimics a typical scheduler (read config, check state, write
    // log). If any iteration holds a connection past its async
    // completion, numUsed will creep upward.
    const snapshots: Array<{ iter: number; used: number; pending: number }> = [];
    for (let i = 0; i < 20; i++) {
      await Promise.all([
        appPoolRaw.raw('SELECT 1'),
        appPoolRaw.raw('SELECT now()'),
        appPoolRaw.raw('SELECT current_database()'),
      ]);
      // Brief yield so the pool can reap idle connections
      await new Promise((r) => setTimeout(r, 10));
      snapshots.push({
        iter: i,
        used: tarn.numUsed?.() ?? 0,
        pending: tarn.numPendingAcquires?.() ?? 0,
      });
    }

    // Assertion: pool usage never grows unbounded.
    // Allow up to 3 extra acquired connections during the run (normal
    // tarn.js pool behaviour — min-size creates+holds some), but never
    // creep past baseline + 10 (which would indicate leak).
    const maxUsed = Math.max(...snapshots.map((s) => s.used));
    const maxPending = Math.max(...snapshots.map((s) => s.pending));
    expect(maxUsed).toBeLessThanOrEqual(baseUsed + 10);
    expect(maxPending).toBe(0); // no pending-acquire queue = no pressure

    // Post-workload: pool should return to near-baseline within 1s
    await new Promise((r) => setTimeout(r, 1000));
    const postUsed = tarn.numUsed?.() ?? 0;
    expect(postUsed).toBeLessThanOrEqual(baseUsed + 3);
  }, 20_000);
});
