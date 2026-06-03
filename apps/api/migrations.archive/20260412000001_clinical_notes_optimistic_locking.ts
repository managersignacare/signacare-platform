import type { Knex } from 'knex';

/**
 * HAZARD-006 — optimistic locking on clinical_notes.
 *
 * Adds an integer `lock_version` column to `clinical_notes` that
 * increments on every UPDATE. The service-layer update path reads
 * the row's current lock_version and the client's If-Match header
 * (or request-body version field), then issues:
 *
 *   UPDATE clinical_notes
 *      SET ..., lock_version = lock_version + 1, updated_at = now()
 *    WHERE id = $1 AND clinic_id = $2 AND lock_version = $clientVersion
 *    RETURNING *
 *
 * If zero rows are updated, the client's version was stale — the
 * note was modified by another clinician between the GET and the
 * PATCH. The service throws 409 CONFLICT and the client must GET
 * the fresh row, reconcile the diff, and retry.
 *
 * Without this, two simultaneous clinicians editing the same note
 * last-write-wins: one clinician's edit silently overwrites the
 * other's, losing clinical content with zero audit trail.
 *
 * Schema:
 *   - lock_version  integer NOT NULL DEFAULT 1
 *   - Existing rows start at 1 (new rows also start at 1)
 *
 * Append-only migration with hasColumn guard. Down is a no-op
 * (clinical_notes versioning history must be preserved once
 * optimistic locking is enabled; backing out mid-production
 * would make in-flight conflict detection silently no-op).
 *
 * Standard satisfied: RFC 7232 (If-Match), OWASP ASVS §11.2.1,
 *                     IEC 62304 HAZARD-006 control, ACHS Standard 1.
 */

export async function up(knex: Knex): Promise<void> {
  if (!(await knex.schema.hasColumn('clinical_notes', 'lock_version'))) {
    await knex.schema.alterTable('clinical_notes', (t) => {
      t.integer('lock_version').notNullable().defaultTo(1);
    });
  }
  // Index so the WHERE id = ? AND lock_version = ? predicate is
  // cheap even on heavy tables. The id column already has a PK
  // index so a composite isn't required — a single scan on id
  // already finds the row in O(1). Leaving as a note for future
  // tuning if the MVCC contention pattern changes.
}

export async function down(): Promise<void> {
  // No-op. Dropping the column mid-production would silently
  // disable conflict detection and allow last-write-wins
  // corruption for the rollback window. Schema changes to
  // lock_version are append-only.
}
