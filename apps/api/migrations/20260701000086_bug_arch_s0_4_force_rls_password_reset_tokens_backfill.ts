import type { Knex } from 'knex';

/**
 * BUG-ARCH-S0-4
 *
 * Backfill FORCE-RLS posture for password_reset_tokens in environments where
 * migration 20260701000084 ran before FORCE enforcement was added.
 */
export async function up(knex: Knex): Promise<void> {
  const exists = await knex.schema.hasTable('password_reset_tokens');
  if (!exists) return;

  // @migration-raw-exempt: rls_policy
  await knex.raw('ALTER TABLE password_reset_tokens ENABLE ROW LEVEL SECURITY');
  // @migration-raw-exempt: rls_policy
  await knex.raw('ALTER TABLE password_reset_tokens FORCE ROW LEVEL SECURITY');
}

export async function down(knex: Knex): Promise<void> {
  const exists = await knex.schema.hasTable('password_reset_tokens');
  if (!exists) return;

  // @migration-raw-exempt: rls_policy
  await knex.raw('ALTER TABLE password_reset_tokens NO FORCE ROW LEVEL SECURITY');
}
