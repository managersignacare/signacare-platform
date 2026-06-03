import type { Knex } from 'knex';

/**
 * BUG-PATIENT-SUMMARY-SIGNOFF-RLS-FIX
 *
 * Repair policy key for environments that already applied
 * 20260701000073_bug_patient_summary_signoff.ts with the wrong
 * session setting name.
 */
export async function up(knex: Knex): Promise<void> {
  const hasTable = await knex.schema.hasTable('patient_summary_signoffs');
  if (!hasTable) return;

  // @migration-raw-exempt: rls_policy
  await knex.raw(`
    DROP POLICY IF EXISTS rls_patient_summary_signoffs_tenant ON patient_summary_signoffs;
    CREATE POLICY rls_patient_summary_signoffs_tenant ON patient_summary_signoffs
      USING (clinic_id = NULLIF(current_setting('app.clinic_id', true), '')::uuid)
      WITH CHECK (clinic_id = NULLIF(current_setting('app.clinic_id', true), '')::uuid);
  `);
}

export async function down(knex: Knex): Promise<void> {
  const hasTable = await knex.schema.hasTable('patient_summary_signoffs');
  if (!hasTable) return;

  // @migration-raw-exempt: rls_policy
  await knex.raw(`
    DROP POLICY IF EXISTS rls_patient_summary_signoffs_tenant ON patient_summary_signoffs;
    CREATE POLICY rls_patient_summary_signoffs_tenant ON patient_summary_signoffs
      USING (clinic_id = NULLIF(current_setting('app.clinic_id', true), '')::uuid)
      WITH CHECK (clinic_id = NULLIF(current_setting('app.clinic_id', true), '')::uuid);
  `);
}

