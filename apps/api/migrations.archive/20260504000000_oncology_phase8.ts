/**
 * Phase 8 — Oncology (mCODE-aligned).
 *
 * Six clinical tables covering the minimum cancer data set:
 *
 *   1. primary_cancer_conditions   — mCODE PrimaryCancerCondition
 *   2. tnm_stage_groups            — mCODE TNMStageGroup
 *   3. ecog_performance_status     — mCODE ECOGPerformanceStatus
 *   4. cancer_treatment_plans      — mCODE CancerTreatmentPlan
 *   5. chemo_cycles                — protocol cycles under a treatment plan
 *   6. tumour_board_decisions      — multidisciplinary team recommendations
 *
 * Design notes — CLAUDE.md §6.3, §7.1, §7.3:
 *
 *   - Every table has `clinic_id NOT NULL` + `patient_id NOT NULL` (except
 *     the child tables `tnm_stage_groups` and `chemo_cycles` which inherit
 *     tenancy via their parent row — they still carry `clinic_id` for RLS
 *     defence-in-depth + direct lookup).
 *   - Every table enables Row Level Security with a `tenant_isolation`
 *     policy keyed on `app.clinic_id` (same pattern as every other
 *     clinical table from Phases 3–7).
 *   - Indexes on `clinic_id`, `patient_id`, and the denormalised FK column
 *     where relevant. Soft-delete via `deleted_at` on the parent tables
 *     only — the child tables (TNM, chemo cycles, tumour board decisions)
 *     cascade via the parent.
 *   - Every `CHECK` constraint uses the same `ANY (ARRAY[...])` shape as
 *     the existing specialty migrations so the introspection tooling
 *     reads them consistently.
 *   - mCODE profile names preserved verbatim in comments so a future
 *     FHIR exporter knows which row maps to which resource.
 *
 * Module access: the admin matrix already lists `oncology` as a canonical
 * module key (added in the same PR as this migration). The backfill
 * seeds `write` on every active clinician/admin/superadmin so
 * enforcement is additive-safe.
 */
import type { Knex } from 'knex';

const STAGE_SYSTEMS = ['ajcc8', 'uicc8'] as const;
const TREATMENT_INTENTS = ['curative', 'palliative', 'adjuvant', 'neoadjuvant'] as const;
const PLAN_STATUSES = ['draft', 'active', 'completed', 'cancelled'] as const;
const CYCLE_STATUSES = ['planned', 'administered', 'delayed', 'cancelled'] as const;

const CHK = (values: readonly string[]) => values.map((s) => `'${s}'`).join(', ');

