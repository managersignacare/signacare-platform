/**
 * BUG-626 — defence-in-depth tightening for `medication_administrations.patient_medication_id`.
 *
 * BUG-622 closed the field-name drift via Zod (Layer A — request boundary).
 * This migration adds Layer C (DB) by:
 *   1. ALTER COLUMN patient_medication_id SET NOT NULL.
 *   2. ALTER FK ON DELETE: SET NULL → RESTRICT. Pre-fix the FK had
 *      ON DELETE SET NULL semantics, which would have re-introduced
 *      NULL `patient_medication_id` if a parent `patient_medications`
 *      row were deleted — defeating the NOT NULL constraint and
 *      orphaning the AHPRA medication-chart audit trail. Clinical
 *      records are append-only per CLAUDE.md §17 — deleting a
 *      patient_medication while administrations exist must be blocked.
 *
 * Audit (2026-04-29): `SELECT COUNT(*) FILTER (WHERE patient_medication_id
 * IS NULL) FROM medication_administrations` returned 0. Closes BUG-629
 * (data-quality audit) atomically — no NULL rows exist, no backfill
 * required.
 *
 * Defence-in-depth posture post-migration:
 *   - Layer A (Zod):    MedicationAdministrationCreateSchema.patientMedicationId.uuid()
 *   - Layer B (service): Zod parse at request boundary in nurseFeatureRoutes
 *   - Layer C (DB):     NOT NULL + FK ON DELETE RESTRICT (this migration)
 */
import type { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  // Drop the existing FK so we can re-create it with ON DELETE RESTRICT.
  // @migration-raw-exempt: drop_constraint_if_exists
  await knex.raw(
    'ALTER TABLE medication_administrations DROP CONSTRAINT IF EXISTS medication_administrations_patient_medication_id_foreign',
  );

  // Tighten the column: NOT NULL + re-create FK with RESTRICT semantics.
  await knex.schema.alterTable('medication_administrations', (t) => {
    t.uuid('patient_medication_id')
      .notNullable()
      .references('id')
      .inTable('patient_medications')
      .onDelete('RESTRICT')
      .alter();
  });
}

export async function down(knex: Knex): Promise<void> {
  // Drop the strict FK and re-create the legacy SET NULL FK.
  // @migration-raw-exempt: drop_constraint_if_exists
  await knex.raw(
    'ALTER TABLE medication_administrations DROP CONSTRAINT IF EXISTS medication_administrations_patient_medication_id_foreign',
  );

  await knex.schema.alterTable('medication_administrations', (t) => {
    t.uuid('patient_medication_id')
      .nullable()
      .references('id')
      .inTable('patient_medications')
      .onDelete('SET NULL')
      .alter();
  });
}
