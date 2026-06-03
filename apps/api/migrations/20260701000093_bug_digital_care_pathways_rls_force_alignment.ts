import type { Knex } from 'knex';

/**
 * Align FORCE RLS posture for digital-care foundation tables.
 *
 * Why:
 * - Migration 92 initially shipped with FORCE RLS on these tables in some environments.
 * - Automation/scheduler services operate under system context and require owner-level
 *   visibility while still preserving tenant-scoped RLS policies.
 *
 * This migration is intentionally forward-only to normalize already-migrated environments.
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
    await knex.raw(`ALTER TABLE IF EXISTS ${tableName} NO FORCE ROW LEVEL SECURITY;`);
  }
}

export async function down(_knex: Knex): Promise<void> {
  // @migration-down-noop: forward-only FORCE RLS posture normalization; do not auto-re-enable FORCE in rollback
  // Intentionally no-op: do not re-enable FORCE automatically.
}
