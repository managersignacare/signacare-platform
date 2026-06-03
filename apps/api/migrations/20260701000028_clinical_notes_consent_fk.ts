import { Knex } from 'knex';

/**
 * BUG-273 — clinical_notes.consent_id FK to scribe_consents.
 *
 * Before this migration, the audit trail binding a clinical_note to
 * the recording consent that authorised it lived only in audit_log
 * rows (action='AMBIENT_NOTE_RECORDING_STARTED', record_id=consentId,
 * new_values->>'audioStorageKey' bound to the audio file). Any forensic
 * replay had to string-join clinical_notes ↔ audit_log, fragile and
 * unenforceable at the database layer.
 *
 * This migration adds a direct FK clinical_notes.consent_id →
 * scribe_consents(id) ON DELETE RESTRICT so (a) the forensic link is a
 * single JOIN, and (b) a scribe_consents DELETE is blocked while any
 * clinical_note references it.
 *
 * Zero-downtime pattern (CLAUDE.md §12.1 + BUG-273 L5 absorption):
 *
 *   Step 1 (this migration): ADD nullable column.
 *   Step 2 (this migration): CREATE partial INDEX on the new column.
 *   Step 3 (this migration): ADD CONSTRAINT … NOT VALID — existing
 *     rows are NOT scanned. Only new inserts/updates are checked.
 *   Step 4 (ops-run, AFTER backfill completes): ALTER TABLE
 *     VALIDATE CONSTRAINT. Brief ShareUpdateExclusiveLock; uses the
 *     FK index so no table scan.
 *   Step 5 (ops-run, OUTSIDE this migration):
 *     apps/api/scripts/backfill-clinical-notes-consent-id.ts runs
 *     chunked UPDATEs with explicit preflight ambiguity check.
 *
 * NOT NULL enforcement is deferred to BUG-315 (S2 B-11) — manually-
 * authored notes + pre-BUG-035 rows have no consent row. Leaving the
 * column NULLABLE for now lets the FK land without cleaning up
 * legacy data.
 */
export async function up(knex: Knex): Promise<void> {
  // Step 1 — ADD nullable column.
  await knex.schema.alterTable('clinical_notes', (t) => {
    t.uuid('consent_id').nullable();
  });

  // Step 2 — partial index (most legacy rows are NULL). Plain CREATE
  // INDEX (not CONCURRENTLY) because Knex wraps migrations in a
  // transaction. Blocking AccessShareLock on a single-column partial
  // index on a UUID is measured in seconds; acceptable in a
  // maintenance window.
  // @migration-raw-exempt: index_partial
  await knex.raw(`
    CREATE INDEX clinical_notes_consent_id_idx
      ON clinical_notes (consent_id)
      WHERE consent_id IS NOT NULL
  `);

  // Step 3 — ADD FK as NOT VALID. Existing rows are NOT scanned.
  // Only new inserts / updates are checked. ops will run
  // VALIDATE CONSTRAINT after backfill to enforce against old rows.
  // @migration-raw-exempt: check_constraint
  await knex.raw(`
    ALTER TABLE clinical_notes
      ADD CONSTRAINT clinical_notes_consent_id_fk
      FOREIGN KEY (consent_id)
      REFERENCES scribe_consents(id)
      ON DELETE RESTRICT
      NOT VALID
  `);
}

export async function down(knex: Knex): Promise<void> {
  // @migration-raw-exempt: drop_constraint_if_exists
  await knex.raw('ALTER TABLE clinical_notes DROP CONSTRAINT IF EXISTS clinical_notes_consent_id_fk');
  // @migration-raw-exempt: idempotency_guard
  await knex.raw('DROP INDEX IF EXISTS clinical_notes_consent_id_idx');
  await knex.schema.alterTable('clinical_notes', (t) => {
    t.dropColumn('consent_id');
  });
}
