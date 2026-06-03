import { Knex } from 'knex';

/**
 * Audit Tier 4.3 — Sara scribe recording consent.
 *
 * User direction (2026-04-19): BOTH consent modes must be supported —
 * patient e-signature and clinician attestation. Mode is selected in
 * Power Settings during onboarding and changeable later.
 *
 * Two new tables + an RLS policy per §6.3:
 *
 *   1. `clinic_settings` — per-clinic configuration bag. Starts with a
 *      single `scribe_consent_mode` column; future tiers (5.3 AI chat
 *      classifier mode, 5.13 scribe audio retention, 16.9 clinic
 *      letterhead, etc.) will ADD COLUMN as needed.
 *   2. `scribe_consents` — per-session consent receipt. Captures (a)
 *      the clinic's configured mode at the time of consent, (b) the
 *      patient's PNG signature blob for e-signature mode, (c) the
 *      clinician's typed attestation + clinician_id for attestation
 *      mode. Append-only (no updated_at trigger — corrections create
 *      new rows per §G6).
 *
 * Both tables have RLS policies scoped to `clinic_id = current_setting
 * ('app.clinic_id')::uuid` per CLAUDE.md §6.3.
 *
 * Reversible: down() drops both tables + their RLS policies.
 *
 * 13-point audit: #5 Confidentiality (per-session consent is a
 * privacy-critical artefact), #7 Security (RLS-scoped, append-only),
 * #8 DB (indexed FKs, reversible), #10 API (feature-gated).
 */
export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable('clinic_settings', (t) => {
    t.uuid('clinic_id')
      .primary()
      .references('id').inTable('clinics').onDelete('CASCADE');
    t.text('scribe_consent_mode')
      .notNullable()
      .defaultTo('clinician_attestation');
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
  });

  // @migration-raw-exempt: check_constraint
  await knex.raw(`
    ALTER TABLE clinic_settings
      ADD CONSTRAINT clinic_settings_scribe_consent_mode_check
      CHECK (scribe_consent_mode IN ('patient_esignature', 'clinician_attestation'))
  `);

  // @migration-raw-exempt: rls_policy
  await knex.raw(`
    ALTER TABLE clinic_settings ENABLE ROW LEVEL SECURITY;
    CREATE POLICY rls_clinic_settings_tenant ON clinic_settings
      FOR ALL
      USING (clinic_id = NULLIF(current_setting('app.clinic_id', true), '')::uuid)
      WITH CHECK (clinic_id = NULLIF(current_setting('app.clinic_id', true), '')::uuid);
  `);

  await knex.schema.createTable('scribe_consents', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.uuid('clinic_id')
      .notNullable()
      .references('id').inTable('clinics').onDelete('RESTRICT');
    t.uuid('patient_id')
      .notNullable()
      .references('id').inTable('patients').onDelete('CASCADE');
    // session_id is a free-form identifier the scribe runtime uses to
    // correlate the audio / transcript / consent triple. Nullable
    // because some flows may capture consent before the session id is
    // assigned (e.g. pre-session briefing).
    t.string('session_id', 128).nullable();
    t.text('mode').notNullable();  // 'patient_esignature' | 'clinician_attestation'
    // e-signature mode artefacts
    t.text('patient_signature_png').nullable();  // base64 PNG from signature pad
    // clinician attestation mode artefacts
    t.uuid('clinician_attested_by_id')
      .nullable()
      .references('id').inTable('staff').onDelete('SET NULL');
    t.text('clinician_attestation_text').nullable();
    t.timestamp('attested_at', { useTz: true }).nullable();
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    // §7.1 — index every FK column.
    t.index(['clinic_id']);
    t.index(['patient_id']);
    t.index(['session_id']);
    t.index(['clinician_attested_by_id']);
  });

  // @migration-raw-exempt: check_constraint
  await knex.raw(`
    ALTER TABLE scribe_consents
      ADD CONSTRAINT scribe_consents_mode_check
      CHECK (mode IN ('patient_esignature', 'clinician_attestation'))
  `);

  // @migration-raw-exempt: rls_policy
  await knex.raw(`
    ALTER TABLE scribe_consents ENABLE ROW LEVEL SECURITY;
    CREATE POLICY rls_scribe_consents_tenant ON scribe_consents
      FOR ALL
      USING (clinic_id = NULLIF(current_setting('app.clinic_id', true), '')::uuid)
      WITH CHECK (clinic_id = NULLIF(current_setting('app.clinic_id', true), '')::uuid);
  `);
}

export async function down(knex: Knex): Promise<void> {
  // @migration-raw-exempt: drop_policy_if_exists
  await knex.raw('DROP POLICY IF EXISTS rls_scribe_consents_tenant ON scribe_consents');
  // @migration-raw-exempt: drop_policy_if_exists
  await knex.raw('DROP POLICY IF EXISTS rls_clinic_settings_tenant ON clinic_settings');
  await knex.schema.dropTableIfExists('scribe_consents');
  await knex.schema.dropTableIfExists('clinic_settings');
}
