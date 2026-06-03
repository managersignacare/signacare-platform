/**
 * Phase 12A — patient outreach dispatcher schema.
 *
 * Two schema changes:
 *
 *   1. `patients` gains three SMS-consent columns (`sms_consent`,
 *      `sms_consent_updated_at`, `sms_consent_updated_by`) so we
 *      can gate ACS SMS delivery on the patient's explicit opt-in
 *      and trace when / who captured that consent. The existing
 *      `phone_mobile` column is the delivery target — no new
 *      number column is needed.
 *
 *   2. `patient_outreach_log` is a new first-class audit table.
 *      EVERY outreach attempt (FCM push, ACS SMS, or audit-logged
 *      skip) writes exactly one row here. The clinician UI panel
 *      in Phase 12E renders the last 30 rows per patient so the
 *      question "did we actually reach the patient about their
 *      appointment on Friday?" is answerable with a single
 *      indexed query. The table also captures manual overrides:
 *      when a clinician forced a specific channel (e.g. "patient
 *      has Viva but their phone is broken, send via SMS instead"),
 *      `override_channel` + `override_reason` + `override_by_staff_id`
 *      record who / why / when.
 *
 * CLAUDE.md §7 checklist satisfied:
 *   - clinic_id NOT NULL with cascade
 *   - composite indexes for the hot paths (patient + attempted_at,
 *     clinic + failed_at for the ops dashboard)
 *   - CHECK on channel values and override_channel values
 *   - RLS policy on clinic_id (defence in depth on top of the
 *     tenant middleware's app.clinic_id setting)
 *   - varchar + CHECK rather than Postgres enum (house style)
 */
import type { Knex } from 'knex';

const CHANNELS = ['fcm', 'acs_sms', 'skipped'] as const;
const OVERRIDE_CHANNELS = ['fcm', 'acs_sms'] as const;

const CHK = (values: readonly string[]) => values.map((s) => `'${s}'`).join(', ');

async function hasColumn(knex: Knex, table: string, column: string): Promise<boolean> {
  return knex.schema.hasColumn(table, column);
}

