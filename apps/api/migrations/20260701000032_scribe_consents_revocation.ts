// apps/api/migrations/20260701000032_scribe_consents_revocation.ts
//
// BUG-274 — patient-revocation signal for active scribe session.
//
// Pre-fix: BUG-035 gate runs at session open only. If a patient
// revokes recording consent mid-session, no mechanism halted the active
// scribe — chunks flowed, Whisper transcribed, ambient processor ran,
// llm_interactions rows were written with content captured AFTER the
// patient said "stop". Revocation between open and close was
// unobservable.
//
// This migration adds the DB half of BUG-274's two-part fix:
//   - `revoked_at timestamptz NULL` — revocation timestamp (SSoT).
//   - `revoked_by uuid NULL REFERENCES staff(id) ON DELETE SET NULL` —
//     who issued the revoke (clinician acting on patient's instruction,
//     or patient-facing portal admin).
//   - `revoke_reason text NULL` — free-form reason; NULL for revokes
//     with no reason supplied (legacy path).
//   - Partial index on `(id) WHERE revoked_at IS NULL` so the hot path
//     (still-valid consents) benefits from index-only scans; the
//     verifyRecordingConsent helper filters on `revoked_at IS NULL` and
//     this index gives it O(1) lookup.
//
// The app-layer half (revoke endpoint, per-chunk polling, audit row,
// WebSocket close 4403, buffer + transcript purge) lands in the same
// commit. Layer A (this migration) adds the column so the app can
// write revocations; Layer B (app) enforces the invariant on every
// chunk ingestion path.
//
// Standard: APP 12 (consent withdrawal); ACHS Standard 4 (patient
// partnership); OAIC APP 11 (security of personal information — once
// withdrawn, must be respected in-flight, not just at next session).

import { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  await knex.schema.alterTable('scribe_consents', (t) => {
    t.timestamp('revoked_at', { useTz: true }).nullable();
    t.uuid('revoked_by').nullable().references('id').inTable('staff').onDelete('SET NULL');
    t.text('revoke_reason').nullable();
  });

  // Partial index on (id) where revoked_at IS NULL — hot path for
  // verifyRecordingConsent. The full PK already exists; this partial
  // index is redundant-by-PK but faster for the WHERE revoked_at IS
  // NULL branch because Postgres can skip the revoked rows at index
  // scan rather than at filter time.
  // @migration-raw-exempt: index_partial
  await knex.raw(`
    CREATE INDEX IF NOT EXISTS scribe_consents_active_idx
      ON scribe_consents (id)
      WHERE revoked_at IS NULL
  `);
}

export async function down(knex: Knex): Promise<void> {
  // @migration-raw-exempt: index_partial
  await knex.raw('DROP INDEX IF EXISTS scribe_consents_active_idx');
  await knex.schema.alterTable('scribe_consents', (t) => {
    t.dropColumn('revoke_reason');
    t.dropColumn('revoked_by');
    t.dropColumn('revoked_at');
  });
}
