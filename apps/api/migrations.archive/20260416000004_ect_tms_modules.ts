/**
 * Phase 0.7.2 Steps 7-8: ECT + TMS clinical modules.
 *
 * ECT (Electroconvulsive Therapy) and TMS (Transcranial Magnetic
 * Stimulation) are psychiatry-specific treatment modalities that
 * require structured tracking per RANZCP clinical guidelines.
 *
 * Tables follow CLAUDE.md §9.3: clinic_id, RLS, indexes, NOT NULL,
 * soft-delete, unique constraints.
 */
import type { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  // ── ECT courses ─────────────────────────────────────────────────
  if (!(await knex.schema.hasTable('ect_courses'))) {
    await knex.schema.createTable('ect_courses', (t) => {
      t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
      t.uuid('clinic_id').notNullable().references('id').inTable('clinics');
      t.uuid('patient_id').notNullable().references('id').inTable('patients');
      t.uuid('episode_id').nullable().references('id').inTable('episodes');
      t.uuid('treating_psychiatrist_id').notNullable().references('id').inTable('staff');
      t.uuid('anaesthetist_id').nullable().references('id').inTable('staff');
      t.boolean('consent_obtained').notNullable().defaultTo(false);
      t.timestamp('consent_date', { useTz: true }).nullable();
      t.uuid('consent_recorded_by').nullable().references('id').inTable('staff');
      t.integer('total_planned_sessions').notNullable().defaultTo(12);
      t.string('indication', 255).notNullable();
      t.string('status', 30).notNullable().defaultTo('planned');
      t.text('notes').nullable();
      t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
      t.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
      t.timestamp('deleted_at', { useTz: true }).nullable();
      t.index(['clinic_id', 'patient_id']);
      t.index(['treating_psychiatrist_id']);
    });

    await knex.raw(`
      ALTER TABLE ect_courses ADD CONSTRAINT ect_courses_status_check
      CHECK (status IN ('planned', 'active', 'completed', 'discontinued'))
    `);
  }

  // ── ECT sessions ────────────────────────────────────────────────
  if (!(await knex.schema.hasTable('ect_sessions'))) {
    await knex.schema.createTable('ect_sessions', (t) => {
      t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
      t.uuid('course_id').notNullable().references('id').inTable('ect_courses').onDelete('CASCADE');
      t.uuid('clinic_id').notNullable().references('id').inTable('clinics');
      t.integer('session_number').notNullable();
      t.date('session_date').notNullable();
      t.decimal('stimulus_dose_mc', 8, 2).nullable();
      t.integer('seizure_duration_sec').nullable();
      t.string('electrode_placement', 30).notNullable().defaultTo('bilateral');
      t.string('anaesthetic_agent', 100).nullable();
      t.string('muscle_relaxant', 100).nullable();
      t.string('pre_treatment_bp', 20).nullable();
      t.string('post_treatment_bp', 20).nullable();
      t.integer('mmse_score').nullable();
      t.text('adverse_events').nullable();
      t.text('clinician_notes').nullable();
      t.uuid('administered_by').notNullable().references('id').inTable('staff');
      t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
      t.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
      t.index(['course_id', 'session_number']);
      t.index(['clinic_id']);
      t.unique(['course_id', 'session_number']);
    });

    await knex.raw(`
      ALTER TABLE ect_sessions ADD CONSTRAINT ect_sessions_placement_check
      CHECK (electrode_placement IN ('bilateral', 'right_unilateral', 'bifrontal'))
    `);
  }

  // ── TMS courses ─────────────────────────────────────────────────
  if (!(await knex.schema.hasTable('tms_courses'))) {
    await knex.schema.createTable('tms_courses', (t) => {
      t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
      t.uuid('clinic_id').notNullable().references('id').inTable('clinics');
      t.uuid('patient_id').notNullable().references('id').inTable('patients');
      t.uuid('episode_id').nullable().references('id').inTable('episodes');
      t.uuid('treating_psychiatrist_id').notNullable().references('id').inTable('staff');
      t.string('protocol', 30).notNullable().defaultTo('standard');
      t.string('target_area', 100).notNullable().defaultTo('left_dlpfc');
      t.integer('total_planned_sessions').notNullable().defaultTo(20);
      t.integer('motor_threshold_percent').nullable();
      t.boolean('consent_obtained').notNullable().defaultTo(false);
      t.timestamp('consent_date', { useTz: true }).nullable();
      t.uuid('consent_recorded_by').nullable().references('id').inTable('staff');
      t.string('indication', 255).notNullable();
      t.string('status', 30).notNullable().defaultTo('planned');
      t.text('notes').nullable();
      t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
      t.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
      t.timestamp('deleted_at', { useTz: true }).nullable();
      t.index(['clinic_id', 'patient_id']);
      t.index(['treating_psychiatrist_id']);
    });

    await knex.raw(`
      ALTER TABLE tms_courses ADD CONSTRAINT tms_courses_status_check
      CHECK (status IN ('planned', 'active', 'completed', 'discontinued'))
    `);
    await knex.raw(`
      ALTER TABLE tms_courses ADD CONSTRAINT tms_courses_protocol_check
      CHECK (protocol IN ('standard', 'theta_burst', 'deep_tms'))
    `);
  }

  // ── TMS sessions ────────────────────────────────────────────────
  if (!(await knex.schema.hasTable('tms_sessions'))) {
    await knex.schema.createTable('tms_sessions', (t) => {
      t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
      t.uuid('course_id').notNullable().references('id').inTable('tms_courses').onDelete('CASCADE');
      t.uuid('clinic_id').notNullable().references('id').inTable('clinics');
      t.integer('session_number').notNullable();
      t.date('session_date').notNullable();
      t.integer('pulses_delivered').nullable();
      t.integer('intensity_percent').nullable();
      t.string('coil_position', 100).nullable();
      t.integer('duration_minutes').nullable();
      t.text('adverse_events').nullable();
      t.string('patient_tolerance', 20).notNullable().defaultTo('good');
      t.uuid('administered_by').notNullable().references('id').inTable('staff');
      t.integer('phq9_score').nullable();
      t.text('clinician_notes').nullable();
      t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
      t.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
      t.index(['course_id', 'session_number']);
      t.index(['clinic_id']);
      t.unique(['course_id', 'session_number']);
    });

    await knex.raw(`
      ALTER TABLE tms_sessions ADD CONSTRAINT tms_sessions_tolerance_check
      CHECK (patient_tolerance IN ('good', 'moderate', 'poor'))
    `);
  }

  // ── RLS on all 4 tables ─────────────────────────────────────────
  for (const table of ['ect_courses', 'ect_sessions', 'tms_courses', 'tms_sessions']) {
    await knex.raw(`ALTER TABLE ${table} ENABLE ROW LEVEL SECURITY`);
    await knex.raw(`
      DROP POLICY IF EXISTS rls_${table}_tenant ON ${table};
      CREATE POLICY rls_${table}_tenant ON ${table}
        FOR ALL
        USING (clinic_id = NULLIF(current_setting('app.clinic_id', true), '')::uuid)
        WITH CHECK (clinic_id = NULLIF(current_setting('app.clinic_id', true), '')::uuid)
    `);
  }

  // ── app_user grants ─────────────────────────────────────────────
  const hasAppUser = await knex.raw(`SELECT 1 FROM pg_roles WHERE rolname = 'app_user'`);
  if ((hasAppUser.rows ?? []).length > 0) {
    for (const table of ['ect_courses', 'ect_sessions', 'tms_courses', 'tms_sessions']) {
      await knex.raw(`GRANT SELECT, INSERT, UPDATE, DELETE ON ${table} TO app_user`);
    }
  }
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('tms_sessions');
  await knex.schema.dropTableIfExists('tms_courses');
  await knex.schema.dropTableIfExists('ect_sessions');
  await knex.schema.dropTableIfExists('ect_courses');
}
