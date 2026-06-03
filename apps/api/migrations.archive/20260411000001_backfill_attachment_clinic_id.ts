import type { Knex } from 'knex';

/**
 * S1.1-DEFERRED-C — Backfill clinic_id on legacy attachment rows
 *
 * Migration 20260410000001_blob_storage_columns.ts added a nullable
 * clinic_id column to patient_legal_attachments and patient_alert_attachments
 * (defensive guard, in case the v2 baseline schema didn't include it).
 * That migration left existing rows with clinic_id = NULL because
 * filling them requires a JOIN against the parent patient/alert row,
 * which is exactly what this migration does.
 *
 * Append-only, idempotent (only updates rows where clinic_id IS NULL),
 * uses hasColumn guards so it's safe to re-run on environments where
 * the column never existed in the first place. Multi-tenant: this is
 * the migration that would otherwise let a future RLS policy reject
 * legacy attachment rows because their clinic_id is NULL.
 *
 * patient_attachments is intentionally NOT backfilled here because the
 * patientRoutes INSERT path (PATH1) has been writing clinic_id all
 * along; that table's column is already populated for any non-orphaned
 * row. If there are legacy orphans they should be triaged manually.
 *
 * patient_alert_attachments has a more roundabout path because it
 * doesn't have patient_id directly — it FKs to patient_alerts, which
 * has clinic_id. Legal attachments FK to patients directly so the join
 * is one hop.
 */

export async function up(knex: Knex): Promise<void> {
  // ── patient_legal_attachments → patients ──────────────────────────────
  if (
    (await knex.schema.hasTable('patient_legal_attachments')) &&
    (await knex.schema.hasColumn('patient_legal_attachments', 'clinic_id'))
  ) {
    // Update via a correlated subquery — Knex doesn't have a portable
    // UPDATE...FROM helper, so use raw SQL.
    await knex.raw(`
      UPDATE patient_legal_attachments la
      SET    clinic_id = p.clinic_id
      FROM   patients p
      WHERE  la.patient_id = p.id
        AND  la.clinic_id IS NULL
    `);
  }

  // ── patient_alert_attachments → patient_alerts ────────────────────────
  if (
    (await knex.schema.hasTable('patient_alert_attachments')) &&
    (await knex.schema.hasColumn('patient_alert_attachments', 'clinic_id'))
  ) {
    await knex.raw(`
      UPDATE patient_alert_attachments aa
      SET    clinic_id = pa.clinic_id
      FROM   patient_alerts pa
      WHERE  aa.patient_alert_id = pa.id
        AND  aa.clinic_id IS NULL
    `);
  }

  // ── patient_attachments (defensive sweep — should be a no-op) ─────────
  // The PATH1 fix has been writing clinic_id on every new row for months.
  // This sweep catches any pre-PATH1 orphans that survived the prior
  // baseline-rename migration. If clinic_id stays NULL after this,
  // the row is genuinely orphaned and a manual cleanup is needed.
  if (
    (await knex.schema.hasTable('patient_attachments')) &&
    (await knex.schema.hasColumn('patient_attachments', 'clinic_id'))
  ) {
    await knex.raw(`
      UPDATE patient_attachments at
      SET    clinic_id = p.clinic_id
      FROM   patients p
      WHERE  at.patient_id = p.id
        AND  at.clinic_id IS NULL
    `);
  }
}

export async function down(): Promise<void> {
  // Down migrations are intentionally no-ops in this codebase. We do
  // NOT null out clinic_id on rollback because that would leave the
  // tables in a worse state than before this migration ran.
}
