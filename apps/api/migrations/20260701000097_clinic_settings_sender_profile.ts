import type { Knex } from 'knex';

/**
 * Clinic-level outbound sender profile.
 *
 * Adds a per-clinic sender mode and sender identity so admin users can
 * choose whether outbound emails should use:
 *   - staff_delegated (existing behavior), or
 *   - clinic_mailbox (clinic-level no-reply mailbox / branded sender).
 *
 * Validation is enforced at DB level via CHECK constraint.
 */
export async function up(knex: Knex): Promise<void> {
  await knex.schema.alterTable('clinic_settings', (t) => {
    t.text('email_sender_mode').notNullable().defaultTo('staff_delegated');
    t.string('clinic_sender_email', 255).nullable();
    t.string('clinic_sender_name', 120).nullable();
  });

  // @migration-raw-exempt: check_constraint
  await knex.raw(`
    ALTER TABLE clinic_settings
      ADD CONSTRAINT clinic_settings_email_sender_mode_check
      CHECK (email_sender_mode IN ('staff_delegated', 'clinic_mailbox'));
  `);
}

export async function down(knex: Knex): Promise<void> {
  // @migration-raw-exempt: drop_constraint_if_exists
  await knex.raw(`
    ALTER TABLE clinic_settings
      DROP CONSTRAINT IF EXISTS clinic_settings_email_sender_mode_check;
  `);

  await knex.schema.alterTable('clinic_settings', (t) => {
    t.dropColumn('clinic_sender_name');
    t.dropColumn('clinic_sender_email');
    t.dropColumn('email_sender_mode');
  });
}
