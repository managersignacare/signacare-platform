import type { Knex } from 'knex';

/**
 * BUG-A5.3 follow-up:
 * Ensure `hi_error_log` has the expected lookup indexes in long-lived DBs
 * where the table pre-dated migration 20260701000069.
 */

export async function up(knex: Knex): Promise<void> {
  // @migration-raw-exempt: index_functional
  await knex.raw(`
    CREATE INDEX IF NOT EXISTS idx_hi_error_log_patient_id
      ON hi_error_log (patient_id)
  `);
  // @migration-raw-exempt: index_functional
  await knex.raw(`
    CREATE INDEX IF NOT EXISTS idx_hi_error_log_created_by_staff_id
      ON hi_error_log (created_by_staff_id)
  `);
}

export async function down(knex: Knex): Promise<void> {
  // @migration-raw-exempt: index_functional
  await knex.raw('DROP INDEX IF EXISTS idx_hi_error_log_patient_id');
  // @migration-raw-exempt: index_functional
  await knex.raw('DROP INDEX IF EXISTS idx_hi_error_log_created_by_staff_id');
}
