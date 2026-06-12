import type { Knex } from 'knex';

/**
 * BUG-051 follow-up: feature-flag bootstrap must see global flags under
 * FORCE RLS. The baseline tenant policy hides `clinic_id IS NULL` rows;
 * this read-only global policy lets frontend bootstrap and backend guards
 * converge without requiring a BYPASSRLS runtime role.
 */
export async function up(knex: Knex): Promise<void> {
  // @migration-raw-exempt: rls_policy
  await knex.raw(`
    DROP POLICY IF EXISTS rls_feature_flags_global_read ON feature_flags;
    CREATE POLICY rls_feature_flags_global_read
      ON feature_flags
      FOR SELECT
      USING (clinic_id IS NULL);
  `);
}

export async function down(knex: Knex): Promise<void> {
  // @migration-raw-exempt: rls_policy
  await knex.raw(`
    DROP POLICY IF EXISTS rls_feature_flags_global_read ON feature_flags;
  `);
}
