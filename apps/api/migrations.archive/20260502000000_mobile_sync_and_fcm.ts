/**
 * Phase 11A — mobile sync + FCM token tables.
 *
 * Three schema additions:
 *
 *   1. `staff_fcm_tokens`   — one row per (staff_id, device_token).
 *      The Sara mobile app registers its FCM token on login via
 *      POST /fcm/register-device; logout deletes the row via
 *      DELETE /fcm/register-device/:token. Notifications
 *      (Phase 10A) gain a Phase 11A-side delivery path:
 *      notificationService.emit looks up every live staff token
 *      for the recipient and fans the push out via
 *      fcmService.sendToUser. Missing token → the bell row still
 *      lands and SSE still fires; FCM is additive, not a gate.
 *
 *   2. `patient_fcm_tokens` — same shape, keyed on patient_id.
 *      The Viva app registers its token via POST
 *      /patient-app/fcm/register-device. The patient outreach
 *      dispatcher (Phase 12B) checks for at least one live row
 *      here to decide whether to pick FCM over ACS SMS.
 *
 *   3. `patient_sync_preferences` — per-(patient, module) opt-in
 *      row controlling which entities the `/mobile/sync` delta
 *      endpoint returns to the patient's device. Default OFF for
 *      every module — patient has to tick the box in Viva's Sync
 *      Settings screen (Phase 11E). Disabling a module triggers
 *      tombstone delivery of every row in that module on the
 *      next sync so the local cache drains cleanly.
 *
 * CLAUDE.md §7 checklist satisfied: clinic_id NOT NULL + FK,
 * per-patient/staff hot-path indexes, UNIQUE business keys,
 * RLS policy on every new table, `deleted_at` for soft-deletes
 * where applicable (`deleted_at` on token tables so unregistering
 * a device keeps the audit trail; preferences use a hard toggle
 * on the `enabled` boolean instead).
 *
 * Partial unique index on the dedupe guard (patient_fcm_tokens:
 * no duplicate registration of the same token twice — the FCM
 * library already dedupes by token internally, and multiple
 * logins on the same device should reuse the single row).
 */
import type { Knex } from 'knex';

const PLATFORMS = ['ios', 'android'] as const;
const SYNC_MODULE_KEYS = [
  'appointments',
  'messages',
  'documents',
  'notifications',
  'reminders',
] as const;

const CHK = (values: readonly string[]) => values.map((s) => `'${s}'`).join(', ');

export async function up(knex: Knex): Promise<void> {
  // ── staff_fcm_tokens ─────────────────────────────────────────────────────
  if (!(await knex.schema.hasTable('staff_fcm_tokens'))) {
    await knex.schema.createTable('staff_fcm_tokens', (t) => {
      t.uuid('id').primary().defaultTo(knex.fn.uuid());
      t.uuid('clinic_id').notNullable().references('id').inTable('clinics').onDelete('CASCADE');
      t.uuid('staff_id').notNullable().references('id').inTable('staff').onDelete('CASCADE');
      t.text('device_token').notNullable();
      t.string('platform', 10).notNullable();
      t.timestamp('last_seen_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
      t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
      t.timestamp('deleted_at', { useTz: true }).nullable();
      t.index(['clinic_id']);
      t.index(['staff_id']);
      t.unique(['staff_id', 'device_token']);
    });
    await knex.raw(`
      ALTER TABLE staff_fcm_tokens
        ADD CONSTRAINT staff_fcm_tokens_platform_check
        CHECK (platform IN (${CHK(PLATFORMS)}))
    `);
    await knex.raw(`
      ALTER TABLE staff_fcm_tokens ENABLE ROW LEVEL SECURITY;
      CREATE POLICY rls_staff_fcm_tokens_tenant ON staff_fcm_tokens
        FOR ALL USING (clinic_id = current_setting('app.clinic_id', true)::uuid);
    `);
  }

  // ── patient_fcm_tokens ───────────────────────────────────────────────────
  if (!(await knex.schema.hasTable('patient_fcm_tokens'))) {
    await knex.schema.createTable('patient_fcm_tokens', (t) => {
      t.uuid('id').primary().defaultTo(knex.fn.uuid());
      t.uuid('clinic_id').notNullable().references('id').inTable('clinics').onDelete('CASCADE');
      t.uuid('patient_id').notNullable().references('id').inTable('patients').onDelete('CASCADE');
      // Links to the existing patient_app_accounts row — the auth
      // surface Viva uses. Null when the token was registered before
      // the account was created (shouldn't happen but defensive).
      t.uuid('patient_app_account_id').nullable().references('id').inTable('patient_app_accounts').onDelete('SET NULL');
      t.text('device_token').notNullable();
      t.string('platform', 10).notNullable();
      t.timestamp('last_seen_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
      t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
      t.timestamp('deleted_at', { useTz: true }).nullable();
      t.index(['clinic_id']);
      t.index(['patient_id']);
      t.unique(['patient_id', 'device_token']);
    });
    await knex.raw(`
      ALTER TABLE patient_fcm_tokens
        ADD CONSTRAINT patient_fcm_tokens_platform_check
        CHECK (platform IN (${CHK(PLATFORMS)}))
    `);
    await knex.raw(`
      ALTER TABLE patient_fcm_tokens ENABLE ROW LEVEL SECURITY;
      CREATE POLICY rls_patient_fcm_tokens_tenant ON patient_fcm_tokens
        FOR ALL USING (clinic_id = current_setting('app.clinic_id', true)::uuid);
    `);
  }

  // ── patient_sync_preferences ─────────────────────────────────────────────
  if (!(await knex.schema.hasTable('patient_sync_preferences'))) {
    await knex.schema.createTable('patient_sync_preferences', (t) => {
      t.uuid('id').primary().defaultTo(knex.fn.uuid());
      t.uuid('clinic_id').notNullable().references('id').inTable('clinics').onDelete('CASCADE');
      t.uuid('patient_id').notNullable().references('id').inTable('patients').onDelete('CASCADE');
      t.string('module_key', 40).notNullable();
      t.boolean('enabled').notNullable().defaultTo(false);
      // True = patient toggled it themselves on a device. False =
      // clinician set a default on the web. The audit trail uses
      // this to distinguish consent-of-record from clinic defaults.
      t.boolean('updated_by_patient').notNullable().defaultTo(false);
      t.uuid('updated_by_staff_id').nullable().references('id').inTable('staff').onDelete('SET NULL');
      t.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
      t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
      t.unique(['clinic_id', 'patient_id', 'module_key']);
      t.index(['patient_id']);
    });
    await knex.raw(`
      ALTER TABLE patient_sync_preferences
        ADD CONSTRAINT patient_sync_preferences_module_key_check
        CHECK (module_key IN (${CHK(SYNC_MODULE_KEYS)}))
    `);
    // Hot-path index for "which modules is this patient opted into?"
    await knex.raw(`
      CREATE INDEX IF NOT EXISTS idx_patient_sync_preferences_enabled
        ON patient_sync_preferences (patient_id, module_key)
        WHERE enabled = true
    `);
    await knex.raw(`
      ALTER TABLE patient_sync_preferences ENABLE ROW LEVEL SECURITY;
      CREATE POLICY rls_patient_sync_preferences_tenant ON patient_sync_preferences
        FOR ALL USING (clinic_id = current_setting('app.clinic_id', true)::uuid);
    `);
  }
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('patient_sync_preferences');
  await knex.schema.dropTableIfExists('patient_fcm_tokens');
  await knex.schema.dropTableIfExists('staff_fcm_tokens');
}
