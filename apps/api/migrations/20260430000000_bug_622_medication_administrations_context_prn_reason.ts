/**
 * BUG-622 — Add `administration_context` + `prn_reason` columns to
 * `medication_administrations`.
 *
 * The MAR frontend (`MarChartPanel.tsx:191-202`) sends both fields on
 * the POST payload, but pre-fix:
 *   - Neither column existed in the DB.
 *   - The backend handler at `nurseFeatureRoutes.ts:142-146` did not
 *     destructure either field.
 *   - Both fields were silently dropped on the success path.
 *
 * Clinical consequence: the AHPRA-required medication chart audit
 * trail was missing two mandatory fields:
 *   - `administration_context`: who supervised the dose ('supervised',
 *     'self_administered', 'inpatient', 'community', 'supervised_family',
 *     'patient_app'). The MAR longitudinal-report `ADMIN_CONTEXT` lookup
 *     references this value but always rendered blank.
 *   - `prn_reason`: free-text justification for PRN doses. AHPRA-required
 *     documentation; pre-fix the nurse's PRN-reason entry was thrown away.
 *
 * Companion fixes in the same BUG-622 cycle:
 *   - Frontend payload field names (`patientMedicationId`,
 *     `administeredTime`, `doseGiven`) aligned with the backend
 *     destructure via a new canonical Zod schema in
 *     `packages/shared/src/medicationAdministration.schemas.ts`.
 *   - Backend handler refactored to consume the canonical
 *     `MedicationAdministrationCreateSchema` DTO and apply a response
 *     mapper at the boundary per CLAUDE.md §5.2.
 *
 * CHECK constraint:
 *   `administration_context_check`: enforces enum
 *   ('supervised', 'self_administered', 'inpatient', 'community',
 *    'supervised_family', 'patient_app').
 *   `prn_reason` is free-text; no CHECK constraint.
 *
 * Both columns nullable — pre-existing rows from before this migration
 * carry NULL and are not retroactively populated. Going-forward POSTs
 * write the values.
 */
import type { Knex } from 'knex';

const ADMIN_CONTEXT_ENUM = [
  'supervised',
  'self_administered',
  'inpatient',
  'community',
  'supervised_family',
  'patient_app',
] as const;

export async function up(knex: Knex): Promise<void> {
  await knex.schema.alterTable('medication_administrations', (t) => {
    t.string('administration_context', 50).nullable();
    t.text('prn_reason').nullable();
  });

  // @migration-raw-exempt: check_constraint
  await knex.raw(`
    ALTER TABLE medication_administrations
      ADD CONSTRAINT medication_administrations_administration_context_check
      CHECK (administration_context IS NULL OR administration_context IN (${ADMIN_CONTEXT_ENUM.map((v) => `'${v}'`).join(', ')}))
  `);
}

export async function down(knex: Knex): Promise<void> {
  // @migration-raw-exempt: drop_constraint_if_exists
  await knex.raw(
    'ALTER TABLE medication_administrations DROP CONSTRAINT IF EXISTS medication_administrations_administration_context_check',
  );
  await knex.schema.alterTable('medication_administrations', (t) => {
    t.dropColumn('administration_context');
    t.dropColumn('prn_reason');
  });
}
