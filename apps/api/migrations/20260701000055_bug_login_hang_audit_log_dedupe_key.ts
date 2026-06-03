// apps/api/migrations/20260701000055_bug_login_hang_audit_log_dedupe_key.ts
//
// BUG-LOGIN-HANG / A2 foundation — add a replay/idempotency key to the
// append-only audit_log so future timeout-based decoupling can safely
// re-enqueue without creating duplicate forensic rows.
//
// Why now:
//   The repo already ships a Redis-backed audit outbox (BUG-283), but
//   it only recovers from a DB write that FAILS FAST. It does not make
//   a hanging audit write safe to time out and retry, because replaying
//   without an idempotency key would create duplicates in append-only
//   audit_log. This migration is the prerequisite that closes that gap.
//
// Design:
//   - `dedupe_key` stays NULLABLE so historic rows are untouched.
//   - NEW rows may carry a deterministic key.
//   - UNIQUE constraint on `dedupe_key` gives ON CONFLICT DO NOTHING a
//     real DB guarantee while still allowing multiple legacy NULL rows.
//
// No backfill:
//   Historic rows keep NULL. A2 foundation is about making FUTURE
//   replayable writes safe; rewriting immutable forensic history would
//   be the wrong tradeoff here.

import type { Knex } from 'knex';

const CONSTRAINT_NAME = 'uq_audit_log_dedupe_key';

export async function up(knex: Knex): Promise<void> {
  const hasColumn = await knex.schema.hasColumn('audit_log', 'dedupe_key');
  if (!hasColumn) {
    await knex.schema.alterTable('audit_log', (t) => {
      t.string('dedupe_key', 255).nullable();
    });
  }

  // Postgres records UNIQUE constraints in pg_constraint; use that as
  // the idempotent guard so reruns do not fail.
  // @migration-raw-exempt: introspection
  const existing = await knex.raw(
    `SELECT 1 FROM pg_constraint WHERE conname = '${CONSTRAINT_NAME}' LIMIT 1`,
  );
  if (existing.rows.length === 0) {
    await knex.schema.alterTable('audit_log', (t) => {
      t.unique(['dedupe_key'], {
        indexName: CONSTRAINT_NAME,
      });
    });
  }
}

export async function down(knex: Knex): Promise<void> {
  // @migration-raw-exempt: drop_constraint_if_exists
  await knex.raw(`ALTER TABLE audit_log DROP CONSTRAINT IF EXISTS ${CONSTRAINT_NAME}`);

  const hasColumn = await knex.schema.hasColumn('audit_log', 'dedupe_key');
  if (hasColumn) {
    await knex.schema.alterTable('audit_log', (t) => {
      t.dropColumn('dedupe_key');
    });
  }
}
