import type { Knex } from 'knex';

/**
 * Phase 0.7.5 c24 D9b — SD45-48 fix: add missing columns to patient_contacts.
 *
 * The patient_contacts table had 4 classes of ghost-column drift exposed by
 * the .returning('*') audit. The route code in patientRoutes.ts was
 * writing these columns on INSERT/UPDATE and reading them on SELECT, but
 * none of them existed. Every request that tried to record contact_type,
 * consent_level, consent_notes, or soft-delete a row was silently dropping
 * the column value.
 *
 * Columns added:
 *   - contact_type    varchar(50)  — DTO field `contactType`, default 'support_person'
 *   - consent_level   varchar(50)  — DTO field `consentLevel`, default 'full'
 *   - consent_notes   text         — DTO field `consentNotes`
 *   - deleted_at      timestamptz  — soft-delete timestamp (already used by code)
 *   - clinic_id       uuid         — explicit tenant column (CLAUDE.md §1.3 parity
 *                                     with other clinical tables; backfilled from
 *                                     patient_id → patients.clinic_id; NOT NULL
 *                                     + FK after backfill)
 *
 * RLS policy added so patient_contacts matches the tenant-isolation
 * discipline of every other clinical table (§6.3). The CASCADE on
 * patient_id → patients already enforced implicit tenancy via join, but
 * explicit clinic_id + RLS provide defense-in-depth.
 */
export async function up(knex: Knex): Promise<void> {
  await knex.schema.alterTable('patient_contacts', (t) => {
    t.string('contact_type', 50).defaultTo('support_person');
    t.string('consent_level', 50).defaultTo('full');
    t.text('consent_notes');
    t.timestamp('deleted_at', { useTz: true });
    t.uuid('clinic_id').references('id').inTable('clinics').onDelete('CASCADE');
  });

  // Backfill clinic_id from patients
  await knex.raw(`
    UPDATE patient_contacts pc
    SET clinic_id = p.clinic_id
    FROM patients p
    WHERE pc.patient_id = p.id
      AND pc.clinic_id IS NULL;
  `);

  // After backfill, enforce NOT NULL so future INSERTs without clinic_id fail loudly
  await knex.schema.alterTable('patient_contacts', (t) => {
    t.uuid('clinic_id').notNullable().alter();
  });

  // Indexes per CLAUDE.md §7.1 — every FK column gets an index
  await knex.schema.alterTable('patient_contacts', (t) => {
    t.index(['clinic_id']);
    t.index(['deleted_at']);
  });

  // RLS policy — CLAUDE.md §6.3 — tenant isolation enforced at the row level.
  // Still needs knex.raw because Knex's builder doesn't cover RLS primitives.
  await knex.raw(`
    ALTER TABLE patient_contacts ENABLE ROW LEVEL SECURITY;
    DROP POLICY IF EXISTS rls_patient_contacts_tenant ON patient_contacts;
    CREATE POLICY rls_patient_contacts_tenant ON patient_contacts
      FOR ALL
      USING (clinic_id = current_setting('app.clinic_id', true)::uuid)
      WITH CHECK (clinic_id = current_setting('app.clinic_id', true)::uuid);
  `);
}

export async function down(knex: Knex): Promise<void> {
  await knex.raw(`
    DROP POLICY IF EXISTS rls_patient_contacts_tenant ON patient_contacts;
    ALTER TABLE patient_contacts DISABLE ROW LEVEL SECURITY;
  `);
  await knex.schema.alterTable('patient_contacts', (t) => {
    t.dropIndex(['clinic_id']);
    t.dropIndex(['deleted_at']);
    t.dropColumn('contact_type');
    t.dropColumn('consent_level');
    t.dropColumn('consent_notes');
    t.dropColumn('deleted_at');
    t.dropColumn('clinic_id');
  });
}
