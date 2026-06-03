import type { Knex } from 'knex';

/**
 * BUG-CLINIC-ONBOARDING-EMAIL-REUSE
 *
 * Legacy uniqueness constraints on `staff.email` and `(clinic_id, email)`
 * ignored soft-delete state. That blocked onboarding/staff-create with:
 * "A record with this email already exists." even when the prior row was
 * soft-deleted.
 *
 * Canonical uniqueness is now:
 *   staff_email_normalized_active_uniq
 *   UNIQUE (LOWER(email)) WHERE deleted_at IS NULL
 *
 * So we remove stale always-on constraints that conflict with that contract.
 */
export async function up(knex: Knex): Promise<void> {
  const hasStaff = await knex.schema.hasTable('staff');
  if (!hasStaff) return;

  // @migration-raw-exempt: drop_constraint_if_exists
  await knex.raw('ALTER TABLE staff DROP CONSTRAINT IF EXISTS staff_email_unique');
  // @migration-raw-exempt: drop_constraint_if_exists
  await knex.raw('ALTER TABLE staff DROP CONSTRAINT IF EXISTS uq_staff_clinic_email');
}

export async function down(knex: Knex): Promise<void> {
  const hasStaff = await knex.schema.hasTable('staff');
  if (!hasStaff) return;

  const duplicateEmailRows = await knex('staff')
    .select(knex.raw('email, COUNT(*)::int AS cnt'))
    .groupBy('email')
    .havingRaw('COUNT(*) > 1')
    .limit(1);

  // If duplicates exist, re-adding legacy constraints is impossible.
  // Keep rollback safe + deterministic by skipping constraint recreation.
  if (duplicateEmailRows.length > 0) return;

  await knex.schema.alterTable('staff', (table) => {
    table.unique(['email'], { indexName: 'staff_email_unique' });
    table.unique(['clinic_id', 'email'], { indexName: 'uq_staff_clinic_email' });
  });
}
