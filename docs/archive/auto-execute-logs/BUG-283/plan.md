# BUG-283 — Audit outbox (Redis) — Plan

## Root cause

`writeAuditLog()` silently swallows both:
- Inner catch (line 235-245): falls back to legacy columns; on FINAL failure, `/* truly failed — already logged below */`
- Outer catch (line 248-251): just logs the error

On any DB failure, the audit row is LOST. HIPAA §164.312(b) requires audit recoverability, not just logging of the failure.

## Gold-standard fix

1. **Redis list outbox** — `audit:outbox` key. On DB failure, push the complete row payload (JSON-serialised) to the list.
2. **Drainer** — runs every 30 s; pops one row at a time, attempts the DB insert via the same path, on success ACK, on fail re-push with a retry counter; after N=5 retries escalates via `logger.error` with a distinct `kind=audit_outbox_stuck` tag so Azure Monitor alerts.
3. **Length metric** — `auditOutboxLength()` exposed via `/api/v1/admin/audit-outbox-stats` (admin-only) so ops can see backlog.
4. **Dual-failure** (both DB + Redis down) — `logger.error({ kind: 'tier_5_9_audit_dual_write_failed' })` — already the state documented under BUG-369 L4 absorb.

## Files touched

- `apps/api/src/shared/auditOutbox.ts` — NEW — `enqueueAuditOutbox`, `drainAuditOutbox`, `auditOutboxLength`
- `apps/api/src/utils/audit.ts` — inject `enqueueAuditOutbox(row)` into the two catch paths
- `apps/api/src/jobs/schedulers/auditOutboxDrainer.ts` — NEW — setInterval(30s) drainer + graceful shutdown hook
- `apps/api/src/server.ts` — start drainer on boot; stop on shutdown
- `apps/api/tests/auditOutbox.test.ts` — NEW — 6 unit tests (mocked redis)
- `docs/quality/fix-registry.md` — 3 rows
- `docs/quality/bugs-remaining.md` — mark BUG-283 fixed

## Shape — auditOutbox.ts (sketch)

```typescript
const OUTBOX_KEY = 'audit:outbox';
const MAX_RETRIES = 5;

export async function enqueueAuditOutbox(row: Record<string, unknown>): Promise<void> {
  try {
    await redis.lpush(OUTBOX_KEY, JSON.stringify({ row, retries: 0, enqueuedAt: Date.now() }));
  } catch (err) {
    logger.error({ err, kind: 'tier_5_9_audit_dual_write_failed' }, 'DUAL FAILURE');
  }
}

export async function drainAuditOutbox(batchSize = 50): Promise<{ drained: number; requeued: number; stuck: number }> {
  // RPOP batchSize entries; for each: JSON.parse, attempt dbAdmin('audit_log').insert; on success increment drained;
  // on fail: retries+1 → lpush back (if retries < MAX); else logger.error(kind: 'audit_outbox_stuck') + drop (stuck++)
}

export async function auditOutboxLength(): Promise<number> {
  return Number(await redis.llen(OUTBOX_KEY));
}
```

## Risk

- Drainer firing on every instance in multi-instance deploy → each instance pops independently; acceptable because LPOP is atomic.
- Drain on shutdown — graceful-shutdown hook ensures outbox length is logged on stop.
- Back-pressure: if Redis outbox itself grows unbounded, real Redis key size grows. Length metric + alert catches this. Unbounded growth means the DB is permanently down — operational problem, not a code bug.

## L3/L4/L5 expected

- L3: yes
- L4: yes — touches audit-log write path (§13.5 semantic trigger)
- L5: yes — `shared/` touched + new shared infra (outbox module + new scheduler)

## Fix-registry rows

- `R-FIX-BUG-283-OUTBOX-ENQUEUE-ON-DB-FAIL` present: audit.ts catch calls enqueueAuditOutbox
- `R-FIX-BUG-283-OUTBOX-MODULE-EXISTS` present: enqueueAuditOutbox / drainAuditOutbox exports
- `R-FIX-BUG-283-DRAINER-SCHEDULED` present: setInterval import in server.ts boot

## Deferred items (post-BUG-283)

- Dashboard surface for outbox inspection (BUG-074 ghost / governance)
- Per-clinic outbox partitioning (post-staging if we hit scale pressure)
- BullMQ-based pubsub replacement (out-of-scope; current setInterval is sufficient at staging volumes)
