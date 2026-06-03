/**
 * Multi-specialty Phase 6 — Obstetrics & Gynaecology.
 *
 * Two tables:
 *
 *   1. pregnancies        — one row per gestation, FHIR EpisodeOfCare
 *                           semantically (start at LMP, end at
 *                           delivery / miscarriage / termination).
 *                           GTPAL stored as JSONB so we can extend
 *                           the set without schema churn.
 *
 *   2. antenatal_visits   — per-visit FHIR Encounter with embedded
 *                           Observations for fundal height, fetal
 *                           heart rate, BP and urinalysis. Belongs
 *                           to a pregnancy; delete cascades when
 *                           the pregnancy is hard-deleted.
 *
 * Partograms and CTG traces from the original Phase 6 plan are
 * deferred — the per-visit flowsheet covers the MVP and the
 * blob-backed tracings need bespoke UI.
 *
 * CLAUDE.md §7 checklist satisfied:
 *   - RLS policy on every table
 *   - patient_id and clinic_id indexes (+ composite for hot path)
 *   - NOT NULL on required columns
 *   - Unique constraint per business rule (one visit number per pregnancy)
 *   - Soft-delete (deleted_at) on both tables
 *   - varchar + CHECK instead of Postgres ENUMs (house style)
 */
import type { Knex } from 'knex';

const PREGNANCY_STATUSES = ['ongoing', 'delivered', 'miscarried', 'terminated'] as const;
const URINE_DIPSTICK_VALUES = ['negative', 'trace', '+', '++', '+++', '++++'] as const;

const CHK = (values: readonly string[]) => values.map((s) => `'${s}'`).join(', ');

export async function up(knex: Knex): Promise<void> {
  // ── pregnancies ─────────────────────────────────────────────────────────
  if (!(await knex.schema.hasTable('pregnancies'))) {
    await knex.schema.createTable('pregnancies', (t) => {
      t.uuid('id').primary().defaultTo(knex.fn.uuid());
      t.uuid('clinic_id').notNullable().references('id').inTable('clinics').onDelete('RESTRICT');
      t.uuid('patient_id').notNullable().references('id').inTable('patients').onDelete('CASCADE');
      t.uuid('episode_id').nullable().references('id').inTable('episodes').onDelete('SET NULL');

      t.date('lmp_date').notNullable();
      t.date('edd_date').notNullable();
      t.jsonb('gtpal').notNullable();
      t.string('status', 20).notNullable().defaultTo('ongoing');
      t.text('note').nullable();

      t.uuid('recorded_by').nullable().references('id').inTable('staff').onDelete('SET NULL');

      t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
      t.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
      t.timestamp('deleted_at', { useTz: true }).nullable();

      t.index(['clinic_id']);
      t.index(['patient_id']);
      t.index(['clinic_id', 'patient_id', 'status']);
    });

    await knex.raw(`
      ALTER TABLE pregnancies
        ADD CONSTRAINT pregnancies_status_check
        CHECK (status IN (${CHK(PREGNANCY_STATUSES)}))
    `);
    await knex.raw(`
      ALTER TABLE pregnancies
        ADD CONSTRAINT pregnancies_date_range_check
        CHECK (edd_date >= lmp_date)
    `);

    await knex.raw(`
      ALTER TABLE pregnancies ENABLE ROW LEVEL SECURITY;
      CREATE POLICY rls_pregnancies_tenant ON pregnancies
        FOR ALL USING (clinic_id = current_setting('app.clinic_id', true)::uuid);
    `);
  }

  // ── antenatal_visits ────────────────────────────────────────────────────
  if (!(await knex.schema.hasTable('antenatal_visits'))) {
    await knex.schema.createTable('antenatal_visits', (t) => {
      t.uuid('id').primary().defaultTo(knex.fn.uuid());
      t.uuid('clinic_id').notNullable().references('id').inTable('clinics').onDelete('RESTRICT');
      t.uuid('pregnancy_id').notNullable().references('id').inTable('pregnancies').onDelete('CASCADE');
      // Patient id is denormalised for the RLS policy + hot-path
      // queries that filter "show me this patient's antenatal flowsheet"
      // without a join. Kept in sync by the backend on insert.
      t.uuid('patient_id').notNullable().references('id').inTable('patients').onDelete('CASCADE');

      t.integer('visit_number').notNullable();
      t.date('visit_date').notNullable();
      t.integer('ga_weeks').notNullable();
      t.integer('ga_days').notNullable();

      t.decimal('fundal_height_cm', 5, 2).nullable();
      t.integer('fetal_heart_rate_bpm').nullable();
      t.integer('bp_systolic').nullable();
      t.integer('bp_diastolic').nullable();
      t.string('urine_protein', 10).nullable();
      t.string('urine_glucose', 10).nullable();
      t.boolean('oedema').nullable();
      t.text('note').nullable();

      t.uuid('seen_by').nullable().references('id').inTable('staff').onDelete('SET NULL');

      t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
      t.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
      t.timestamp('deleted_at', { useTz: true }).nullable();

      t.index(['clinic_id']);
      t.index(['pregnancy_id']);
      t.index(['clinic_id', 'patient_id', 'visit_date']);
      t.unique(['pregnancy_id', 'visit_number']);
    });

    await knex.raw(`
      ALTER TABLE antenatal_visits
        ADD CONSTRAINT antenatal_visits_ga_weeks_check
        CHECK (ga_weeks >= 0 AND ga_weeks <= 45)
    `);
    await knex.raw(`
      ALTER TABLE antenatal_visits
        ADD CONSTRAINT antenatal_visits_ga_days_check
        CHECK (ga_days >= 0 AND ga_days <= 6)
    `);
    await knex.raw(`
      ALTER TABLE antenatal_visits
        ADD CONSTRAINT antenatal_visits_urine_protein_check
        CHECK (urine_protein IS NULL OR urine_protein IN (${CHK(URINE_DIPSTICK_VALUES)}))
    `);
    await knex.raw(`
      ALTER TABLE antenatal_visits
        ADD CONSTRAINT antenatal_visits_urine_glucose_check
        CHECK (urine_glucose IS NULL OR urine_glucose IN (${CHK(URINE_DIPSTICK_VALUES)}))
    `);
    await knex.raw(`
      ALTER TABLE antenatal_visits
        ADD CONSTRAINT antenatal_visits_fetal_hr_check
        CHECK (fetal_heart_rate_bpm IS NULL OR (fetal_heart_rate_bpm BETWEEN 60 AND 220))
    `);

    await knex.raw(`
      ALTER TABLE antenatal_visits ENABLE ROW LEVEL SECURITY;
      CREATE POLICY rls_antenatal_visits_tenant ON antenatal_visits
        FOR ALL USING (clinic_id = current_setting('app.clinic_id', true)::uuid);
    `);
  }
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('antenatal_visits');
  await knex.schema.dropTableIfExists('pregnancies');
}