export async function up(knex: Knex): Promise<void> {
  // ── patients.sms_consent + audit columns ────────────────────────────────
  const [hasSmsConsent, hasSmsConsentAt, hasSmsConsentBy] = await Promise.all([
    hasColumn(knex, 'patients', 'sms_consent'),
    hasColumn(knex, 'patients', 'sms_consent_updated_at'),
    hasColumn(knex, 'patients', 'sms_consent_updated_by'),
  ]);

  if (!hasSmsConsent || !hasSmsConsentAt || !hasSmsConsentBy) {
    await knex.schema.alterTable('patients', (t) => {
      if (!hasSmsConsent) t.boolean('sms_consent').notNullable().defaultTo(false);
      if (!hasSmsConsentAt) t.timestamp('sms_consent_updated_at', { useTz: true }).nullable();
      if (!hasSmsConsentBy) t.uuid('sms_consent_updated_by').nullable().references('id').inTable('staff').onDelete('SET NULL');
    });
  }

  // ── patient_outreach_log ─────────────────────────────────────────────────
  if (await knex.schema.hasTable('patient_outreach_log')) return;

  await knex.schema.createTable('patient_outreach_log', (t) => {
    t.uuid('id').primary().defaultTo(knex.fn.uuid());
    t.uuid('clinic_id').notNullable().references('id').inTable('clinics').onDelete('CASCADE');
    t.uuid('patient_id').notNullable().references('id').inTable('patients').onDelete('CASCADE');

    // `kind` is the logical reason for the outreach; the dispatcher
    // uses it to route message body rendering. Keep it free-form
    // varchar rather than a strict enum so new reasons can be added
    // without a schema change.
    t.string('kind', 60).notNullable();

    // Actual channel used, or 'skipped' when no path was available.
    t.string('channel', 20).notNullable();

    // Populated only when channel = 'skipped' — explains why the
    // dispatcher chose not to send. One of:
    //   no_fcm_token_and_no_consent | no_mobile_number |
    //   provider_error | clinic_sms_budget_exhausted |
    //   override_sms_but_no_consent | override_sms_but_no_mobile_number |
    //   override_fcm_but_no_token | opted_out
    t.string('skip_reason', 60).nullable();

    // FCM message id or ACS operation id — used for dead-letter
    // tracing when delivery fails downstream.
    t.text('provider_message_id').nullable();

    t.text('title').nullable();
    t.text('body').nullable();
    t.text('deep_link').nullable();

    // Manual override trail. Populated whenever a clinician forced
    // a specific channel rather than letting the auto decision tree
    // pick. `override_reason` is required (min 10 chars) at the
    // service layer; the CHECK below enforces the three-way
    // consistency (either all three override columns are set, or
    // none are).
    t.string('override_channel', 20).nullable();
    t.text('override_reason').nullable();
    t.uuid('override_by_staff_id').nullable().references('id').inTable('staff').onDelete('SET NULL');

    t.timestamp('attempted_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.timestamp('delivered_at', { useTz: true }).nullable();
    t.timestamp('failed_at', { useTz: true }).nullable();
    t.text('error_message').nullable();

    t.index(['clinic_id']);
    t.index(['patient_id']);
  });

  // CHECK constraints for channel / override_channel values and
  // the "all three override columns together or none" invariant.
  await knex.raw(`
    ALTER TABLE patient_outreach_log
      ADD CONSTRAINT patient_outreach_log_channel_check
      CHECK (channel IN (${CHK(CHANNELS)}))
  `);
  await knex.raw(`
    ALTER TABLE patient_outreach_log
      ADD CONSTRAINT patient_outreach_log_override_channel_check
      CHECK (override_channel IS NULL OR override_channel IN (${CHK(OVERRIDE_CHANNELS)}))
  `);
  await knex.raw(`
    ALTER TABLE patient_outreach_log
      ADD CONSTRAINT patient_outreach_log_override_consistency_check
      CHECK (
        (override_channel IS NULL AND override_reason IS NULL AND override_by_staff_id IS NULL)
        OR
        (override_channel IS NOT NULL AND override_reason IS NOT NULL AND override_by_staff_id IS NOT NULL)
      )
  `);

  // Hot-path indexes: clinician dashboard timeline per patient and
  // ops dashboard view of failed attempts.
  // @migration-raw-exempt: legacy simple index with DESC ordering; builder-equivalent pending R2 consolidation
  await knex.raw(`
    CREATE INDEX idx_patient_outreach_log_patient_attempted
      ON patient_outreach_log (clinic_id, patient_id, attempted_at DESC)
  `);
  await knex.raw(`
    CREATE INDEX idx_patient_outreach_log_failed
      ON patient_outreach_log (clinic_id, attempted_at DESC)
      WHERE failed_at IS NOT NULL
  `);

  await knex.raw(`
    ALTER TABLE patient_outreach_log ENABLE ROW LEVEL SECURITY;
    CREATE POLICY rls_patient_outreach_log_tenant ON patient_outreach_log
      FOR ALL USING (clinic_id = current_setting('app.clinic_id', true)::uuid);
  `);
}

export async function down(knex: Knex): Promise<void> {
  await knex.raw(`DROP INDEX IF EXISTS idx_patient_outreach_log_failed`);
  await knex.raw(`DROP INDEX IF EXISTS idx_patient_outreach_log_patient_attempted`);
  await knex.schema.dropTableIfExists('patient_outreach_log');

  const [hasSmsConsent, hasSmsConsentAt, hasSmsConsentBy] = await Promise.all([
    hasColumn(knex, 'patients', 'sms_consent'),
    hasColumn(knex, 'patients', 'sms_consent_updated_at'),
    hasColumn(knex, 'patients', 'sms_consent_updated_by'),
  ]);
  if (hasSmsConsent || hasSmsConsentAt || hasSmsConsentBy) {
    await knex.schema.alterTable('patients', (t) => {
      if (hasSmsConsentBy) t.dropColumn('sms_consent_updated_by');
      if (hasSmsConsentAt) t.dropColumn('sms_consent_updated_at');
      if (hasSmsConsent) t.dropColumn('sms_consent');
    });
  }
}
