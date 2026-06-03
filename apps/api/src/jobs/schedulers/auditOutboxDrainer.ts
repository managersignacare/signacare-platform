// apps/api/src/jobs/schedulers/auditOutboxDrainer.ts
//
// BUG-283 — Audit outbox drainer scheduler.
//
// Pairs with `apps/api/src/shared/auditOutbox.ts`:
//   - When `writeAuditLog`'s DB insert fails, it pushes the row onto
//     Redis list `audit:outbox`.
//   - This scheduler ticks every 30 s, drains up to 50 entries per
//     tick, and logs the drain result. On sustained backlog (>100
//     entries or stuck count > 0), emit a high-severity structured
//     log so Azure Monitor can alert.
//
// The drainer runs in EVERY API instance — `RPOP` is atomic so
// multi-instance draining is safe (no two instances see the same
// entry). A healthy system has a zero-length outbox; the scheduler
// is idle ~99.9% of the time.
//
// Graceful shutdown: `stopAuditOutboxDrainer()` clears the interval.
// The final drain attempt before exit is the caller's responsibility
// (e.g. a shutdown hook can call `drainAuditOutbox()` once).

import { drainAuditOutbox, auditOutboxLength } from '../../shared/auditOutbox';
import { logger } from '../../utils/logger';

const DRAIN_INTERVAL_MS = 30_000;
const BATCH_SIZE = 50;
const BACKLOG_ALERT_THRESHOLD = 100;

let timer: ReturnType<typeof setInterval> | null = null;

async function tick(): Promise<void> {
  try {
    const lengthBefore = await auditOutboxLength();
    if (lengthBefore === 0) return; // fast path — no backlog

    const result = await drainAuditOutbox(BATCH_SIZE);
    const lengthAfter = await auditOutboxLength();

    logger.info(
      {
        kind: 'audit_outbox_drain_tick',
        lengthBefore,
        lengthAfter,
        drained: result.drained,
        requeued: result.requeued,
        stuck: result.stuck,
      },
      'Audit outbox drain tick',
    );

    if (lengthAfter >= BACKLOG_ALERT_THRESHOLD) {
      logger.error(
        { kind: 'audit_outbox_backlog', length: lengthAfter },
        'Audit outbox backlog above alert threshold — DB write failures persisting',
      );
    }
    if (result.stuck > 0) {
      logger.error(
        { kind: 'audit_outbox_stuck_summary', stuck: result.stuck, requeued: result.requeued },
        'Audit outbox drained entries that exceeded retry budget',
      );
    }
  } catch (err) {
    logger.error({ err, kind: 'audit_outbox_drain_tick_failed' }, 'Audit outbox drain tick raised');
  }
}

/**
 * Start the 30 s drain tick. Idempotent — calling twice only starts
 * one interval. Call `stopAuditOutboxDrainer()` on graceful shutdown.
 */
export function startAuditOutboxDrainer(): void {
  if (timer !== null) return;
  timer = setInterval(() => {
    // setInterval cannot await a Promise. tick() has its own try/catch
    // so a thrown error should never escape, but we chain .catch as a
    // belt-and-braces measure per CLAUDE.md §9.6 so `check-no-fire-and-forget`
    // is satisfied and any unexpected rejection is still observable.
    tick().catch((err) => {
      logger.error({ err, kind: 'audit_outbox_drain_tick_unhandled' }, 'Audit outbox drain tick unhandled rejection');
    });
  }, DRAIN_INTERVAL_MS);
  logger.info(
    { kind: 'audit_outbox_drainer_started', intervalMs: DRAIN_INTERVAL_MS, batchSize: BATCH_SIZE },
    'Audit outbox drainer started',
  );
}

/**
 * Stop the drainer. Call from graceful-shutdown hook.
 */
export function stopAuditOutboxDrainer(): void {
  if (timer !== null) {
    clearInterval(timer);
    timer = null;
    logger.info({ kind: 'audit_outbox_drainer_stopped' }, 'Audit outbox drainer stopped');
  }
}

import { registerShutdownHook } from '../../shared/gracefulShutdown';

// Auto-start on import in non-test environments — matches the pattern
// used by audioRetentionScheduler, matviewRefreshScheduler, etc.
// Registered with the graceful-shutdown registry at priority 84 so
// the drainer stops BEFORE the DB pool is destroyed (priority 85+).
if (process.env.NODE_ENV !== 'test') {
  setImmediate(() => {
    try {
      startAuditOutboxDrainer();
      registerShutdownHook({
        name: 'scheduler:audit-outbox-drainer',
        priority: 84,
        handler: async () => {
          stopAuditOutboxDrainer();
          // Attempt one final drain before shutdown so in-flight
          // backlog reaches the DB if it is still up.
          try {
            const { drainAuditOutbox: drain } = await import('../../shared/auditOutbox');
            const result = await drain(500);
            logger.info({ kind: 'audit_outbox_final_drain', ...result }, 'Audit outbox final drain on shutdown');
          } catch (err) {
            logger.error({ err, kind: 'audit_outbox_final_drain_failed' }, 'Final outbox drain on shutdown failed');
          }
        },
      });
    } catch (err) {
      logger.error({ err }, 'auditOutboxDrainer failed to start');
    }
  });
}
