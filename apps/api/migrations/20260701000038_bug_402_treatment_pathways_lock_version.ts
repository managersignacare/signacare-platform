/*
 * apps/api/migrations/20260701000038_bug_402_treatment_pathways_lock_version.ts
 *
 * BUG-402 — Add `lock_version` integer column to treatment_pathways.
 *
 * The hot data on treatment_pathways lives inside `milestones` JSONB —
 * both racy mutations (PATCH /:id and POST /:id/session) are
 * read-modify-write merges. Without opt-locking, two concurrent
 * "record session" calls do +1 +1 but only one survives (last write
 * wins). Same column-based locking pattern as BUG-371 (prescriptions /
 * patient_medications / episodes); reuses the BUG-371a
 * `updateWithOptimisticLock` helper unchanged.
 *
 * Down() is a NO-OP per BUG-371 / clinical_notes precedent — dropping
 * lock_version mid-production silently disables conflict detection on
 * the rollback window. Append-only.
 *
 * Builder-first per CLAUDE.md §12.1. Idempotency-guarded with
 * `hasColumn` so re-running is safe.
 *
 * R-FIX-BUG-402-MIGRATION-LOCK-VERSION
 */

import type { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  const has = await knex.schema.hasColumn('treatment_pathways', 'lock_version');
  if (!has) {
    await knex.schema.alterTable('treatment_pathways', (t) => {
      t.integer('lock_version').notNullable().defaultTo(1);
    });
  }
}

export async function down(_knex: Knex): Promise<void> {
  // @migration-down-noop: BUG-402 plan + BUG-371 precedent. Dropping
  // lock_version mid-rollback silently disables conflict detection on
  // subsequent UPDATEs while client/server versions diverge.
}
