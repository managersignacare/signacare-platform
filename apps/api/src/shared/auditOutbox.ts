/**
 * BUG-283 — Redis-backed audit outbox for dual-write failure.
 *
 * Motivation (L4 absorb from BUG-369):
 *   HIPAA §164.312(b) requires audit-trail RECOVERABILITY, not just
 *   logging of failures. `writeAuditLog()` has a project-wide never-
 *   throws contract — clinical flow must never be blocked by audit
 *   failure. Pre-BUG-283, a failed DB insert meant the audit row was
 *   LOST (logged only). Under Redis outage the row is gone with no
 *   recovery path.
 *
 * This module adds a durable Redis-list outbox:
 *
 *   1. `enqueueAuditOutbox(row)` — on DB-write failure, pushes the
 *      complete row payload onto `audit:outbox`. If Redis is also
 *      down, emits `kind=tier_5_9_audit_dual_write_failed` so Azure
 *      Monitor can alert — the dual-failure window is acceptable
 *      operational degradation because both layers being simultaneously
 *      unavailable is an environment-wide outage, not a software bug.
 *
 *   2. `drainAuditOutbox(batchSize)` — pops up to `batchSize` entries,
 *      retries the DB insert, on success ACKs, on fail re-pushes with
 *      `retries+1`. After `AUDIT_OUTBOX_MAX_RETRIES` (5) attempts, the
 *      row is dropped with `kind=audit_outbox_stuck` so ops can alert
 *      on sustained DB failure. Stuck rows are the minority case — a
 *      healthy system has either sub-second backlog or a zero-length
 *      list.
 *
 *   3. `auditOutboxLength()` — exposes LLEN for observability.
 *
 * The drainer runs in `apps/api/src/jobs/schedulers/auditOutboxDrainer.ts`
 * on a 30 s interval; also wired to the graceful-shutdown hook so any
 * in-flight backlog is attempted before the process exits.
 */

import { redis } from '../config/redis';
import { dbAdmin } from '../db/db';
import { logger } from '../utils/logger';

export const AUDIT_OUTBOX_KEY = 'audit:outbox';
export const AUDIT_OUTBOX_MAX_RETRIES = 5;

interface OutboxEntry {
  row: Record<string, unknown>;
  retries: number;
  enqueuedAt: number;
}

export interface DrainResult {
  drained: number;
  requeued: number;
  stuck: number;
}

/**
 * Push a failed audit row onto the outbox. Called from the catch block
 * of writeAuditLog when the DB insert fails. Never throws; a dual
 * failure (both DB and Redis down) is logged with a distinct `kind`
 * so ops can alert.
 */
export async function enqueueAuditOutbox(row: Record<string, unknown>): Promise<void> {
  const entry: OutboxEntry = {
    row,
    retries: 0,
    enqueuedAt: Date.now(),
  };
  try {
    await redis.lpush(AUDIT_OUTBOX_KEY, JSON.stringify(entry));
    // Not a user-facing event — info-level so operators see backlog
    // growth without alert-fatigue. Alert threshold is length, not
    // per-enqueue.
    logger.info(
      { kind: 'audit_outbox_enqueued', tableName: row.table_name, recordId: row.record_id },
      'Audit row enqueued to Redis outbox after DB write failure',
    );
  } catch (err) {
    // Dual-failure: DB insert ALREADY failed (caller), and now Redis
    // is ALSO unavailable. The row is lost. Alert on the structured
    // `kind` tag. Azure Monitor SLA for `tier_5_9_audit_dual_write_failed`
    // is ≤ 5 min per pre-deployment-checklist.md Phase 6.
    logger.error(
      { err, kind: 'tier_5_9_audit_dual_write_failed', tableName: row.table_name, recordId: row.record_id },
      'DUAL WRITE FAILURE: audit row lost — both audit_log DB insert AND Redis outbox enqueue failed',
    );
  }
}

/**
 * Return the current outbox backlog length. Used by ops metrics.
 */
export async function auditOutboxLength(): Promise<number> {
  try {
    const n = await redis.llen(AUDIT_OUTBOX_KEY);
    return Number(n);
  } catch (err) {
    logger.error({ err, kind: 'audit_outbox_length_failed' }, 'Failed to read audit outbox length');
    return -1;
  }
}

/**
 * Drain up to `batchSize` entries from the outbox, retrying each DB
 * insert. On success the entry is ACKed (gone). On failure the entry
 * is re-pushed with `retries+1` until `AUDIT_OUTBOX_MAX_RETRIES`, at
 * which point it is dropped with a structured-log alert.
 *
 * Returns { drained, requeued, stuck } for observability. The
 * scheduler logs this on each tick.
 */
export async function drainAuditOutbox(batchSize = 50): Promise<DrainResult> {
  const result: DrainResult = { drained: 0, requeued: 0, stuck: 0 };
  for (let i = 0; i < batchSize; i += 1) {
    let raw: string | null;
    try {
      raw = (await redis.rpop(AUDIT_OUTBOX_KEY)) as string | null;
    } catch (err) {
      logger.error({ err, kind: 'audit_outbox_rpop_failed' }, 'Failed to RPOP audit outbox');
      break;
    }
    if (raw == null) break; // empty

    let entry: OutboxEntry;
    try {
      entry = JSON.parse(raw) as OutboxEntry;
    } catch (err) {
      // Malformed entry — cannot re-push a payload we can't parse; drop.
      logger.error({ err, raw, kind: 'audit_outbox_malformed' }, 'Audit outbox entry unparseable; dropped');
      result.stuck += 1;
      continue;
    }

    try {
      await dbAdmin('audit_log')
        .insert(entry.row)
        .onConflict('dedupe_key')
        .ignore();
      result.drained += 1;
    } catch (insertErr) {
      const nextRetries = entry.retries + 1;
      if (nextRetries >= AUDIT_OUTBOX_MAX_RETRIES) {
        // Give up — permanent drop with structured alert.
        logger.error(
          {
            err: insertErr,
            kind: 'audit_outbox_stuck',
            retries: entry.retries,
            enqueuedAt: entry.enqueuedAt,
            tableName: (entry.row as { table_name?: unknown }).table_name,
            recordId: (entry.row as { record_id?: unknown }).record_id,
          },
          'Audit outbox entry exceeded retry budget; dropped',
        );
        result.stuck += 1;
        continue;
      }
      // Re-push with incremented retry count
      const requeued: OutboxEntry = {
        ...entry,
        retries: nextRetries,
      };
      try {
        await redis.lpush(AUDIT_OUTBOX_KEY, JSON.stringify(requeued));
        result.requeued += 1;
      } catch (redisErr) {
        // Re-push failed AND original DB insert failed — lose this row.
        logger.error(
          { err: redisErr, originalErr: insertErr, kind: 'tier_5_9_audit_dual_write_failed' },
          'Audit outbox re-push failed after DB retry — row lost',
        );
        result.stuck += 1;
      }
    }
  }
  return result;
}
