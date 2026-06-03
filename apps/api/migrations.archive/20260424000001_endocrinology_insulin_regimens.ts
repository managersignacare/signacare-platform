/**
 * Multi-specialty Phase 4 — Endocrinology: insulin_regimens.
 *
 * Captures a patient's insulin prescription as a structured record
 * rather than free-text on a prescription. One row per regimen
 * version — when the dose changes, a new row is inserted with a
 * `valid_from` timestamp and the previous row's `valid_to` is set,
 * preserving the full history for audit and TIR-context analysis.
 *
 * Fields are aligned with how endocrinologists actually think about
 * regimens:
 *   - basal_drug + basal_dose          (long-acting backbone)
 *   - bolus_drug + bolus_doses (jsonb)  (rapid-acting per-meal doses)
 *   - correction_factor                  (mg/dL or mmol/L per unit)
 *   - carb_ratio                         (g carb per unit)
 *   - target_low / target_high           (BG target range)
 *
 * Patient-level (episode_id nullable). Per-tenant RLS.
 */
import type { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  if (await knex.schema.hasTable('insulin_regimens')) return;

  await knex.schema.createTable('insulin_regimens', (t) => {
    t.uuid('id').primary().defaultTo(knex.fn.uuid());
    t.uuid('clinic_id').notNullable().references('id').inTable('clinics').onDelete('RESTRICT');
    t.uuid('patient_id').notNullable().references('id').inTable('patients').onDelete('CASCADE');
    t.uuid('episode_id').nullable().references('id').inTable('episodes').onDelete('SET NULL');

    // Basal (long-acting) — one drug, one daily dose.
    t.string('basal_drug', 100).nullable();
    t.decimal('basal_dose_units', 7, 2).nullable();
    t.string('basal_frequency', 50).nullable();

    // Bolus (rapid-acting) — drug + per-meal doses as jsonb.
    // Shape: { breakfast: 6, lunch: 8, dinner: 7, correction: { factor, target } }
    t.string('bolus_drug', 100).nullable();
    t.jsonb('bolus_doses').nullable();

    // Sliding-scale parameters.
    t.decimal('correction_factor', 6, 2).nullable();
    t.decimal('carb_ratio', 6, 2).nullable();
    t.decimal('target_low', 6, 2).nullable();
    t.decimal('target_high', 6, 2).nullable();

    t.timestamp('valid_from', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.timestamp('valid_to', { useTz: true }).nullable();
    t.text('note').nullable();

    t.uuid('prescribed_by').nullable().references('id').inTable('staff').onDelete('SET NULL');
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.timestamp('deleted_at', { useTz: true }).nullable();

    t.index(['clinic_id']);
    t.index(['patient_id']);
    // The "current regimen" lookup: WHERE patient_id = ? AND valid_to IS NULL.
    t.index(['clinic_id', 'patient_id', 'valid_to']);
  });

  await knex.raw(`
    ALTER TABLE insulin_regimens ENABLE ROW LEVEL SECURITY;
    CREATE POLICY rls_insulin_regimens_tenant ON insulin_regimens
      FOR ALL USING (clinic_id = current_setting('app.clinic_id', true)::uuid);
  `);
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('insulin_regimens');
}
