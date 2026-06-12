import type { Knex } from 'knex';

const TABLE = 'patient_duty_relationships';

export async function up(knex: Knex): Promise<void> {
  if (await knex.schema.hasTable(TABLE)) return;

  await knex.schema.createTable(TABLE, (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.uuid('clinic_id').notNullable().references('id').inTable('clinics').onDelete('RESTRICT');
    t.uuid('patient_id').notNullable().references('id').inTable('patients').onDelete('CASCADE');
    t.uuid('staff_id').notNullable().references('id').inTable('staff').onDelete('CASCADE');
    t.uuid('created_by_id').nullable().references('id').inTable('staff').onDelete('SET NULL');
    t.string('relationship_type', 40).notNullable();
    t.text('reason').notNullable();
    t.timestamp('expires_at', { useTz: true }).notNullable();
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.integer('lock_version').notNullable().defaultTo(1);
    t.timestamp('revoked_at', { useTz: true }).nullable();
    t.uuid('revoked_by_id').nullable().references('id').inTable('staff').onDelete('SET NULL');

    t.index(['clinic_id'], 'idx_patient_duty_relationships_clinic');
    t.index(['patient_id'], 'idx_patient_duty_relationships_patient');
    t.index(['staff_id'], 'idx_patient_duty_relationships_staff');
    t.index(
      ['patient_id', 'staff_id', 'relationship_type'],
      'idx_patient_duty_relationships_patient_staff_type',
    );
  });

  // @migration-raw-exempt: check_constraint
  await knex.raw(`
    ALTER TABLE ${TABLE}
      ADD CONSTRAINT patient_duty_relationships_type_check
      CHECK (relationship_type IN ('duty_clinician', 'duty_prescriber'));
  `);

  // @migration-raw-exempt: rls_policy
  await knex.raw(`
    ALTER TABLE ${TABLE} ENABLE ROW LEVEL SECURITY;
    ALTER TABLE ${TABLE} FORCE ROW LEVEL SECURITY;
    CREATE POLICY rls_patient_duty_relationships_tenant
      ON ${TABLE}
      USING (clinic_id = NULLIF(current_setting('app.clinic_id', true), '')::uuid)
      WITH CHECK (clinic_id = NULLIF(current_setting('app.clinic_id', true), '')::uuid);
  `);
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists(TABLE);
}
