/**
 * Phase 0 emergency (0.5): DB-level lock on signed clinical notes.
 *
 * The service layer checks `if (status === 'signed') throw ...`
 * but a direct SQL query can bypass this and un-sign a note.
 * This CHECK constraint enforces at the database level that a
 * signed note MUST have signed_at and signed_by_id populated —
 * preventing status rollback from 'signed' to 'draft' without
 * clearing the signature fields.
 *
 * Combined with the existing audit_log_tamper_protection (REVOKE
 * UPDATE/DELETE on audit_log from app_user), this makes the
 * medical record integrity enforceable at the Postgres level.
 */
import type { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  // Guard: only add if table exists and constraint doesn't
  if (!(await knex.schema.hasTable('clinical_notes'))) return;

  const existing = await knex.raw(
    `SELECT 1 FROM pg_constraint WHERE conname = 'clinical_notes_signed_integrity'`,
  );
  if ((existing.rows ?? []).length > 0) return;

  await knex.raw(`
    ALTER TABLE clinical_notes
    ADD CONSTRAINT clinical_notes_signed_integrity
    CHECK (
      (status != 'signed')
      OR (status = 'signed' AND signed_at IS NOT NULL AND signed_by_id IS NOT NULL)
    )
  `);
}

export async function down(knex: Knex): Promise<void> {
  await knex.raw(
    `ALTER TABLE clinical_notes DROP CONSTRAINT IF EXISTS clinical_notes_signed_integrity`,
  );
}
