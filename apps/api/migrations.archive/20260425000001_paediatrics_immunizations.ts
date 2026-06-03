/**
 * Multi-specialty Phase 5 — Paediatrics: immunizations.
 *
 * CVX-coded immunization records, FHIR R5 Immunization-aligned.
 *
 * CVX (Vaccines Administered) is the CDC's code system for vaccines —
 * the global standard used by every paediatric EMR for immunization
 * tracking. Each row stores cvx_code (e.g. '20' for DTaP), the
 * administration date, dose number in the series, lot number,
 * site, route, and the administering staff member.
 *
 * Status enum follows the FHIR Immunization resource:
 *   completed  — vaccine administered (the happy path)
 *   entered-in-error — retracted; soft-delete aware
 *   not-done   — refused / contraindicated
 *
 * Patient-level. Per-tenant RLS.
 */
import type { Knex } from 'knex';

const STATUSES = ['completed', 'entered-in-error', 'not-done'] as const;
const SITES = [
  'left-deltoid',
  'right-deltoid',
  'left-thigh',
  'right-thigh',
  'left-buttock',
  'right-buttock',
  'oral',
  'nasal',
  'other',
] as const;
const ROUTES = ['IM', 'SC', 'ID', 'PO', 'IN', 'other'] as const;

const CHK = (values: readonly string[]) => values.map((s) => `'${s}'`).join(', ');

export async function up(knex: Knex): Promise<void> {
  if (await knex.schema.hasTable('immunizations')) return;

  await knex.schema.createTable('immunizations', (t) => {
    t.uuid('id').primary().defaultTo(knex.fn.uuid());
    t.uuid('clinic_id').notNullable().references('id').inTable('clinics').onDelete('RESTRICT');
    t.uuid('patient_id').notNullable().references('id').inTable('patients').onDelete('CASCADE');
    t.uuid('episode_id').nullable().references('id').inTable('episodes').onDelete('SET NULL');

    // CVX coding
    t.string('cvx_code', 10).notNullable();
    t.string('vaccine_name', 200).notNullable();
    t.string('manufacturer', 100).nullable();

    // Series + dose
    t.string('series_name', 100).nullable();
    t.smallint('dose_number').nullable();
    t.smallint('series_doses').nullable();

    // Administration
    t.date('administered_date').notNullable();
    t.string('lot_number', 50).nullable();
    t.date('expiration_date').nullable();
    t.string('site', 30).nullable();
    t.string('route', 10).nullable();
    t.decimal('dose_quantity_ml', 5, 2).nullable();

    t.string('status', 20).notNullable().defaultTo('completed');
    t.text('not_done_reason').nullable();
    t.text('note').nullable();

    t.uuid('administered_by').nullable().references('id').inTable('staff').onDelete('SET NULL');
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.timestamp('deleted_at', { useTz: true }).nullable();

    t.index(['clinic_id']);
    t.index(['patient_id']);
    t.index(['clinic_id', 'patient_id', 'administered_date']);
    t.index(['clinic_id', 'cvx_code']);
  });

  await knex.raw(`
    ALTER TABLE immunizations
      ADD CONSTRAINT immunizations_status_check
      CHECK (status IN (${CHK(STATUSES)}))
  `);
  await knex.raw(`
    ALTER TABLE immunizations
      ADD CONSTRAINT immunizations_site_check
      CHECK (site IS NULL OR site IN (${CHK(SITES)}))
  `);
  await knex.raw(`
    ALTER TABLE immunizations
      ADD CONSTRAINT immunizations_route_check
      CHECK (route IS NULL OR route IN (${CHK(ROUTES)}))
  `);
  await knex.raw(`
    ALTER TABLE immunizations
      ADD CONSTRAINT immunizations_dose_number_check
      CHECK (dose_number IS NULL OR (dose_number > 0 AND dose_number < 20))
  `);

  await knex.raw(`
    ALTER TABLE immunizations ENABLE ROW LEVEL SECURITY;
    CREATE POLICY rls_immunizations_tenant ON immunizations
      FOR ALL USING (clinic_id = current_setting('app.clinic_id', true)::uuid);
  `);
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('immunizations');
}
