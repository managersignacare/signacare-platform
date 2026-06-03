/**
 * Phase 10A — augment the existing `notifications` table so it can
 * host the durable notification centre.
 *
 * A `notifications` table already existed from the v2 baseline
 * schema with columns (recipient_staff_id, type, title, body, link,
 * priority, is_read, read_at, source_type, source_id, …). The
 * workflow engine and a set of legacy role-feature routes already
 * write to it and it already has an RLS policy + audit trigger.
 *
 * Rather than create a parallel table (`notifications_v2`), this
 * migration extends the existing one with the fields the Phase 10A
 * service needs and the indexes the bell hot path requires:
 *
 *   - severity varchar(16) CHECK — strict four-value enum separate
 *     from the existing free-form `priority` column which picked
 *     up a messy mix of type-hint values over time
 *   - category varchar(40) — optional strict category. Separate
 *     from the existing `type` column so callers can start tagging
 *     with a whitelist without breaking legacy rows
 *   - payload jsonb — arbitrary context, also the carrier for the
 *     `dedupe_key` idempotency field
 *   - override_patient_sync boolean — safety-critical flag for
 *     alerts Viva's per-module opt-in can't silence (Phase 11A)
 *   - recipient_staff_id relaxed to NULLABLE — enables clinic-wide
 *     broadcasts where one row serves every clinician. The existing
 *     rows are all user-targeted so no data migration is needed
 *   - Partial unique index on (clinic_id, payload->>'dedupe_key')
 *     for the appointment reminder cron's idempotency guarantee
 *   - Hot-path indexes for the bell unread popover and clinic
 *     broadcast feed
 *
 * Existing rows are untouched. New columns default to NULL or
 * false so no backfill is needed. The audit trigger and RLS policy
 * already in place continue to apply.
 */
import type { Knex } from 'knex';

const SEVERITIES = ['info', 'success', 'warning', 'critical'] as const;

const CHK = (values: readonly string[]) => values.map((s) => `'${s}'`).join(', ');

async function hasColumn(knex: Knex, table: string, column: string): Promise<boolean> {
  return knex.schema.hasColumn(table, column);
}

