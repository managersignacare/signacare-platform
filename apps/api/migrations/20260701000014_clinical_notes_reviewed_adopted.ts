import { Knex } from 'knex';

/**
 * Audit Tier 5.8 (HIGH-G1) — cross-clinician scribe signing safeguard.
 *
 * Before: clinician A could sign a scribe-generated note that was
 * dictated by clinician B. The signer's clinical accountability was
 * implicit (via signed_by_id) but no explicit "I have reviewed and
 * adopted this note" attestation was recorded, and no guardrail
 * blocked the cross-clinician signing path.
 *
 * Fix: add `reviewed_and_adopted_by_id` + `reviewed_and_adopted_at`.
 * The service layer (Tier 5.8 code change) enforces: if the note's
 * author_id is different from the signer's staff_id, BOTH fields must
 * be set via an explicit "Review and adopt" UI flow before signing
 * is accepted.
 *
 * When author_id == signer, the fields stay NULL (no cross-signing).
 *
 * Columns:
 *   reviewed_and_adopted_by_id  uuid  FK staff  NULLABLE
 *   reviewed_and_adopted_at     timestamptz     NULLABLE
 *
 * Index on reviewed_and_adopted_by_id per §7.1 — used for audit queries
 * ("show me every note X has cross-adopted in the last 90 days").
 *
 * Reversible: down() drops the index + columns. Existing notes keep
 * their signed_by_id / signed_at — that data is not dropped.
 */
export async function up(knex: Knex): Promise<void> {
  await knex.schema.alterTable('clinical_notes', (t) => {
    t.uuid('reviewed_and_adopted_by_id')
      .nullable()
      .references('id').inTable('staff').onDelete('SET NULL');
    t.timestamp('reviewed_and_adopted_at', { useTz: true }).nullable();
    t.index(['reviewed_and_adopted_by_id'], 'idx_clinical_notes_reviewed_adopted_by');
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.alterTable('clinical_notes', (t) => {
    t.dropIndex(['reviewed_and_adopted_by_id'], 'idx_clinical_notes_reviewed_adopted_by');
    t.dropColumn('reviewed_and_adopted_at');
    t.dropColumn('reviewed_and_adopted_by_id');
  });
}
