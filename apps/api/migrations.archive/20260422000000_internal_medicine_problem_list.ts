/**
 * Multi-specialty Phase 3 — Internal Medicine: problem_list table.
 *
 * A patient-level, FHIR-Condition-aligned problem list. Every specialty
 * writes to and reads from the same table — diabetes from an endocrine
 * clinic, hypertension from a GP, cancer from an oncologist — so the
 * active problems a patient has are visible to every clinician regardless
 * of their specialty enrolment. (The patient detail tab that surfaces
 * this table is registered as `specialty: 'core'` in the module registry
 * for exactly this reason.)
 *
 * Schema is modelled on FHIR R5 Condition:
 *   - clinical_status:     active / recurrence / relapse / inactive /
 *                          remission / resolved
 *   - verification_status: unconfirmed / provisional / differential /
 *                          confirmed / refuted / entered-in-error
 *   - category:            problem-list-item / encounter-diagnosis /
 *                          health-concern
 *   - severity:            mild / moderate / severe
 *   - code_system + code:  bound to ICD-10, SNOMED CT, or a local code
 *                          system so downstream FHIR exports are free.
 *
 * Patient-level (episode_id nullable) so a chronic problem can span
 * many encounters. Recorded_by is a staff FK so the provenance is
 * auditable. Soft-deleted rather than hard-deleted so an "entered-in-
 * error" entry can be retracted without losing history.
 */
import type { Knex } from 'knex';

const CLINICAL_STATUSES = ['active', 'recurrence', 'relapse', 'inactive', 'remission', 'resolved'] as const;
const VERIFICATION_STATUSES = ['unconfirmed', 'provisional', 'differential', 'confirmed', 'refuted', 'entered-in-error'] as const;
const CATEGORIES = ['problem-list-item', 'encounter-diagnosis', 'health-concern'] as const;
const SEVERITIES = ['mild', 'moderate', 'severe'] as const;

const CHK = (values: readonly string[]) => values.map((s) => `'${s}'`).join(', ');

export async function up(knex: Knex): Promise<void> {
  if (await knex.schema.hasTable('problem_list')) return;

  await knex.schema.createTable('problem_list', (t) => {
    t.uuid('id').primary().defaultTo(knex.fn.uuid());
    t.uuid('clinic_id').notNullable().references('id').inTable('clinics').onDelete('RESTRICT');
    t.uuid('patient_id').notNullable().references('id').inTable('patients').onDelete('CASCADE');
    t.uuid('episode_id').nullable().references('id').inTable('episodes').onDelete('SET NULL');

    // Coding
    t.string('code_system', 50).notNullable().defaultTo('snomed');
    t.string('code', 40).notNullable();
    t.string('display', 500).notNullable();

    // FHIR-aligned lifecycle
    t.string('category', 30).notNullable().defaultTo('problem-list-item');
    t.string('clinical_status', 20).notNullable().defaultTo('active');
    t.string('verification_status', 20).notNullable().defaultTo('confirmed');
    t.string('severity', 20).nullable();

    // Clinical detail
    t.boolean('is_chronic').notNullable().defaultTo(false);
    t.date('onset_date').nullable();
    t.smallint('onset_age_years').nullable();
    t.date('abatement_date').nullable();
    t.text('note').nullable();

    // Provenance
    t.timestamp('recorded_date', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.uuid('recorded_by').nullable().references('id').inTable('staff').onDelete('SET NULL');

    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.timestamp('deleted_at', { useTz: true }).nullable();

    // Query hot paths — listing, active-problem filter, banner aggregates
    t.index(['clinic_id']);
    t.index(['patient_id']);
    t.index(['clinic_id', 'patient_id', 'clinical_status']);
    t.index(['clinic_id', 'is_chronic']);
  });

  await knex.raw(`
    ALTER TABLE problem_list
      ADD CONSTRAINT problem_list_category_check
      CHECK (category IN (${CHK(CATEGORIES)}))
  `);
  await knex.raw(`
    ALTER TABLE problem_list
      ADD CONSTRAINT problem_list_clinical_status_check
      CHECK (clinical_status IN (${CHK(CLINICAL_STATUSES)}))
  `);
  await knex.raw(`
    ALTER TABLE problem_list
      ADD CONSTRAINT problem_list_verification_status_check
      CHECK (verification_status IN (${CHK(VERIFICATION_STATUSES)}))
  `);
  await knex.raw(`
    ALTER TABLE problem_list
      ADD CONSTRAINT problem_list_severity_check
      CHECK (severity IS NULL OR severity IN (${CHK(SEVERITIES)}))
  `);

  await knex.raw(`
    ALTER TABLE problem_list ENABLE ROW LEVEL SECURITY;
    CREATE POLICY rls_problem_list_tenant ON problem_list
      FOR ALL USING (clinic_id = current_setting('app.clinic_id', true)::uuid);
  `);
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('problem_list');
}
