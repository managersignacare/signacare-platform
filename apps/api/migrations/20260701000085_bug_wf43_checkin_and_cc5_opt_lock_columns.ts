import { Knex } from 'knex';

/**
 * BUG-WF43 / CC-5
 *
 * - Add durable check-in fields on appointments.
 * - Add optimistic-lock columns to high-mutation surfaces that lacked
 *   lock_version coverage (appointments, outcome_measures, pathology_results).
 */
export async function up(knex: Knex): Promise<void> {
  const hasAppointmentsCheckInAt = await knex.schema.hasColumn('appointments', 'check_in_at');
  const hasAppointmentsCheckedInBy = await knex.schema.hasColumn('appointments', 'checked_in_by_id');
  const hasAppointmentsLockVersion = await knex.schema.hasColumn('appointments', 'lock_version');
  const hasOutcomeMeasuresLockVersion = await knex.schema.hasColumn('outcome_measures', 'lock_version');
  const hasPathologyResultsLockVersion = await knex.schema.hasColumn('pathology_results', 'lock_version');

  await knex.schema.alterTable('appointments', (t) => {
    if (!hasAppointmentsCheckInAt) {
      t.timestamp('check_in_at', { useTz: true }).nullable();
    }
    if (!hasAppointmentsCheckedInBy) {
      t.uuid('checked_in_by_id').nullable();
    }
    if (!hasAppointmentsLockVersion) {
      t.integer('lock_version').notNullable().defaultTo(1);
    }
  });

  if (!hasAppointmentsCheckedInBy) {
    await knex.schema.alterTable('appointments', (t) => {
      t.foreign('checked_in_by_id').references('staff.id').onDelete('SET NULL');
      t.index(['checked_in_by_id']);
    });
  }

  if (!hasOutcomeMeasuresLockVersion) {
    await knex.schema.alterTable('outcome_measures', (t) => {
      t.integer('lock_version').notNullable().defaultTo(1);
    });
  }

  if (!hasPathologyResultsLockVersion) {
    await knex.schema.alterTable('pathology_results', (t) => {
      t.integer('lock_version').notNullable().defaultTo(1);
    });
  }
}

export async function down(knex: Knex): Promise<void> {
  const hasAppointmentsCheckInAt = await knex.schema.hasColumn('appointments', 'check_in_at');
  const hasAppointmentsCheckedInBy = await knex.schema.hasColumn('appointments', 'checked_in_by_id');

  if (hasAppointmentsCheckedInBy) {
    // @migration-raw-exempt: drop_constraint_if_exists
    await knex.raw(
      'ALTER TABLE appointments DROP CONSTRAINT IF EXISTS appointments_checked_in_by_id_foreign',
    );
  }

  await knex.schema.alterTable('appointments', (t) => {
    if (hasAppointmentsCheckInAt) {
      t.dropColumn('check_in_at');
    }
    if (hasAppointmentsCheckedInBy) {
      t.dropColumn('checked_in_by_id');
    }
  });
  // lock_version columns are intentionally append-only safety posture.
}
