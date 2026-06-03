import type { Knex } from 'knex';

/**
 * Add prescription_category column to prescriptions table.
 * Values: 'outpatient' (default), 'inpatient', 'discharge'.
 * Maps to the eRx PatientHospitalCategory flag (true for inpatient/discharge).
 */
export async function up(knex: Knex): Promise<void> {
  const hasColumn = await knex.schema.hasColumn('prescriptions', 'prescription_category');
  if (!hasColumn) {
    await knex.schema.alterTable('prescriptions', (t) => {
      t.string('prescription_category', 30)
        .notNullable()
        .defaultTo('outpatient')
        .checkIn(['outpatient', 'inpatient', 'discharge']);
    });
  }
}

export async function down(knex: Knex): Promise<void> {
  const hasColumn = await knex.schema.hasColumn('prescriptions', 'prescription_category');
  if (hasColumn) {
    await knex.schema.alterTable('prescriptions', (t) => {
      t.dropColumn('prescription_category');
    });
  }
}
