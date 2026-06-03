import { Knex } from 'knex';

/**
 * Audit Tier 6.1 (MED-H1) — confidentiality level on clinical formulations.
 *
 * Builds on Tier 1.3's `shared_with_clinicians` boolean: a 3-tier
 * confidentiality enum lets the psychiatrist pick per-formulation access:
 *
 *   standard     — default. Visible per existing rules (author + shared)
 *   confidential — author + admin/superadmin only
 *   restricted   — author only
 *
 * Routing logic (implemented in psychiatristFeatureRoutes):
 *   standard:     existing behaviour (shared_with_clinicians controls)
 *   confidential: WHERE author_id = auth.staffId OR role IN ('admin','superadmin')
 *   restricted:   WHERE author_id = auth.staffId
 *
 * Indexed (clinic_id, confidentiality_level) because the GET-list query
 * filters on both.
 */
export async function up(knex: Knex): Promise<void> {
  await knex.schema.alterTable('clinical_formulations', (t) => {
    t.text('confidentiality_level').notNullable().defaultTo('standard');
    t.index(['clinic_id', 'confidentiality_level']);
  });

  // @migration-raw-exempt: check_constraint
  await knex.raw(`
    ALTER TABLE clinical_formulations
      ADD CONSTRAINT clinical_formulations_confidentiality_level_check
      CHECK (confidentiality_level IN ('standard','confidential','restricted'))
  `);
}

export async function down(knex: Knex): Promise<void> {
  // @migration-raw-exempt: drop_constraint_if_exists
  await knex.raw('ALTER TABLE clinical_formulations DROP CONSTRAINT IF EXISTS clinical_formulations_confidentiality_level_check');
  await knex.schema.alterTable('clinical_formulations', (t) => {
    t.dropIndex(['clinic_id', 'confidentiality_level']);
    t.dropColumn('confidentiality_level');
  });
}
