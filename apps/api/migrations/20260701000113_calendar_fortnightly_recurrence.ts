import type { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  const hasTable = await knex.schema.hasTable('clinician_availability_blocks');
  if (!hasTable) return;

  // @migration-raw-exempt: drop_constraint_if_exists
  await knex.raw(`
    ALTER TABLE clinician_availability_blocks
    DROP CONSTRAINT IF EXISTS cab_recurrence_chk
  `);
  // @migration-raw-exempt: drop_constraint_if_exists
  await knex.raw(`
    ALTER TABLE clinician_availability_blocks
    DROP CONSTRAINT IF EXISTS cab_recurrence_shape_chk
  `);

  // @migration-raw-exempt: check_constraint
  await knex.raw(`
    ALTER TABLE clinician_availability_blocks
    ADD CONSTRAINT cab_recurrence_chk
    CHECK (recurrence IN ('none', 'weekly', 'fortnightly'))
  `);
  // @migration-raw-exempt: check_constraint
  await knex.raw(`
    ALTER TABLE clinician_availability_blocks
    ADD CONSTRAINT cab_recurrence_shape_chk
    CHECK (
      (
        recurrence IN ('weekly', 'fortnightly')
        AND day_of_week IS NOT NULL
        AND specific_date IS NULL
      )
      OR (
        recurrence = 'none'
        AND day_of_week IS NULL
        AND specific_date IS NOT NULL
      )
    )
  `);
}

export async function down(knex: Knex): Promise<void> {
  const hasTable = await knex.schema.hasTable('clinician_availability_blocks');
  if (!hasTable) return;

  // @migration-raw-exempt: drop_constraint_if_exists
  await knex.raw(`
    ALTER TABLE clinician_availability_blocks
    DROP CONSTRAINT IF EXISTS cab_recurrence_chk
  `);
  // @migration-raw-exempt: drop_constraint_if_exists
  await knex.raw(`
    ALTER TABLE clinician_availability_blocks
    DROP CONSTRAINT IF EXISTS cab_recurrence_shape_chk
  `);

  // @migration-raw-exempt: check_constraint
  await knex.raw(`
    ALTER TABLE clinician_availability_blocks
    ADD CONSTRAINT cab_recurrence_chk
    CHECK (recurrence IN ('none', 'weekly'))
  `);
  // @migration-raw-exempt: check_constraint
  await knex.raw(`
    ALTER TABLE clinician_availability_blocks
    ADD CONSTRAINT cab_recurrence_shape_chk
    CHECK (
      (
        recurrence = 'weekly'
        AND day_of_week IS NOT NULL
        AND specific_date IS NULL
      )
      OR (
        recurrence = 'none'
        AND day_of_week IS NULL
        AND specific_date IS NOT NULL
      )
    )
  `);
}