export async function up(knex: Knex): Promise<void> {
  // ── primary_cancer_conditions ──────────────────────────────────────────
  if (!(await knex.schema.hasTable('primary_cancer_conditions'))) {
    await knex.schema.createTable('primary_cancer_conditions', (t) => {
      t.uuid('id').primary().defaultTo(knex.fn.uuid());
      t.uuid('clinic_id').notNullable().references('id').inTable('clinics').onDelete('CASCADE');
      t.uuid('patient_id').notNullable().references('id').inTable('patients').onDelete('CASCADE');
      t.uuid('episode_id').nullable().references('id').inTable('episodes').onDelete('SET NULL');
      t.string('icd10', 20).nullable();
      t.string('snomed', 30).nullable();
      t.string('histology', 200).nullable();
      t.string('laterality', 20).nullable(); // left / right / bilateral / n/a
      t.date('diagnosis_date').notNullable();
      t.string('stage_system', 10).nullable();
      t.text('notes').nullable();
      t.uuid('created_by_staff_id').nullable().references('id').inTable('staff').onDelete('SET NULL');
      t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
      t.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
      t.timestamp('deleted_at', { useTz: true }).nullable();

      t.index(['clinic_id', 'patient_id']);
      t.index(['clinic_id', 'diagnosis_date']);
      t.index(['episode_id']);
    });

    await knex.raw(`
      ALTER TABLE primary_cancer_conditions
        ADD CONSTRAINT primary_cancer_conditions_stage_system_check
        CHECK (stage_system IS NULL OR stage_system IN (${CHK(STAGE_SYSTEMS)}))
    `);
    await knex.raw(`
      ALTER TABLE primary_cancer_conditions ENABLE ROW LEVEL SECURITY;
      CREATE POLICY rls_primary_cancer_conditions_tenant ON primary_cancer_conditions
        FOR ALL USING (clinic_id = current_setting('app.clinic_id', true)::uuid)
        WITH CHECK (clinic_id = current_setting('app.clinic_id', true)::uuid);
    `);
  }

  // ── tnm_stage_groups ───────────────────────────────────────────────────
  if (!(await knex.schema.hasTable('tnm_stage_groups'))) {
    await knex.schema.createTable('tnm_stage_groups', (t) => {
      t.uuid('id').primary().defaultTo(knex.fn.uuid());
      t.uuid('clinic_id').notNullable().references('id').inTable('clinics').onDelete('CASCADE');
      t.uuid('condition_id').notNullable().references('id').inTable('primary_cancer_conditions').onDelete('CASCADE');
      t.string('t', 10).nullable();
      t.string('n', 10).nullable();
      t.string('m', 10).nullable();
      t.string('stage_group', 10).nullable();
      t.timestamp('staged_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
      t.uuid('staged_by_staff_id').nullable().references('id').inTable('staff').onDelete('SET NULL');
      t.text('notes').nullable();
      t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());

      t.index(['clinic_id', 'condition_id']);
      t.index(['condition_id', 'staged_at']);
    });

    await knex.raw(`
      ALTER TABLE tnm_stage_groups ENABLE ROW LEVEL SECURITY;
      CREATE POLICY rls_tnm_stage_groups_tenant ON tnm_stage_groups
        FOR ALL USING (clinic_id = current_setting('app.clinic_id', true)::uuid)
        WITH CHECK (clinic_id = current_setting('app.clinic_id', true)::uuid);
    `);
  }

  // ── ecog_performance_status ────────────────────────────────────────────
  if (!(await knex.schema.hasTable('ecog_performance_status'))) {
    await knex.schema.createTable('ecog_performance_status', (t) => {
      t.uuid('id').primary().defaultTo(knex.fn.uuid());
      t.uuid('clinic_id').notNullable().references('id').inTable('clinics').onDelete('CASCADE');
      t.uuid('patient_id').notNullable().references('id').inTable('patients').onDelete('CASCADE');
      t.smallint('score').notNullable();
      t.timestamp('assessed_at', { useTz: true }).notNullable();
      t.uuid('assessed_by_staff_id').nullable().references('id').inTable('staff').onDelete('SET NULL');
      t.text('notes').nullable();
      t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());

      t.index(['clinic_id', 'patient_id', 'assessed_at']);
    });

    await knex.raw(`
      ALTER TABLE ecog_performance_status
        ADD CONSTRAINT ecog_score_check CHECK (score BETWEEN 0 AND 5)
    `);
    await knex.raw(`
      ALTER TABLE ecog_performance_status ENABLE ROW LEVEL SECURITY;
      CREATE POLICY rls_ecog_performance_status_tenant ON ecog_performance_status
        FOR ALL USING (clinic_id = current_setting('app.clinic_id', true)::uuid)
        WITH CHECK (clinic_id = current_setting('app.clinic_id', true)::uuid);
    `);
  }

  // ── cancer_treatment_plans ─────────────────────────────────────────────
  if (!(await knex.schema.hasTable('cancer_treatment_plans'))) {
    await knex.schema.createTable('cancer_treatment_plans', (t) => {
      t.uuid('id').primary().defaultTo(knex.fn.uuid());
      t.uuid('clinic_id').notNullable().references('id').inTable('clinics').onDelete('CASCADE');
      t.uuid('condition_id').notNullable().references('id').inTable('primary_cancer_conditions').onDelete('CASCADE');
      t.string('regimen_name', 200).notNullable();
      t.string('intent', 20).notNullable();
      t.string('protocol_ref', 200).nullable();
      t.date('start_date').notNullable();
      t.date('end_date').nullable();
      t.string('status', 20).notNullable().defaultTo('draft');
      t.text('notes').nullable();
      t.uuid('created_by_staff_id').nullable().references('id').inTable('staff').onDelete('SET NULL');
      t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
      t.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
      t.timestamp('deleted_at', { useTz: true }).nullable();

      t.index(['clinic_id', 'condition_id']);
      t.index(['clinic_id', 'status']);
    });

    await knex.raw(`
      ALTER TABLE cancer_treatment_plans
        ADD CONSTRAINT cancer_treatment_plans_intent_check CHECK (intent IN (${CHK(TREATMENT_INTENTS)}))
    `);
    await knex.raw(`
      ALTER TABLE cancer_treatment_plans
        ADD CONSTRAINT cancer_treatment_plans_status_check CHECK (status IN (${CHK(PLAN_STATUSES)}))
    `);
    await knex.raw(`
      ALTER TABLE cancer_treatment_plans ENABLE ROW LEVEL SECURITY;
      CREATE POLICY rls_cancer_treatment_plans_tenant ON cancer_treatment_plans
        FOR ALL USING (clinic_id = current_setting('app.clinic_id', true)::uuid)
        WITH CHECK (clinic_id = current_setting('app.clinic_id', true)::uuid);
    `);
  }

  // ── chemo_cycles ───────────────────────────────────────────────────────
  if (!(await knex.schema.hasTable('chemo_cycles'))) {
    await knex.schema.createTable('chemo_cycles', (t) => {
      t.uuid('id').primary().defaultTo(knex.fn.uuid());
      t.uuid('clinic_id').notNullable().references('id').inTable('clinics').onDelete('CASCADE');
      t.uuid('plan_id').notNullable().references('id').inTable('cancer_treatment_plans').onDelete('CASCADE');
      t.integer('cycle_number').notNullable();
      t.date('planned_date').notNullable();
      t.date('actual_date').nullable();
      t.string('status', 20).notNullable().defaultTo('planned');
      t.jsonb('dose_modifications').notNullable().defaultTo(knex.raw("'{}'::jsonb"));
      t.jsonb('toxicity_ctcae').notNullable().defaultTo(knex.raw("'{}'::jsonb"));
      t.text('notes').nullable();
      t.uuid('administered_by_staff_id').nullable().references('id').inTable('staff').onDelete('SET NULL');
      t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
      t.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());

      t.index(['clinic_id', 'plan_id', 'cycle_number']);
      t.unique(['plan_id', 'cycle_number']); // one row per (plan, cycle)
    });

    await knex.raw(`
      ALTER TABLE chemo_cycles
        ADD CONSTRAINT chemo_cycles_status_check CHECK (status IN (${CHK(CYCLE_STATUSES)}))
    `);
    await knex.raw(`
      ALTER TABLE chemo_cycles ENABLE ROW LEVEL SECURITY;
      CREATE POLICY rls_chemo_cycles_tenant ON chemo_cycles
        FOR ALL USING (clinic_id = current_setting('app.clinic_id', true)::uuid)
        WITH CHECK (clinic_id = current_setting('app.clinic_id', true)::uuid);
    `);
  }

  // ── tumour_board_decisions ─────────────────────────────────────────────
  if (!(await knex.schema.hasTable('tumour_board_decisions'))) {
    await knex.schema.createTable('tumour_board_decisions', (t) => {
      t.uuid('id').primary().defaultTo(knex.fn.uuid());
      t.uuid('clinic_id').notNullable().references('id').inTable('clinics').onDelete('CASCADE');
      t.uuid('condition_id').notNullable().references('id').inTable('primary_cancer_conditions').onDelete('CASCADE');
      t.date('meeting_date').notNullable();
      t.text('recommendation').notNullable();
      t.text('rationale').nullable();
      // Attendee staff ids as a uuid array; keeps the hot path simple
      // without introducing a junction table for what is typically 5–15
      // entries per decision.
      t.specificType('attendee_staff_ids', 'uuid[]').nullable();
      t.uuid('chaired_by_staff_id').nullable().references('id').inTable('staff').onDelete('SET NULL');
      t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());

      t.index(['clinic_id', 'condition_id', 'meeting_date']);
    });

    await knex.raw(`
      ALTER TABLE tumour_board_decisions ENABLE ROW LEVEL SECURITY;
      CREATE POLICY rls_tumour_board_decisions_tenant ON tumour_board_decisions
        FOR ALL USING (clinic_id = current_setting('app.clinic_id', true)::uuid)
        WITH CHECK (clinic_id = current_setting('app.clinic_id', true)::uuid);
    `);
  }

  // ── Backfill staff_module_access for the new 'oncology' key ────────────
  // Seed write grants on every active clinician/admin/superadmin so the
  // admin matrix + module-access middleware enforcement is additive-safe.
  // Mirrors the pattern in 20260503000001 / 20260503000002.
  const staffRows = await knex('staff')
    .whereIn('role', ['clinician', 'admin', 'superadmin'])
    .andWhere({ is_active: true })
    .whereNull('deleted_at')
    .select('id', 'clinic_id') as Array<{ id: string; clinic_id: string }>;

  if (staffRows.length > 0) {
    const now = new Date();
    const grants = staffRows.map((r) => ({
      staff_id: r.id,
      clinic_id: r.clinic_id,
      module: 'oncology',
      access_level: 'write',
      can_delegate_this: false,
      created_at: now,
      updated_at: now,
    }));

    const BATCH = 500;
    for (let i = 0; i < grants.length; i += BATCH) {
      const chunk = grants.slice(i, i + BATCH);
      await knex('staff_module_access')
        .insert(chunk)
        .onConflict(['staff_id', 'module'])
        .ignore();
    }
  }
}

