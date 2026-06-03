import type { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  // ── clozapine_titration_days: daily dose schedule per registration ──────────
  if (!(await knex.schema.hasTable('clozapine_titration_days'))) {
    await knex.schema.createTable('clozapine_titration_days', (t) => {
      t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
      t.uuid('clinic_id').notNullable().references('id').inTable('clinics').onDelete('RESTRICT');
      t.uuid('registration_id').notNullable().references('id').inTable('clozapine_registrations').onDelete('CASCADE');
      t.integer('day_number').notNullable(); // Day 1–14+ of titration
      t.date('titration_date').notNullable();
      t.decimal('morning_dose_mg', 6, 1).nullable();
      t.decimal('evening_dose_mg', 6, 1).nullable();
      t.string('prescriber_initials', 10).nullable();
      t.uuid('prescribed_by_staff_id').nullable();
      t.text('comments').nullable();
      t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
      t.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
      t.index(['clinic_id', 'registration_id']);
      t.unique(['registration_id', 'day_number']);
    });
  }

  // ── clozapine_administrations: each dose administration event ───────────────
  if (!(await knex.schema.hasTable('clozapine_administrations'))) {
    await knex.schema.createTable('clozapine_administrations', (t) => {
      t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
      t.uuid('clinic_id').notNullable().references('id').inTable('clinics').onDelete('RESTRICT');
      t.uuid('registration_id').notNullable().references('id').inTable('clozapine_registrations').onDelete('CASCADE');
      t.uuid('titration_day_id').nullable().references('id').inTable('clozapine_titration_days').onDelete('SET NULL');
      t.date('administration_date').notNullable();
      t.string('time_slot', 10).notNullable().checkIn(['morning', 'evening']); // 0800 or 2000
      t.string('actual_time', 5).nullable(); // HH:MM if not standard
      t.decimal('dose_mg', 6, 1).notNullable();
      t.boolean('administered').notNullable().defaultTo(true);
      // Non-administration code: A=Absent, F=Fasting, R=Refused, V=Vomiting, L=On leave, N=Not available, W=Withheld, S=Self administered
      t.string('non_admin_code', 2).nullable().checkIn(['A', 'F', 'R', 'V', 'L', 'N', 'W', 'S']);
      t.uuid('administered_by_staff_id').nullable();
      t.string('administrator_initials', 10).nullable();
      t.text('notes').nullable();
      t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
      t.index(['clinic_id', 'registration_id', 'administration_date']);
    });
  }

  // ── clozapine_observations: vitals monitoring per NIMC protocol ─────────────
  if (!(await knex.schema.hasTable('clozapine_observations'))) {
    await knex.schema.createTable('clozapine_observations', (t) => {
      t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
      t.uuid('clinic_id').notNullable().references('id').inTable('clinics').onDelete('RESTRICT');
      t.uuid('registration_id').notNullable().references('id').inTable('clozapine_registrations').onDelete('CASCADE');
      t.date('observation_date').notNullable();
      t.string('observation_time', 5).nullable(); // HH:MM
      t.decimal('temperature', 4, 1).nullable(); // °C
      t.integer('pulse').nullable(); // bpm
      t.integer('bp_systolic_lying').nullable();
      t.integer('bp_diastolic_lying').nullable();
      t.integer('bp_systolic_standing').nullable();
      t.integer('bp_diastolic_standing').nullable();
      t.integer('respiration_rate').nullable();
      t.string('smoking_status', 30).nullable(); // non-smoker, smoker, recently_ceased
      t.integer('cigarettes_per_day').nullable();
      t.boolean('outside_normal').notNullable().defaultTo(false);
      t.text('notes').nullable();
      t.uuid('recorded_by_staff_id').nullable();
      t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
      t.index(['clinic_id', 'registration_id', 'observation_date']);
    });
  }

  // ── clozapine_monitoring_checks: investigations checklist ───────────────────
  if (!(await knex.schema.hasTable('clozapine_monitoring_checks'))) {
    await knex.schema.createTable('clozapine_monitoring_checks', (t) => {
      t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
      t.uuid('clinic_id').notNullable().references('id').inTable('clinics').onDelete('RESTRICT');
      t.uuid('registration_id').notNullable().references('id').inTable('clozapine_registrations').onDelete('CASCADE');
      t.string('investigation', 80).notNullable(); // FBC, WBC, Neutrophils, ECG, LFT, etc.
      t.string('check_point', 30).notNullable(); // baseline, day7, day14, day21, day28, ongoing
      t.date('check_date').nullable();
      t.string('result_status', 20).nullable().checkIn(['normal', 'abnormal', 'pending', 'not_required']);
      t.text('result_value').nullable();
      t.text('notes').nullable();
      t.uuid('recorded_by_staff_id').nullable();
      t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
      t.index(['clinic_id', 'registration_id', 'check_point']);
      t.unique(['registration_id', 'investigation', 'check_point']);
    });
  }

  // RLS for all new tables
  for (const table of [
    'clozapine_titration_days',
    'clozapine_administrations',
    'clozapine_observations',
    'clozapine_monitoring_checks',
  ]) {
    await knex.raw(`ALTER TABLE ${table} ENABLE ROW LEVEL SECURITY`);
    await knex.raw(`
      CREATE POLICY rls_${table}_tenant ON ${table}
        FOR ALL
        USING (clinic_id = current_setting('app.clinic_id', true)::uuid)
        WITH CHECK (clinic_id = current_setting('app.clinic_id', true)::uuid)
    `);
  }
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('clozapine_monitoring_checks');
  await knex.schema.dropTableIfExists('clozapine_observations');
  await knex.schema.dropTableIfExists('clozapine_administrations');
  await knex.schema.dropTableIfExists('clozapine_titration_days');
}
