/**
 * Multi-specialty Phase 5 — Paediatrics: developmental_milestones.
 *
 * Tracks developmental milestones across five WHO domains:
 *   - gross_motor     (rolling, sitting, walking)
 *   - fine_motor      (grasping, drawing)
 *   - language        (babbling, first words)
 *   - cognitive       (object permanence, problem solving)
 *   - social_emotional (smiling, separation anxiety)
 *
 * Each row is a single milestone observation: which domain, which
 * milestone (free-text label or coded), expected age in months,
 * achieved-at age in months (nullable if not yet achieved or delayed),
 * status (achieved | delayed | not-assessed | regression), and an
 * optional clinician note.
 *
 * Patient-level. Per-tenant RLS.
 */
import type { Knex } from 'knex';

const DOMAINS = [
  'gross_motor',
  'fine_motor',
  'language',
  'cognitive',
  'social_emotional',
] as const;

const STATUSES = ['achieved', 'delayed', 'not_assessed', 'regression'] as const;

const CHK = (values: readonly string[]) => values.map((s) => `'${s}'`).join(', ');

export async function up(knex: Knex): Promise<void> {
  if (await knex.schema.hasTable('developmental_milestones')) return;

  await knex.schema.createTable('developmental_milestones', (t) => {
    t.uuid('id').primary().defaultTo(knex.fn.uuid());
    t.uuid('clinic_id').notNullable().references('id').inTable('clinics').onDelete('RESTRICT');
    t.uuid('patient_id').notNullable().references('id').inTable('patients').onDelete('CASCADE');
    t.uuid('episode_id').nullable().references('id').inTable('episodes').onDelete('SET NULL');

    t.string('domain', 20).notNullable();
    t.string('milestone', 200).notNullable();
    t.smallint('expected_age_months').nullable();
    t.smallint('achieved_at_months').nullable();
    t.string('status', 20).notNullable().defaultTo('not_assessed');
    t.text('note').nullable();

    t.timestamp('assessed_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.uuid('assessed_by').nullable().references('id').inTable('staff').onDelete('SET NULL');

    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.timestamp('deleted_at', { useTz: true }).nullable();

    t.index(['clinic_id']);
    t.index(['patient_id']);
    t.index(['clinic_id', 'patient_id', 'domain']);
  });

  await knex.raw(`
    ALTER TABLE developmental_milestones
      ADD CONSTRAINT developmental_milestones_domain_check
      CHECK (domain IN (${CHK(DOMAINS)}))
  `);
  await knex.raw(`
    ALTER TABLE developmental_milestones
      ADD CONSTRAINT developmental_milestones_status_check
      CHECK (status IN (${CHK(STATUSES)}))
  `);
  await knex.raw(`
    ALTER TABLE developmental_milestones
      ADD CONSTRAINT developmental_milestones_age_check
      CHECK (
        (expected_age_months IS NULL OR (expected_age_months >= 0 AND expected_age_months <= 240)) AND
        (achieved_at_months IS NULL OR (achieved_at_months >= 0 AND achieved_at_months <= 240))
      )
  `);

  await knex.raw(`
    ALTER TABLE developmental_milestones ENABLE ROW LEVEL SECURITY;
    CREATE POLICY rls_developmental_milestones_tenant ON developmental_milestones
      FOR ALL USING (clinic_id = current_setting('app.clinic_id', true)::uuid);
  `);
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('developmental_milestones');
}