export async function down(knex: Knex): Promise<void> {
  await knex('staff_module_access').where({ module: 'oncology' }).delete();
  await knex.raw('DROP POLICY IF EXISTS rls_tumour_board_decisions_tenant ON tumour_board_decisions');
  await knex.schema.dropTableIfExists('tumour_board_decisions');
  await knex.raw('DROP POLICY IF EXISTS rls_chemo_cycles_tenant ON chemo_cycles');
  await knex.schema.dropTableIfExists('chemo_cycles');
  await knex.raw('DROP POLICY IF EXISTS rls_cancer_treatment_plans_tenant ON cancer_treatment_plans');
  await knex.schema.dropTableIfExists('cancer_treatment_plans');
  await knex.raw('DROP POLICY IF EXISTS rls_ecog_performance_status_tenant ON ecog_performance_status');
  await knex.schema.dropTableIfExists('ecog_performance_status');
  await knex.raw('DROP POLICY IF EXISTS rls_tnm_stage_groups_tenant ON tnm_stage_groups');
  await knex.schema.dropTableIfExists('tnm_stage_groups');
  await knex.raw('DROP POLICY IF EXISTS rls_primary_cancer_conditions_tenant ON primary_cancer_conditions');
  await knex.schema.dropTableIfExists('primary_cancer_conditions');
}
