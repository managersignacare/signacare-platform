import type { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  // ── lai_validations: prescription revalidation for ongoing LAI administration ─
  // Rules:
  //   1. If gap between administrations > 90 days (3 months) → revalidation required
  //   2. Even with regular administration, revalidation required every 180 days (6 months)
  //   3. Each validation records the clinician who approved continuation
  if (!(await knex.schema.hasTable('lai_validations'))) {
    await knex.schema.createTable('lai_validations', (t) => {
      t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
      t.uuid('clinic_id').notNullable().references('id').inTable('clinics').onDelete('RESTRICT');
      t.uuid('lai_schedule_id').notNullable().references('id').inTable('lai_schedules').onDelete('CASCADE');
      t.uuid('patient_id').notNullable().references('id').inTable('patients').onDelete('RESTRICT');
      t.uuid('validated_by_staff_id').notNullable();
      t.date('validation_date').notNullable();
      t.date('valid_until').notNullable(); // typically validation_date + 180 days
      t.string('validation_type', 30).notNullable().checkIn([
        'initial',       // first validation at start of LAI
        'routine',       // scheduled 6-monthly revalidation
        'gap_restart',   // revalidation after >3 month gap
      ]);
      t.string('outcome', 20).notNullable().defaultTo('approved').checkIn([
        'approved',      // LAI continues
        'modified',      // LAI continues with dose/frequency change
        'ceased',        // LAI stopped
      ]);
      // Clinical details
      t.text('clinical_rationale').nullable();
      t.text('side_effects_reviewed').nullable();
      t.boolean('consent_confirmed').notNullable().defaultTo(false);
      t.boolean('blood_tests_reviewed').notNullable().defaultTo(false);
      t.boolean('aims_reviewed').notNullable().defaultTo(false);
      t.text('notes').nullable();
      t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
      t.index(['clinic_id', 'lai_schedule_id']);
      t.index(['clinic_id', 'patient_id']);
      t.index(['clinic_id', 'valid_until']);
    });

    // RLS
    await knex.raw('ALTER TABLE lai_validations ENABLE ROW LEVEL SECURITY');
    await knex.raw(`
      CREATE POLICY rls_lai_validations_tenant ON lai_validations
        FOR ALL
        USING (clinic_id = current_setting('app.clinic_id', true)::uuid)
        WITH CHECK (clinic_id = current_setting('app.clinic_id', true)::uuid)
    `);
  }
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('lai_validations');
}
