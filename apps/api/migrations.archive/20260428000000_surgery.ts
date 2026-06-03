/**
 * Multi-specialty Phase 7 — Surgery.
 *
 * Four tables:
 *
 *   1. surgical_cases      — the case record. Patient-scoped with
 *                            an optional link to an episode of care.
 *                            Urgency / ASA / consent / status tracked
 *                            as first-class columns so the coordinator
 *                            queue, OR board and reports can filter
 *                            without parsing JSONB.
 *
 *   2. safety_checklists   — WHO three-phase surgical safety
 *                            checklist. Items stored as JSONB so a
 *                            clinic can extend the default prompts
 *                            without schema churn. Unique per
 *                            (case_id, phase) to enforce
 *                            one-phase-per-case.
 *
 *   3. op_notes            — operative note. Unique per case_id
 *                            (one op note per case).
 *
 *   4. pacu_records        — recovery observations. A case can have
 *                            multiple PACU entries as the patient
 *                            progresses through recovery.
 *
 * CLAUDE.md §7 checklist:
 *   - RLS policy on every table
 *   - patient_id / clinic_id / case_id indexes as appropriate
 *   - NOT NULL on required columns
 *   - Unique constraints enforcing business rules
 *   - Soft-delete column where CRUD is exposed
 *   - varchar + CHECK instead of Postgres ENUMs (house style)
 */
import type { Knex } from 'knex';

const URGENCIES = ['elective', 'urgent', 'emergency'] as const;
const CONSENT_STATUSES = ['pending', 'signed', 'withdrawn'] as const;
const CASE_STATUSES = ['scheduled', 'in_progress', 'completed', 'cancelled'] as const;
const CHECKLIST_PHASES = ['sign_in', 'time_out', 'sign_out'] as const;

const CHK = (values: readonly string[]) => values.map((s) => `'${s}'`).join(', ');

