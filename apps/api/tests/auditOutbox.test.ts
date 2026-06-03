// tests/auditOutbox.test.ts
//
// BUG-283 — Redis-backed audit outbox for dual-write failure.
//
// Contract:
//   1. `enqueueAuditOutbox(row)` pushes the row JSON onto a Redis list
//      (key: `audit:outbox`) with retry=0 + enqueuedAt timestamp.
//   2. `auditOutboxLength()` returns the current list length.
//   3. `drainAuditOutbox(batchSize)` pops up to `batchSize` entries,
//      retries the DB insert via
//      `dbAdmin('audit_log').insert(...).onConflict('dedupe_key').ignore()`,
//      on success increments `drained`, on fail re-pushes with
//      `retries+1` unless retries reaches MAX_RETRIES (5) at which
//      point the row is dropped + `logger.error({ kind:
//      'audit_outbox_stuck' })` is emitted and `stuck++`.
//   4. Dual-failure (both DB insert AND redis lpush throw) calls
//      `logger.error({ kind: 'tier_5_9_audit_dual_write_failed' })`.
//
// These tests drive the contract via mocks; no real Redis, no real DB.

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock BEFORE importing the module under test
vi.mock('../src/config/redis', () => ({
  redis: {
    lpush: vi.fn(),
    rpop: vi.fn(),
    llen: vi.fn(),
  },
}));

vi.mock('../src/db/db', () => ({
  dbAdmin: vi.fn(),
}));

// A tiny logger mock that records calls so we can assert on the
// structured `kind` tag without leaking log output during tests.
const loggerCalls: Array<{ level: string; payload: Record<string, unknown>; msg: string }> = [];
vi.mock('../src/utils/logger', () => ({
  logger: {
    error: (payload: Record<string, unknown>, msg: string) => {
      loggerCalls.push({ level: 'error', payload, msg });
    },
    warn: (payload: Record<string, unknown>, msg: string) => {
      loggerCalls.push({ level: 'warn', payload, msg });
    },
    info: (payload: Record<string, unknown>, msg: string) => {
      loggerCalls.push({ level: 'info', payload, msg });
    },
  },
}));

import { enqueueAuditOutbox, auditOutboxLength, drainAuditOutbox, AUDIT_OUTBOX_KEY, AUDIT_OUTBOX_MAX_RETRIES } from '../src/shared/auditOutbox';
import { redis } from '../src/config/redis';
import { dbAdmin } from '../src/db/db';

function installInsertBuilder(insertImpl: ReturnType<typeof vi.fn>) {
  let pendingRow: unknown;
  const ignore = vi.fn().mockImplementation(() => insertImpl(pendingRow));
  const onConflict = vi.fn().mockReturnValue({ ignore });
  const insert = vi.fn().mockImplementation((row: unknown) => {
    pendingRow = row;
    return { onConflict };
  });
  (dbAdmin as unknown as ReturnType<typeof vi.fn>).mockReturnValue({ insert });
  return { insert, onConflict, ignore };
}

