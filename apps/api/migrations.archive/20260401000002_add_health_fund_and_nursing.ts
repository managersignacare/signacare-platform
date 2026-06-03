/**
 * Migration: Add health fund columns to patients, create nursing_assessments table
 *
 * Addresses:
 * - Health fund data not being recorded during patient registration
 * - Falls risk, fluid balance, wound assessment, NEWS2, physical health tracking
 *   all fail because nursing_assessments table doesn't exist
 */

import type { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  // ── Add health fund columns to patients table ──
  const hasHealthFundName = await knex.schema.hasColumn('patients', 'health_fund_name');
  if (!hasHealthFundName) {
    await knex.schema.alterTable('patients', (t) => {
      t.string('health_fund_name', 100).nullable();
      t.string('health_fund_number', 50).nullable();
    });
  }

  // ── Create nursing_assessments table ──
  if (!(await knex.schema.hasTable('nursing_assessments'))) {
    await knex.schema.createTable('nursing_assessments', (t) => {
      t.uuid('id').primary().defaultTo(knex.fn.uuid());
      t.uuid('clinic_id').notNullable().references('id').inTable('clinics').onDelete('RESTRICT');
      t.uuid('patient_id').notNullable().references('id').inTable('patients').onDelete('CASCADE');
      t.uuid('episode_id').nullable().references('id').inTable('episodes').onDelete('SET NULL');
      t.uuid('staff_id').nullable().references('id').inTable('staff').onDelete('SET NULL');
      t.string('assessment_type', 50).notNullable(); // news2, falls_risk, fluid_balance, wound_care, physical_tracking
      t.jsonb('scores').nullable();                   // Domain scores, item responses
      t.jsonb('assessment_data').nullable();           // Extended data (e.g. wound photos, fluid entries)
      t.decimal('total_score', 8, 2).nullable();
      t.string('risk_level', 30).nullable();           // low, moderate, high, critical
      t.text('notes').nullable();
      t.text('plan').nullable();                       // Care plan / interventions
      t.timestamp('assessed_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
      t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
      t.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());

      t.index(['clinic_id']);
      t.index(['patient_id', 'assessment_type']);
      t.index(['assessed_at']);
    });

    // RLS policy for nursing_assessments
    await knex.raw(`
      ALTER TABLE nursing_assessments ENABLE ROW LEVEL SECURITY;
      CREATE POLICY rls_nursing_assessments_tenant ON nursing_assessments
        FOR ALL USING (clinic_id = current_setting('app.clinic_id', true)::uuid);
    `);
  }

  // ── Create structured_observations table if not exists ──
  if (!(await knex.schema.hasTable('structured_observations'))) {
    await knex.schema.createTable('structured_observations', (t) => {
      t.uuid('id').primary().defaultTo(knex.fn.uuid());
      t.uuid('clinic_id').notNullable().references('id').inTable('clinics').onDelete('RESTRICT');
      t.uuid('patient_id').notNullable().references('id').inTable('patients').onDelete('CASCADE');
      t.uuid('staff_id').nullable().references('id').inTable('staff').onDelete('SET NULL');
      t.string('observation_type', 50).notNullable(); // level_1, level_2, level_3, level_4
      t.string('location', 100).nullable();
      t.string('mood', 100).nullable();
      t.string('behaviour', 100).nullable();
      t.text('risk_concerns').nullable();
      t.string('sleep_quality', 50).nullable();
      t.jsonb('values').nullable();                    // Extended observation values
      t.text('notes').nullable();
      t.timestamp('observed_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
      t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());

      t.index(['clinic_id']);
      t.index(['patient_id']);
      t.index(['observed_at']);
    });

    await knex.raw(`
      ALTER TABLE structured_observations ENABLE ROW LEVEL SECURITY;
      CREATE POLICY rls_structured_observations_tenant ON structured_observations
        FOR ALL USING (clinic_id = current_setting('app.clinic_id', true)::uuid);
    `);
  }
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('structured_observations');
  await knex.schema.dropTableIfExists('nursing_assessments');
  await knex.schema.alterTable('patients', (t) => {
    t.dropColumn('health_fund_name');
    t.dropColumn('health_fund_number');
  });
}
