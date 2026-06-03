import type { Knex } from 'knex';

/**
 * BUG-ARCH-S0-4: Enforce FORCE RLS on behavioral-pathway tables.
 *
 * Production boot gate currently reports 8 public RLS tables that are
 * enabled but not FORCE-enabled. Those tables were introduced in the
 * behavioral-pathways foundation and must align with the global
 * FORCE-RLS baseline.
 */
const TARGETS = [
  'clinic_choice_architecture_defaults',
  'clinic_micro_learning_rules',
  'micro_learning_cards',
  'patient_behavior_contracts',
  'patient_behavioral_segments',
  'patient_micro_learning_assignments',
  'patient_routine_events',
  'patient_routine_plans',
] as const;

export async function up(knex: Knex): Promise<void> {
  for (const tableName of TARGETS) {
    // @migration-raw-exempt: dynamic_identifier
    await knex.raw(`ALTER TABLE IF EXISTS ${tableName} FORCE ROW LEVEL SECURITY;`);
  }
}

export async function down(knex: Knex): Promise<void> {
  for (const tableName of TARGETS) {
    // @migration-raw-exempt: dynamic_identifier
    await knex.raw(`ALTER TABLE IF EXISTS ${tableName} NO FORCE ROW LEVEL SECURITY;`);
  }
}