describe('auditOutbox — BUG-283', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    loggerCalls.length = 0;
  });

  it('enqueueAuditOutbox pushes row JSON onto the Redis list with retries=0', async () => {
    (redis.lpush as ReturnType<typeof vi.fn>).mockResolvedValueOnce(1);
    const row = { clinic_id: 'abc', table_name: 'patients', record_id: 'p-1', operation: 'CREATE' };
    await enqueueAuditOutbox(row);
    expect(redis.lpush).toHaveBeenCalledOnce();
    const [key, payload] = (redis.lpush as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(key).toBe(AUDIT_OUTBOX_KEY);
    const parsed = JSON.parse(payload);
    expect(parsed.row).toEqual(row);
    expect(parsed.retries).toBe(0);
    expect(parsed.enqueuedAt).toBeGreaterThan(0);
  });

  it('enqueueAuditOutbox on Redis failure emits kind=tier_5_9_audit_dual_write_failed', async () => {
    (redis.lpush as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('redis down'));
    await enqueueAuditOutbox({ anything: 1 });
    const dualFail = loggerCalls.find((c) => c.payload.kind === 'tier_5_9_audit_dual_write_failed');
    expect(dualFail).toBeTruthy();
  });

  it('auditOutboxLength returns the Redis LLEN', async () => {
    (redis.llen as ReturnType<typeof vi.fn>).mockResolvedValueOnce('7');
    const len = await auditOutboxLength();
    expect(len).toBe(7);
  });

  it('drainAuditOutbox on happy path drains entries and increments drained count', async () => {
    const row = { clinic_id: 'c1', table_name: 't', record_id: 'r1', operation: 'CREATE' };
    (redis.rpop as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce(JSON.stringify({ row, retries: 0, enqueuedAt: Date.now() }))
      .mockResolvedValueOnce(null); // drain loop stops on null
    const insertFn = vi.fn().mockResolvedValueOnce([]);
    const { insert, onConflict, ignore } = installInsertBuilder(insertFn);

    const result = await drainAuditOutbox(10);
    expect(result.drained).toBe(1);
    expect(result.requeued).toBe(0);
    expect(result.stuck).toBe(0);
    expect(insert).toHaveBeenCalledWith(row);
    expect(onConflict).toHaveBeenCalledWith('dedupe_key');
    expect(ignore).toHaveBeenCalledOnce();
  });

  it('drainAuditOutbox on DB insert failure re-pushes with retries+1 (under MAX)', async () => {
    const row = { clinic_id: 'c1', table_name: 't', record_id: 'r1', operation: 'CREATE' };
    (redis.rpop as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce(JSON.stringify({ row, retries: 0, enqueuedAt: Date.now() }))
      .mockResolvedValueOnce(null);
    const insertFn = vi.fn().mockRejectedValueOnce(new Error('DB still down'));
    installInsertBuilder(insertFn);
    (redis.lpush as ReturnType<typeof vi.fn>).mockResolvedValueOnce(1);

    const result = await drainAuditOutbox(10);
    expect(result.drained).toBe(0);
    expect(result.requeued).toBe(1);
    expect(result.stuck).toBe(0);
    // Re-push carries retries=1
    const requeuePayload = JSON.parse((redis.lpush as ReturnType<typeof vi.fn>).mock.calls[0][1]);
    expect(requeuePayload.retries).toBe(1);
  });

  it('drainAuditOutbox preserves `created_at` at event-time on replay (L4 absorb)', async () => {
    // Clinical-safety: forensic chronology must survive outbox replay.
    // The row's created_at was stamped at the original writeAuditLog
    // call site (not by DB default). After Redis round-trip + replay,
    // the insert must carry the ORIGINAL event-time, not the replay time.
    const eventTime = new Date(Date.now() - 5 * 60_000).toISOString(); // 5 min ago
    const row = {
      clinic_id: 'c1',
      table_name: 'patients',
      record_id: 'p1',
      operation: 'CREATE',
      created_at: eventTime,
    };
    (redis.rpop as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce(JSON.stringify({ row, retries: 0, enqueuedAt: Date.now() - 5 * 60_000 }))
      .mockResolvedValueOnce(null);
    const insertFn = vi.fn().mockResolvedValueOnce([]);
    installInsertBuilder(insertFn);

    const result = await drainAuditOutbox(10);
    expect(result.drained).toBe(1);
    // Critical assertion: the replay insert MUST carry the original
    // event-time, not a replay-time stamp. Without this, coronial
    // review sees clinically-impossible ordering.
    const insertedRow = insertFn.mock.calls[0][0] as { created_at: string };
    expect(insertedRow.created_at).toBe(eventTime);
  });

  it('drainAuditOutbox drops entries at MAX_RETRIES with kind=audit_outbox_stuck', async () => {
    const row = { clinic_id: 'c1', table_name: 't', record_id: 'r1', operation: 'CREATE' };
    (redis.rpop as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce(
        JSON.stringify({ row, retries: AUDIT_OUTBOX_MAX_RETRIES, enqueuedAt: Date.now() - 600_000 }),
      )
      .mockResolvedValueOnce(null);
    const insertFn = vi.fn().mockRejectedValueOnce(new Error('DB permanently down'));
    installInsertBuilder(insertFn);

    const result = await drainAuditOutbox(10);
    expect(result.drained).toBe(0);
    expect(result.requeued).toBe(0);
    expect(result.stuck).toBe(1);
    // Structured log emitted
    const stuckLog = loggerCalls.find((c) => c.payload.kind === 'audit_outbox_stuck');
    expect(stuckLog).toBeTruthy();
  });
});
