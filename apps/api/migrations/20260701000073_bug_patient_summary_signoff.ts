import type { Knex } from 'knex';

/**
 * BUG-PATIENT-SUMMARY-SIGNOFF — consultant sign-off metadata for
 * longitudinal summary, clinical formulation, life chart, care provision,
 * and diagnosis summary with deterministic review cadence.
 */
export async function up(knex: Knex): Promise<void> {
  const hasTable = await knex.schema.hasTable('patient_summary_signoffs');
  if (hasTable) return;

  await knex.schema.createTable('patient_summary_signoffs', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.uuid('clinic_id').notNullable().references('id').inTable('clinics').onDelete('CASCADE');
    t.uuid('patient_id').notNullable().references('id').inTable('patients').onDelete('CASCADE');
    t
      .string('summary_section', 64)
      .notNullable();
    t.uuid('signed_off_by_id').notNullable().references('id').inTable('staff').onDelete('RESTRICT');
    t.timestamp('signed_off_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.date('review_due_date').notNullable();
    t.integer('review_interval_months').notNullable().defaultTo(6);
    t.uuid('reminder_task_id').nullable().references('id').inTable('tasks').onDelete('SET NULL');
    t.integer('lock_version').notNullable().defaultTo(1);
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());

    t.unique(['patient_id', 'summary_section'], {
      indexName: 'ux_patient_summary_signoffs_patient_section',
    });
    t.index(['clinic_id'], 'idx_patient_summary_signoffs_clinic_id');
    t.index(['patient_id'], 'idx_patient_summary_signoffs_patient_id');
    t.index(['signed_off_by_id'], 'idx_patient_summary_signoffs_signed_off_by_id');
    t.index(['reminder_task_id'], 'idx_patient_summary_signoffs_reminder_task_id');
    t.index(['review_due_date'], 'idx_patient_summary_signoffs_review_due_date');
  });

  // @migration-raw-exempt: check_constraint
  await knex.raw(`
    ALTER TABLE patient_summary_signoffs
    ADD CONSTRAINT chk_patient_summary_signoffs_section
    CHECK (summary_section IN (
      'longitudinal_summary',
      'clinical_formulation',
      'life_chart',
      'care_provision_summary',
      'diagnosis_summary'
    ))
  `);

  // @migration-raw-exempt: check_constraint
  await knex.raw(`
    ALTER TABLE patient_summary_signoffs
    ADD CONSTRAINT chk_patient_summary_signoffs_interval_months
    CHECK (review_interval_months IN (3, 6))
  `);

  // @migration-raw-exempt: trigger_create
  await knex.raw(`
    CREATE TRIGGER trg_patient_summary_signoffs_updated_at
      BEFORE UPDATE ON patient_summary_signoffs
      FOR EACH ROW EXECUTE FUNCTION set_updated_at()
  `);

  // @migration-raw-exempt: rls_policy
  await knex.raw(`
    ALTER TABLE patient_summary_signoffs ENABLE ROW LEVEL SECURITY;
    CREATE POLICY rls_patient_summary_signoffs_tenant ON patient_summary_signoffs
      USING (clinic_id = NULLIF(current_setting('app.clinic_id', true), '')::uuid)
      WITH CHECK (clinic_id = NULLIF(current_setting('app.clinic_id', true), '')::uuid);
  `);
}

export async function down(knex: Knex): Promise<void> {
  const hasTable = await knex.schema.hasTable('patient_summary_signoffs');
  if (!hasTable) return;
  // @migration-raw-exempt: drop_policy_if_exists
  await knex.raw('DROP POLICY IF EXISTS rls_patient_summary_signoffs_tenant ON patient_summary_signoffs');
  // @migration-raw-exempt: trigger_drop
  await knex.raw('DROP TRIGGER IF EXISTS trg_patient_summary_signoffs_updated_at ON patient_summary_signoffs');
  await knex.schema.dropTableIfExists('patient_summary_signoffs');
}
