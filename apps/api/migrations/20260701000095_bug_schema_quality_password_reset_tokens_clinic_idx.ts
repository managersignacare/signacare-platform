import type { Knex } from 'knex';

/**
 * schemaQuality.test.ts hard gate:
 * Every table with clinic_id must have an index covering clinic_id.
 *
 * password_reset_tokens gained clinic_id under FORCE-RLS hardening but
 * missed the corresponding index, causing seq scans under tenant scope.
 */
export async function up(knex: Knex): Promise<void> {
  // @migration-raw-exempt: index_partial
  await knex.raw(`
    CREATE INDEX IF NOT EXISTS password_reset_tokens_clinic_id_idx
      ON password_reset_tokens (clinic_id);
  `);
}

export async function down(knex: Knex): Promise<void> {
  // @migration-raw-exempt: idempotency_guard
  await knex.raw('DROP INDEX IF EXISTS password_reset_tokens_clinic_id_idx');
}
