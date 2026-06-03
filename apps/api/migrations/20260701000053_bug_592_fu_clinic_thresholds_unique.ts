// apps/api/migrations/20260701000053_bug_592_fu_clinic_thresholds_unique.ts
//
// BUG-592-FOLLOWUP-DBADMIN-THRESHOLDS — adds UNIQUE constraint on
// `clinic_thresholds (clinic_id, threshold_key)`. Latent pre-existing
// gap: `settingsService.setThreshold` uses
// `.onConflict(['clinic_id', 'threshold_key']).merge(...)` per
// `apps/api/src/features/settings/settingsService.ts:80` — but the
// table had only a non-unique index, so the upsert fails at runtime
// with `there is no unique or exclusion constraint matching the ON
// CONFLICT specification` (Postgres error 42P10). Surfaced during
// BUG-592-FOLLOWUP-DBADMIN-THRESHOLDS regression-test write 2026-05-03.
//
// Per CLAUDE.md §7.2 — business uniqueness ("only one threshold per
// clinic per key") MUST be enforced with a UNIQUE constraint, not just
// an application-level check or a non-unique index.
//
// Pre-existing rows: a quick query against the integration DB shows 0
// rows in `clinic_thresholds` (no operator has set a per-clinic
// override yet because the upsert was broken), so duplicate-row
// conflicts at constraint-add time are not expected. A defensive
// dedupe-before-add pattern is included regardless: if any duplicate
// `(clinic_id, threshold_key)` combinations exist, retain the
// most-recently-updated row and DELETE the older ones.

import type { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  // Defensive dedupe — keep the most-recent row per
  // (clinic_id, threshold_key); delete the rest. Idempotent + safe even
  // when no duplicates exist (DELETE FROM ... WHERE id NOT IN (...)
  // matches zero rows).
  // @migration-raw-exempt: data_backfill_delete
  await knex.raw(`
    DELETE FROM clinic_thresholds
     WHERE id NOT IN (
       SELECT DISTINCT ON (clinic_id, threshold_key) id
         FROM clinic_thresholds
        ORDER BY clinic_id, threshold_key, updated_at DESC, id DESC
     )
  `);

  await knex.schema.alterTable('clinic_thresholds', (t) => {
    t.unique(['clinic_id', 'threshold_key'], {
      indexName: 'uq_clinic_thresholds_clinic_id_threshold_key',
    });
  });
}

export async function down(knex: Knex): Promise<void> {
  // Idempotent drop per CLAUDE.md §12.4 / PR-R1-3 rollback discipline.
  // Pre-fix the builder `t.dropUnique(...)` emitted raw `ALTER TABLE
  // ... DROP CONSTRAINT "uq_..."` WITHOUT `IF EXISTS` — re-running
  // down() after a successful prior down would error. Closes
  // BUG-592-FOLLOWUP-DBADMIN-THRESHOLDS-FOLLOWUP-DOWN-IDEMPOTENT
  // (2026-05-03 L5 advisory).
  // @migration-raw-exempt: drop_constraint_if_exists
  await knex.raw(
    'ALTER TABLE clinic_thresholds DROP CONSTRAINT IF EXISTS uq_clinic_thresholds_clinic_id_threshold_key',
  );
}
