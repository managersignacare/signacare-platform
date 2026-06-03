import type { Knex } from 'knex';

const CANONICAL_SPECIALTIES = [
  { code: 'mental_health', display: 'Mental Health', system: 'signacare', snomed_code: '394587001', sort_order: 10 },
  { code: 'general_medicine', display: 'Internal Medicine', system: 'http://snomed.info/sct', snomed_code: '419192003', sort_order: 20 },
  { code: 'endocrinology', display: 'Endocrinology', system: 'http://snomed.info/sct', snomed_code: '394583002', sort_order: 30 },
  { code: 'paediatrics', display: 'Paediatrics', system: 'http://snomed.info/sct', snomed_code: '394537008', sort_order: 40 },
  { code: 'obstetrics_gynaecology', display: 'Obstetrics & Gynaecology', system: 'http://snomed.info/sct', snomed_code: '394586005', sort_order: 50 },
  { code: 'surgery', display: 'Surgery', system: 'http://snomed.info/sct', snomed_code: '394609007', sort_order: 60 },
  { code: 'oncology', display: 'Oncology', system: 'http://snomed.info/sct', snomed_code: '394593009', sort_order: 70 },
] as const;

/**
 * BUG-650 — Canonical specialties self-heal backfill.
 *
 * Several write paths (referrals/episodes/appointments and others) hold FK
 * references to specialties.code, especially default 'mental_health'.
 * If canonical specialty rows are missing, runtime writes fail with 23503
 * ("Referenced record not found"). This migration idempotently restores them.
 */
export async function up(knex: Knex): Promise<void> {
  const hasSpecialties = await knex.schema.hasTable('specialties');
  if (!hasSpecialties) return;

  await knex('specialties')
    .insert(
      CANONICAL_SPECIALTIES.map((row) => ({
        ...row,
        is_active: true,
      })),
    )
    .onConflict('code')
    .merge(['display', 'system', 'snomed_code', 'sort_order', 'is_active']);
}

export async function down(): Promise<void> {
  // @migration-down-noop: BUG-650 data-healing backfill is intentionally append-only.
}
