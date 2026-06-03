/**
 * Multi-specialty Phase 5 — Paediatrics: growth_measurements.
 *
 * FHIR R5 Observation-aligned per-encounter growth row. Stores the raw
 * measurement plus age-in-days at the time so percentile lookups
 * against WHO 0-2y / CDC 2-20y reference tables can be done at read
 * time without re-deriving from DOB. Each row carries one of
 * weight / height / head_circumference / BMI as the primary value;
 * a single visit typically writes 3-4 rows (weight + height + BMI +
 * head_circ for under-2s).
 *
 * Patient-level. Per-tenant RLS. Soft-delete aware. Indexed by
 * (clinic_id, patient_id, measured_at) for the flowsheet hot path.
 */
import type { Knex } from 'knex';

const MEASUREMENT_TYPES = [
  'weight_kg',
  'height_cm',
  'head_circumference_cm',
  'bmi',
] as const;

const REFERENCE_SOURCES = ['who', 'cdc', 'local', 'unknown'] as const;

const CHK = (values: readonly string[]) => values.map((s) => `'${s}'`).join(', ');

export async function up(knex: Knex): Promise<void> {
  if (await knex.schema.hasTable('growth_measurements')) return;

  await knex.schema.createTable('growth_measurements', (t) => {
    t.uuid('id').primary().defaultTo(knex.fn.uuid());
    t.uuid('clinic_id').notNullable().references('id').inTable('clinics').onDelete('RESTRICT');
    t.uuid('patient_id').notNullable().references('id').inTable('patients').onDelete('CASCADE');
    t.uuid('episode_id').nullable().references('id').inTable('episodes').onDelete('SET NULL');

    t.string('measurement_type', 30).notNullable();
    t.decimal('value', 8, 3).notNullable();
    t.string('unit', 10).notNullable();

    // Pre-computed age + reference percentile so reads stay O(1).
    t.integer('age_at_measurement_days').notNullable();
    t.decimal('percentile', 5, 2).nullable();
    t.decimal('z_score', 6, 3).nullable();
    t.string('reference_source', 10).nullable();

    t.timestamp('measured_at', { useTz: true }).notNullable();
    t.uuid('recorded_by').nullable().references('id').inTable('staff').onDelete('SET NULL');
    t.text('note').nullable();

    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.timestamp('deleted_at', { useTz: true }).nullable();

    t.index(['clinic_id']);
    t.index(['patient_id']);
    t.index(['clinic_id', 'patient_id', 'measured_at']);
    t.index(['clinic_id', 'patient_id', 'measurement_type']);
  });

  await knex.raw(`
    ALTER TABLE growth_measurements
      ADD CONSTRAINT growth_measurements_type_check
      CHECK (measurement_type IN (${CHK(MEASUREMENT_TYPES)}))
  `);
  await knex.raw(`
    ALTER TABLE growth_measurements
      ADD CONSTRAINT growth_measurements_reference_source_check
      CHECK (reference_source IS NULL OR reference_source IN (${CHK(REFERENCE_SOURCES)}))
  `);
  await knex.raw(`
    ALTER TABLE growth_measurements
      ADD CONSTRAINT growth_measurements_value_range_check
      CHECK (value > 0 AND value < 10000)
  `);
  await knex.raw(`
    ALTER TABLE growth_measurements
      ADD CONSTRAINT growth_measurements_age_range_check
      CHECK (age_at_measurement_days >= 0 AND age_at_measurement_days < 36525)
  `);

  await knex.raw(`
    ALTER TABLE growth_measurements ENABLE ROW LEVEL SECURITY;
    CREATE POLICY rls_growth_measurements_tenant ON growth_measurements
      FOR ALL USING (clinic_id = current_setting('app.clinic_id', true)::uuid);
  `);
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('growth_measurements');
}
