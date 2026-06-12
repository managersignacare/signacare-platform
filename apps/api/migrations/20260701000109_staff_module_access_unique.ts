import type { Knex } from 'knex';

const CONSTRAINT_NAME = 'staff_module_access_staff_id_clinic_id_module_unique';

export async function up(knex: Knex): Promise<void> {
  // @migration-raw-exempt: data_backfill_update
  await knex.raw(`
    DELETE FROM staff_module_access a
    USING staff_module_access b
    WHERE a.id < b.id
      AND a.staff_id = b.staff_id
      AND a.clinic_id = b.clinic_id
      AND a.module = b.module
  `);

  // @migration-raw-exempt: check_constraint
  await knex.raw(`
    ALTER TABLE staff_module_access
    ADD CONSTRAINT ${CONSTRAINT_NAME}
    UNIQUE (staff_id, clinic_id, module)
  `);
}

export async function down(knex: Knex): Promise<void> {
  // @migration-raw-exempt: drop_constraint_if_exists
  await knex.raw(`
    ALTER TABLE staff_module_access
    DROP CONSTRAINT IF EXISTS ${CONSTRAINT_NAME}
  `);
}
