import type { Knex } from 'knex';

/**
 * Phase 0.7.5 c24 D12 — SD59-62 fix: add 4 missing columns to
 * restrictive_interventions.
 *
 * bedRoutes.ts POST /restrictive-interventions writes
 * `alternatives_tried` (clinical rationale — what was tried before
 * restrictive action). bedRoutes.ts POST /restrictive-interventions/:id/end
 * writes `debrief_completed`, `debrief_notes`, `notified_persons`
 * (post-incident review). None of these columns existed.
 *
 * Clinical governance: restrictive interventions (seclusion, restraint)
 * require mandatory debrief + documentation of alternatives tried, per
 * Australian Mental Health Commission standards. The code was trying
 * to capture these; the DB was silently dropping them. This is a
 * patient-safety documentation gap.
 */
export async function up(knex: Knex): Promise<void> {
  await knex.schema.alterTable('restrictive_interventions', (t) => {
    t.text('alternatives_tried');
    t.boolean('debrief_completed').notNullable().defaultTo(false);
    t.text('debrief_notes');
    t.jsonb('notified_persons');
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.alterTable('restrictive_interventions', (t) => {
    t.dropColumn('alternatives_tried');
    t.dropColumn('debrief_completed');
    t.dropColumn('debrief_notes');
    t.dropColumn('notified_persons');
  });
}