export async function up(knex: Knex): Promise<void> {
  if (!(await knex.schema.hasTable('notifications'))) {
    // Defensive: if the v2 baseline table is missing (fresh dev DB),
    // create it with the full merged shape so this migration is a
    // single source of truth.
    await knex.schema.createTable('notifications', (t) => {
      t.uuid('id').primary().defaultTo(knex.fn.uuid());
      t.uuid('clinic_id').notNullable().references('id').inTable('clinics').onDelete('CASCADE');
      t.uuid('recipient_staff_id').nullable().references('id').inTable('staff').onDelete('CASCADE');
      t.string('type', 50).notNullable().defaultTo('generic');
      t.string('title', 300).notNullable();
      t.text('body').nullable();
      t.string('link', 500).nullable();
      t.string('priority', 20).nullable().defaultTo('normal');
      t.boolean('is_read').notNullable().defaultTo(false);
      t.timestamp('read_at', { useTz: true }).nullable();
      t.string('source_type', 50).nullable();
      t.uuid('source_id').nullable();
      t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
      t.timestamp('expires_at', { useTz: true }).nullable();
      t.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());

      t.index(['clinic_id']);
      t.index(['recipient_staff_id', 'is_read', 'created_at']);
    });
    await knex.raw(`
      ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;
      CREATE POLICY rls_notifications_tenant ON notifications
        FOR ALL USING (clinic_id = current_setting('app.clinic_id', true)::uuid);
    `);
  }

  // Relax recipient_staff_id to nullable so clinic-wide broadcasts
  // can be modelled as a single row with recipient_staff_id NULL.
  // Existing rows are user-targeted, no backfill needed.
  if (await knex.schema.hasColumn('notifications', 'recipient_staff_id')) {
    const colInfo = await knex.raw(
      `SELECT is_nullable FROM information_schema.columns WHERE table_name='notifications' AND column_name='recipient_staff_id'`,
    );
    if (colInfo.rows?.[0]?.is_nullable === 'NO') {
      // @migration-raw-exempt: legacy ALTER COLUMN DROP NOT NULL; builder-equivalent pending R2 consolidation
      await knex.raw(`ALTER TABLE notifications ALTER COLUMN recipient_staff_id DROP NOT NULL`);
    }
  }

  // Hoist per-column existence probes (Knex alterTable callbacks must
  // be synchronous — see the 20260410000001_blob_storage_columns.ts
  // fix for the footgun). Do all hasColumn checks first, then the
  // alterTable runs synchronously with only the missing columns.
  const [hasSeverity, hasCategory, hasPayload, hasOverride] = await Promise.all([
    hasColumn(knex, 'notifications', 'severity'),
    hasColumn(knex, 'notifications', 'category'),
    hasColumn(knex, 'notifications', 'payload'),
    hasColumn(knex, 'notifications', 'override_patient_sync'),
  ]);

  if (!hasSeverity || !hasCategory || !hasPayload || !hasOverride) {
    await knex.schema.alterTable('notifications', (t) => {
      if (!hasSeverity) t.string('severity', 16).nullable();
      if (!hasCategory) t.string('category', 40).nullable();
      if (!hasPayload) t.jsonb('payload').nullable();
      if (!hasOverride) t.boolean('override_patient_sync').notNullable().defaultTo(false);
    });
  }

  if (!hasSeverity) {
    // CHECK only applies to NEW rows (existing rows have NULL
    // severity which is allowed). Callers through notificationService
    // always supply a valid severity — the Zod layer enforces it.
    await knex.raw(`
      ALTER TABLE notifications
        ADD CONSTRAINT notifications_severity_check
        CHECK (severity IS NULL OR severity IN (${CHK(SEVERITIES)}))
    `);
  }

  // Hot-path bell index — per-user OR clinic-wide broadcast,
  // filtered to unread and not soft-deleted. The existing
  // idx_notif_recipient index is close but doesn't cover the
  // broadcast path (recipient_staff_id IS NULL) which we now need.
  await knex.raw(`
    CREATE INDEX IF NOT EXISTS idx_notifications_user_unread_bell
      ON notifications (clinic_id, recipient_staff_id, created_at DESC)
      WHERE is_read = false
  `);

  await knex.raw(`
    CREATE INDEX IF NOT EXISTS idx_notifications_clinic_broadcast
      ON notifications (clinic_id, created_at DESC)
      WHERE recipient_staff_id IS NULL
  `);

  // Partial unique on (clinic_id, payload->>'dedupe_key'). Enables
  // the idempotency guarantee for crons (e.g. the appointment
  // reminder scheduler that runs every 15 min). Unique only when
  // a dedupe key is actually set — NULL payloads are unconstrained.
  await knex.raw(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_notifications_dedupe
      ON notifications (clinic_id, (payload->>'dedupe_key'))
      WHERE payload->>'dedupe_key' IS NOT NULL
  `);

  await knex.raw(`
    CREATE INDEX IF NOT EXISTS idx_notifications_expiry
      ON notifications (expires_at)
      WHERE expires_at IS NOT NULL
  `);
}

export async function down(knex: Knex): Promise<void> {
  await knex.raw(`DROP INDEX IF EXISTS idx_notifications_expiry`);
  await knex.raw(`DROP INDEX IF EXISTS idx_notifications_dedupe`);
  await knex.raw(`DROP INDEX IF EXISTS idx_notifications_clinic_broadcast`);
  await knex.raw(`DROP INDEX IF EXISTS idx_notifications_user_unread_bell`);
  await knex.raw(`ALTER TABLE notifications DROP CONSTRAINT IF EXISTS notifications_severity_check`);
  const [hasSeverity, hasCategory, hasPayload, hasOverride] = await Promise.all([
    hasColumn(knex, 'notifications', 'severity'),
    hasColumn(knex, 'notifications', 'category'),
    hasColumn(knex, 'notifications', 'payload'),
    hasColumn(knex, 'notifications', 'override_patient_sync'),
  ]);
  if (hasSeverity || hasCategory || hasPayload || hasOverride) {
    await knex.schema.alterTable('notifications', (t) => {
      if (hasOverride) t.dropColumn('override_patient_sync');
      if (hasPayload) t.dropColumn('payload');
      if (hasCategory) t.dropColumn('category');
      if (hasSeverity) t.dropColumn('severity');
    });
  }
  // Keep recipient_staff_id nullable on down — reverting to NOT NULL
  // would fail against any clinic-broadcast rows created in the
  // meantime. This is a defensive one-way rollback.
}
