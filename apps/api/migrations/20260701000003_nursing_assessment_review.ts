import { Knex } from 'knex';

/**
 * Phase R follow-up (2026-04-18) — Bug 6. The "due nursing assessments"
 * query in `crossRoleFeatureRoutes.ts` (clinical alerts dashboard) has
 * referenced `review_datetime` since Phase 0, but no migration ever added
 * the column. Every clinical alerts query crashed with
 * `column "review_datetime" does not exist`; a try/catch swallowed it,
 * silently producing empty due-assessment alerts since day one.
 *
 * Decision (user-confirmed 2026-04-18, Option A): restore the feature.
 * Add `next_review_at timestamptz NULL` + an index scoped to
 * (clinic_id, next_review_at) for the "due in next 24 hours" sweep.
 *
 * Backfill: existing rows had NULL so no value could have been set. The
 * two inline UPDATEs populate a sensible default based on `assessment_type`:
 *   - risk assessments reviewed every 7 days
 *   - every other type reviewed every 28 days
 * The defaults match the clinical convention documented in the due-alerts
 * query in crossRoleFeatureRoutes.ts. Safe because `next_review_at` had no
 * prior value to overwrite.
 */
export async function up(knex: Knex): Promise<void> {
  await knex.schema.alterTable('nursing_assessments', (t) => {
    t.timestamp('next_review_at', { useTz: true }).nullable();
    t.index(['clinic_id', 'next_review_at']);
  });

  // @migration-raw-exempt: data_backfill_update
  await knex.raw(`
    UPDATE nursing_assessments
       SET next_review_at = assessed_at + INTERVAL '7 days'
     WHERE assessment_type ILIKE '%risk%';
  `);
  // @migration-raw-exempt: data_backfill_update
  await knex.raw(`
    UPDATE nursing_assessments
       SET next_review_at = assessed_at + INTERVAL '28 days'
     WHERE next_review_at IS NULL;
  `);
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.alterTable('nursing_assessments', (t) => {
    t.dropIndex(['clinic_id', 'next_review_at']);
    t.dropColumn('next_review_at');
  });
}
