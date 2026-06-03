import type { Knex } from 'knex';

/**
 * Re-assert ARCH-S0-4 FORCE-RLS baseline on digital pathway tables.
 *
 * 20260701000093 temporarily relaxed FORCE RLS for these tables.
 * The enterprise baseline now requires every RLS-enabled public table
 * to run with FORCE RLS, so we align these four back to the global policy.
 */
export async function up(knex: Knex): Promise<void> {
  const targets = [
    'clinic_step_care_rules',
    'step_care_rule_events',
    'patient_device_sources',
    'patient_digital_phenotypes',
  ] as const;

  for (const tableName of targets) {
    // @migration-raw-exempt: dynamic_identifier
    await knex.raw(`ALTER TABLE IF EXISTS ${tableName} FORCE ROW LEVEL SECURITY;`);
  }
}

export async function down(knex: Knex): Promise<void> {
  const targets = [
    'clinic_step_care_rules',
    'step_care_rule_events',
    'patient_device_sources',
    'patient_digital_phenotypes',
  ] as const;

  for (const tableName of targets) {
    // @migration-raw-exempt: dynamic_identifier
    await knex.raw(`ALTER TABLE IF EXISTS ${tableName} NO FORCE ROW LEVEL SECURITY;`);
  }
}

