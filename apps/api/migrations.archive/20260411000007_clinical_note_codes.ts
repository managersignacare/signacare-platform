import type { Knex } from 'knex';

/**
 * S5.6 — ICD-10 / SNOMED-CT clinical note codes
 *
 * Persists code suggestions emitted by the scribe pipeline (the
 * regex-based autoCodeICD10 function in scribeEnhancements.ts, plus
 * any future LLM-based or terminology-server-based coders) so:
 *
 *   - clinicians can accept / reject each suggestion individually
 *   - billing / coding teams have an audit trail of who decided what
 *   - the same note can carry multiple coding systems (ICD-10-AM,
 *     SNOMED-CT, MBS) without schema changes
 *
 * Coding system is a free string column rather than an enum so the
 * future S5.7 SNOMED-CT integration can write rows without a schema
 * migration.
 *
 * Lifecycle:
 *   - scribe pipeline INSERTs rows with status='suggested'
 *   - clinician UI calls PATCH /clinical-notes/:id/codes/:codeId
 *     with status='accepted' or 'rejected' (the controller writes
 *     accepted_by_id + accepted_at on accept)
 *   - billing extract reads status='accepted' rows
 *
 * RLS-eligible: clinic_id is denormalised from the parent note. The
 * service layer always sets clinic_id from req.clinicId (never from
 * the parent row) for defence in depth.
 *
 * Append-only with hasTable guards. Down is a no-op.
 */

export async function up(knex: Knex): Promise<void> {
  if (!(await knex.schema.hasTable('clinical_note_codes'))) {
    await knex.schema.createTable('clinical_note_codes', (t) => {
      t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
      t.uuid('note_id').notNullable();
      t.uuid('clinic_id').notNullable(); // denormalised from parent
      // Coding system: 'icd-10-am' | 'snomed-ct' | 'mbs' | future
      t.string('system', 32).notNullable();
      t.string('code', 64).notNullable();
      t.text('display').notNullable(); // human-readable description
      // 'high' | 'moderate' | 'low' | 'manual'
      t.string('confidence', 16).notNullable().defaultTo('moderate');
      // 'suggested' | 'accepted' | 'rejected' | 'manual'
      t.string('status', 16).notNullable().defaultTo('suggested');
      // Where the suggestion came from: 'regex_v1' | 'llm_pass4_v1' |
      // 'snomed_v1' | 'manual'
      t.string('source', 32).notNullable().defaultTo('regex_v1');
      // Optional excerpt of the assessment fact that triggered the
      // suggestion. Used in the UI tooltip so clinicians can verify.
      t.text('source_excerpt').nullable();
      t.uuid('accepted_by_staff_id').nullable();
      t.timestamp('accepted_at', { useTz: true }).nullable();
      t.uuid('rejected_by_staff_id').nullable();
      t.timestamp('rejected_at', { useTz: true }).nullable();
      t.text('reject_reason').nullable();
      t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
      t.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());

      // Same code can't be suggested twice for the same note in the
      // same coding system; UPSERT shape from the scribe pipeline.
      t.unique(['note_id', 'system', 'code']);
      t.index(['clinic_id']);
      t.index(['note_id', 'status']);
      t.index(['system', 'code']);
    });
  }
}

export async function down(): Promise<void> {
  // No-op. Coding history is operational + billing-relevant.
}
