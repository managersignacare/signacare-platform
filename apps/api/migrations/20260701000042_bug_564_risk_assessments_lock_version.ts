/*
 * apps/api/migrations/20260701000042_bug_564_risk_assessments_lock_version.ts
 *
 * BUG-564 — Add `lock_version` integer column to `risk_assessments`.
 *
 * Sibling pattern of BUG-371a (prescriptions/patient_medications/episodes)
 * + BUG-402 (treatment_pathways). The premise: suicide-risk score
 * (C-SSRS / HoNOS) is multi-clinician collaboratively scored during MDT
 * review. Today the API has no UPDATE endpoint so the harm is preventive
 * rather than active — adding the column NOW means any future UPDATE
 * author MUST route through `updateWithOptimisticLock` (which requires
 * `lock_version` integer + 1 atomically), preventing silent overwrites
 * of `suicide_risk` / `overall_risk_level` / etc. by a future code path.
 *
 * Default 1; NOT NULL; monotonically incremented by
 * `apps/api/src/shared/db/optimisticLock.ts:updateWithOptimisticLock`.
 *
 * Down() is a NO-OP per the clinical_notes / BUG-371 precedent —
 * dropping lock_version mid-production silently disables conflict
 * detection on the rollback window. Append-only.
 *
 * Builder-first per CLAUDE.md §12.1 — uses only `knex.schema.alterTable
 * + t.integer().notNullable().defaultTo(1)`. NO knex.raw() needed; NO
 * §12.4 taxonomy annotation required. Idempotency-guarded with
 * `hasColumn` so re-running the migration is safe.
 */

import type { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  const has = await knex.schema.hasColumn('risk_assessments', 'lock_version');
  if (!has) {
    await knex.schema.alterTable('risk_assessments', (t) => {
      t.integer('lock_version').notNullable().defaultTo(1);
    });
  }
}

export async function down(_knex: Knex): Promise<void> {
  // @migration-down-noop: BUG-564 + BUG-371 precedent. Dropping
  // lock_version mid-rollback silently disables conflict detection on
  // subsequent UPDATEs while client/server versions diverge —
  // append-only is safer than the rollback-rollforward complexity.
}