export async function up(knex: Knex): Promise<void> {
  // ── surgical_cases ─────────────────────────────────────────────────────
  if (!(await knex.schema.hasTable('surgical_cases'))) {
    await knex.schema.createTable('surgical_cases', (t) => {
      t.uuid('id').primary().defaultTo(knex.fn.uuid());
      t.uuid('clinic_id').notNullable().references('id').inTable('clinics').onDelete('RESTRICT');
      t.uuid('patient_id').notNullable().references('id').inTable('patients').onDelete('CASCADE');
      t.uuid('episode_id').nullable().references('id').inTable('episodes').onDelete('SET NULL');

      t.string('procedure_code', 50).notNullable();
      t.string('procedure_display', 500).notNullable();
      t.uuid('primary_surgeon_id').nullable().references('id').inTable('staff').onDelete('SET NULL');

      t.date('planned_date').notNullable();
      t.string('urgency', 20).notNullable();
      t.smallint('asa_class').notNullable();
      t.string('consent_status', 20).notNullable().defaultTo('pending');
      t.string('status', 20).notNullable().defaultTo('scheduled');
      t.text('note').nullable();

      t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
      t.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
      t.timestamp('deleted_at', { useTz: true }).nullable();

      t.index(['clinic_id']);
      t.index(['patient_id']);
      t.index(['clinic_id', 'patient_id', 'planned_date']);
      t.index(['clinic_id', 'status']);
    });

    await knex.raw(`
      ALTER TABLE surgical_cases
        ADD CONSTRAINT surgical_cases_urgency_check
        CHECK (urgency IN (${CHK(URGENCIES)}))
    `);
    await knex.raw(`
      ALTER TABLE surgical_cases
        ADD CONSTRAINT surgical_cases_consent_status_check
        CHECK (consent_status IN (${CHK(CONSENT_STATUSES)}))
    `);
    await knex.raw(`
      ALTER TABLE surgical_cases
        ADD CONSTRAINT surgical_cases_status_check
        CHECK (status IN (${CHK(CASE_STATUSES)}))
    `);
    await knex.raw(`
      ALTER TABLE surgical_cases
        ADD CONSTRAINT surgical_cases_asa_class_check
        CHECK (asa_class BETWEEN 1 AND 6)
    `);

    await knex.raw(`
      ALTER TABLE surgical_cases ENABLE ROW LEVEL SECURITY;
      CREATE POLICY rls_surgical_cases_tenant ON surgical_cases
        FOR ALL USING (clinic_id = current_setting('app.clinic_id', true)::uuid);
    `);
  }

  // ── safety_checklists ──────────────────────────────────────────────────
  if (!(await knex.schema.hasTable('safety_checklists'))) {
    await knex.schema.createTable('safety_checklists', (t) => {
      t.uuid('id').primary().defaultTo(knex.fn.uuid());
      t.uuid('clinic_id').notNullable().references('id').inTable('clinics').onDelete('RESTRICT');
      t.uuid('case_id').notNullable().references('id').inTable('surgical_cases').onDelete('CASCADE');
      t.string('phase', 20).notNullable();
      t.jsonb('items').notNullable();
      t.uuid('completed_by').nullable().references('id').inTable('staff').onDelete('SET NULL');
      t.timestamp('completed_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
      t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
      t.timestamp('deleted_at', { useTz: true }).nullable();

      t.index(['clinic_id']);
      t.index(['case_id']);
      // One phase per case — enforces the WHO "three rows, one each
      // for sign_in / time_out / sign_out" contract at the DB level.
      t.unique(['case_id', 'phase']);
    });

    await knex.raw(`
      ALTER TABLE safety_checklists
        ADD CONSTRAINT safety_checklists_phase_check
        CHECK (phase IN (${CHK(CHECKLIST_PHASES)}))
    `);

    await knex.raw(`
      ALTER TABLE safety_checklists ENABLE ROW LEVEL SECURITY;
      CREATE POLICY rls_safety_checklists_tenant ON safety_checklists
        FOR ALL USING (clinic_id = current_setting('app.clinic_id', true)::uuid);
    `);
  }

  // ── op_notes ───────────────────────────────────────────────────────────
  if (!(await knex.schema.hasTable('op_notes'))) {
    await knex.schema.createTable('op_notes', (t) => {
      t.uuid('id').primary().defaultTo(knex.fn.uuid());
      t.uuid('clinic_id').notNullable().references('id').inTable('clinics').onDelete('RESTRICT');
      t.uuid('case_id').notNullable().references('id').inTable('surgical_cases').onDelete('CASCADE');
      t.text('indication').notNullable();
      t.text('findings').notNullable();
      t.text('procedure_text').notNullable();
      t.text('complications').nullable();
      t.integer('estimated_blood_loss_ml').nullable();
      t.jsonb('specimens').notNullable().defaultTo('[]');
      t.uuid('closed_by').nullable().references('id').inTable('staff').onDelete('SET NULL');
      t.timestamp('closed_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
      t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
      t.timestamp('deleted_at', { useTz: true }).nullable();

      t.index(['clinic_id']);
      t.index(['case_id']);
      // One op note per case.
      t.unique(['case_id']);
    });

    await knex.raw(`
      ALTER TABLE op_notes
        ADD CONSTRAINT op_notes_ebl_check
        CHECK (estimated_blood_loss_ml IS NULL OR estimated_blood_loss_ml >= 0)
    `);

    await knex.raw(`
      ALTER TABLE op_notes ENABLE ROW LEVEL SECURITY;
      CREATE POLICY rls_op_notes_tenant ON op_notes
        FOR ALL USING (clinic_id = current_setting('app.clinic_id', true)::uuid);
    `);
  }

  // ── pacu_records ───────────────────────────────────────────────────────
  if (!(await knex.schema.hasTable('pacu_records'))) {
    await knex.schema.createTable('pacu_records', (t) => {
      t.uuid('id').primary().defaultTo(knex.fn.uuid());
      t.uuid('clinic_id').notNullable().references('id').inTable('clinics').onDelete('RESTRICT');
      t.uuid('case_id').notNullable().references('id').inTable('surgical_cases').onDelete('CASCADE');
      t.jsonb('vitals').notNullable();
      t.smallint('aldrete_score').notNullable();
      t.boolean('discharge_criteria_met').notNullable().defaultTo(false);
      t.timestamp('recovery_end_at', { useTz: true }).nullable();
      t.text('note').nullable();
      t.uuid('recorded_by').nullable().references('id').inTable('staff').onDelete('SET NULL');
      t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
      t.timestamp('deleted_at', { useTz: true }).nullable();

      t.index(['clinic_id']);
      t.index(['case_id']);
    });

    await knex.raw(`
      ALTER TABLE pacu_records
        ADD CONSTRAINT pacu_records_aldrete_check
        CHECK (aldrete_score BETWEEN 0 AND 10)
    `);

    await knex.raw(`
      ALTER TABLE pacu_records ENABLE ROW LEVEL SECURITY;
      CREATE POLICY rls_pacu_records_tenant ON pacu_records
        FOR ALL USING (clinic_id = current_setting('app.clinic_id', true)::uuid);
    `);
  }
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('pacu_records');
  await knex.schema.dropTableIfExists('op_notes');
  await knex.schema.dropTableIfExists('safety_checklists');
  await knex.schema.dropTableIfExists('surgical_cases');
}
