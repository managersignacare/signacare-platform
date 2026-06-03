import type { Knex } from 'knex';

/**
 * BUG-ARCH-FORCE-RLS-BASELINE
 *
 * Backfill FORCE RLS for `clinic_sequences`, which was introduced after the
 * baseline FORCE-RLS sweep migration.
 */
export async function up(knex: Knex): Promise<void> {
  const exists = await knex.schema.hasTable('clinic_sequences');
  if (!exists) return;

  // @migration-raw-exempt: rls_policy
  await knex.raw('ALTER TABLE clinic_sequences FORCE ROW LEVEL SECURITY');
}

export async function down(knex: Knex): Promise<void> {
  const exists = await knex.schema.hasTable('clinic_sequences');
  if (!exists) return;

  // @migration-raw-exempt: rls_policy
  await knex.raw('ALTER TABLE clinic_sequences NO FORCE ROW LEVEL SECURITY');
}

