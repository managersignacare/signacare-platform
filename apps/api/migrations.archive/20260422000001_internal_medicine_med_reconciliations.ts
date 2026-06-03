/**
 * Multi-specialty Phase 3 — Internal Medicine: medication_reconciliations.
 *
 * Snapshot-based medication reconciliation. A reconciliation is performed
 * at admission, transfer, discharge, or an outpatient review, and captures:
 *   - the full medication list as a JSONB snapshot at the moment of
 *     reconciliation (for legal/audit replay without joining patient_medications
 *     at historic time points);
 *   - the clinician who performed the review;
 *   - structured counts and notes so the chart can show "3 continued,
 *     1 ceased, 1 new" at a glance.
 *
 * `context` captures WHY the reconciliation happened (admission / discharge
 * etc). `summary_notes` is free text for the clinician's reasoning.
 *
 * Patient-level (episode_id optional) so outpatient GPs can reconcile
 * without creating an episode, while inpatient workflows tie the review
 * to the admission.
 */
import type { Knex } from 'knex';

const CONTEXTS = ['admission', 'discharge', 'transfer', 'outpatient', 'periodic-review'] as const;
const CHK = (values: readonly string[]) => values.map((s) => `'${s}'`).join(', ');

export async function up(knex: Knex): Promise<void> {
  if (await knex.schema.hasTable('medication_reconciliations')) return;

  await knex.schema.createTable('medication_reconciliations', (t) => {
    t.uuid('id').primary().defaultTo(knex.fn.uuid());
    t.uuid('clinic_id').notNullable().references('id').inTable('clinics').onDelete('RESTRICT');
    t.uuid('patient_id').notNullable().references('id').inTable('patients').onDelete('CASCADE');
    t.uuid('episode_id').nullable().references('id').inTable('episodes').onDelete('SET NULL');

    t.string('context', 30).notNullable();
    t.timestamp('performed_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.uuid('performed_by').nullable().references('id').inTable('staff').onDelete('SET NULL');

    // Snapshot of the medication list at reconciliation time. Structured
    // as an array of `{ id, drug_label, dose, frequency, disposition }`
    // objects; disposition is the outcome of the review for that drug —
    // continued / ceased / modified / new / on-hold.
    t.jsonb('snapshot').notNullable().defaultTo('[]');

    // Pre-computed counts so the chart / audit report doesn't have to
    // reduce the JSONB every render.
    t.integer('continued_count').notNullable().defaultTo(0);
    t.integer('ceased_count').notNullable().defaultTo(0);
    t.integer('modified_count').notNullable().defaultTo(0);
    t.integer('new_count').notNullable().defaultTo(0);
    t.integer('on_hold_count').notNullable().defaultTo(0);

    t.text('summary_notes').nullable();

    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.timestamp('deleted_at', { useTz: true }).nullable();

    t.index(['clinic_id']);
    t.index(['patient_id']);
    t.index(['clinic_id', 'patient_id', 'performed_at']);
  });

  await knex.raw(`
    ALTER TABLE medication_reconciliations
      ADD CONSTRAINT medication_reconciliations_context_check
      CHECK (context IN (${CHK(CONTEXTS)}))
  `);

  await knex.raw(`
    ALTER TABLE medication_reconciliations ENABLE ROW LEVEL SECURITY;
    CREATE POLICY rls_medication_reconciliations_tenant ON medication_reconciliations
      FOR ALL USING (clinic_id = current_setting('app.clinic_id', true)::uuid);
  `);
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('medication_reconciliations');
}
