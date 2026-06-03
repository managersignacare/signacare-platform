/**
 * Multi-specialty Phase 4 — Endocrinology: glucose_readings.
 *
 * Time-series store for blood-glucose measurements from any of three
 * sources: continuous-glucose-monitor (CGM), fingerstick, or lab.
 * Powers the patient's Glucose Flowsheet tab and the Time-In-Range
 * (TIR) calculation used by the endocrine team.
 *
 * Schema is FHIR R5 Observation-shaped: a code (LOINC 15074-8 for
 * glucose), a value with units (mmol/L by default for AU; mg/dL
 * supported for sites that prefer it), an effective timestamp, and
 * a meal-relative context. The unit is stored on the row rather
 * than enforced server-side so legacy data drift can be re-mapped
 * later without a migration.
 *
 * Patient-level (episode_id nullable) so chronic glucose tracking
 * spans multiple admissions. Soft-delete aware. Per-tenant RLS.
 */
import type { Knex } from 'knex';

const SOURCES = ['cgm', 'fingerstick', 'lab', 'manual'] as const;
const MEAL_CONTEXTS = [
  'fasting',
  'pre_meal',
  'post_meal_1h',
  'post_meal_2h',
  'bedtime',
  'random',
  'overnight',
] as const;
const UNITS = ['mmol/L', 'mg/dL'] as const;

const CHK = (values: readonly string[]) => values.map((s) => `'${s}'`).join(', ');

export async function up(knex: Knex): Promise<void> {
  if (await knex.schema.hasTable('glucose_readings')) return;

  await knex.schema.createTable('glucose_readings', (t) => {
    t.uuid('id').primary().defaultTo(knex.fn.uuid());
    t.uuid('clinic_id').notNullable().references('id').inTable('clinics').onDelete('RESTRICT');
    t.uuid('patient_id').notNullable().references('id').inTable('patients').onDelete('CASCADE');
    t.uuid('episode_id').nullable().references('id').inTable('episodes').onDelete('SET NULL');

    t.decimal('value', 6, 2).notNullable();
    t.string('unit', 10).notNullable().defaultTo('mmol/L');
    t.string('source', 20).notNullable().defaultTo('fingerstick');
    t.string('meal_context', 20).nullable();

    t.timestamp('measured_at', { useTz: true }).notNullable();
    t.uuid('recorded_by').nullable().references('id').inTable('staff').onDelete('SET NULL');
    t.text('note').nullable();

    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.timestamp('deleted_at', { useTz: true }).nullable();

    // Hot path: patient flowsheet ordered by measured_at desc.
    t.index(['clinic_id']);
    t.index(['patient_id']);
    t.index(['clinic_id', 'patient_id', 'measured_at']);
  });

  await knex.raw(`
    ALTER TABLE glucose_readings
      ADD CONSTRAINT glucose_readings_source_check
      CHECK (source IN (${CHK(SOURCES)}))
  `);
  await knex.raw(`
    ALTER TABLE glucose_readings
      ADD CONSTRAINT glucose_readings_unit_check
      CHECK (unit IN (${CHK(UNITS)}))
  `);
  await knex.raw(`
    ALTER TABLE glucose_readings
      ADD CONSTRAINT glucose_readings_meal_context_check
      CHECK (meal_context IS NULL OR meal_context IN (${CHK(MEAL_CONTEXTS)}))
  `);
  // Sanity: physiological glucose readings are between 0 and 50 mmol/L
  // (or 0 and 900 mg/dL). Anything outside is data entry error.
  await knex.raw(`
    ALTER TABLE glucose_readings
      ADD CONSTRAINT glucose_readings_value_range_check
      CHECK (value > 0 AND value < 1000)
  `);

  await knex.raw(`
    ALTER TABLE glucose_readings ENABLE ROW LEVEL SECURITY;
    CREATE POLICY rls_glucose_readings_tenant ON glucose_readings
      FOR ALL USING (clinic_id = current_setting('app.clinic_id', true)::uuid);
  `);
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('glucose_readings');
}
