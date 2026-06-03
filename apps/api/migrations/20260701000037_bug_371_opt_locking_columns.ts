/*
 * apps/api/migrations/20260701000037_bug_371_opt_locking_columns.ts
 *
 * BUG-371 — Add `lock_version` integer column to three high-mutation
 * clinical tables: prescriptions, patient_medications, episodes.
 *
 * Mirrors the existing `clinical_notes.lock_version` precedent
 * (HAZARD-006). Default 1; NOT NULL; monotonically incremented by
 * `apps/api/src/shared/db/optimisticLock.ts:updateWithOptimisticLock`.
 *
 * Down() is a NO-OP per the clinical_notes precedent — dropping
 * lock_version mid-production silently disables conflict detection on
 * the rollback window. Append-only.
 *
 * Builder-first per CLAUDE.md §12.1 — uses only `knex.schema.alterTable
 * + t.integer().notNullable().defaultTo(1)`. NO knex.raw() needed; NO
 * §12.4 taxonomy annotation required. Idempotency-guarded with
 * `hasColumn` so re-running the migration is safe.
 */

import type { Knex } from 'knex';

const TABLES = ['prescriptions', 'patient_medications', 'episodes'] as const;

export async function up(knex: Knex): Promise<void> {
  for (const table of TABLES) {
    const has = await knex.schema.hasColumn(table, 'lock_version');
    if (!has) {
      await knex.schema.alterTable(table, (t) => {
        t.integer('lock_version').notNullable().defaultTo(1);
      });
    }
  }
}

export async function down(_knex: Knex): Promise<void> {
  // @migration-down-noop: BUG-371 plan §2.1 + clinical_notes precedent.
  // Dropping lock_version mid-rollback silently disables conflict
  // detection on subsequent UPDATEs while client/server versions
  // diverge — append-only is safer than the rollback-rollforward
  // complexity.
}
