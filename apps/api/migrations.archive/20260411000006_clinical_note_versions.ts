import type { Knex } from 'knex';

/**
 * S5.4 — Clinical note revision history
 *
 * Adds clinical_note_versions, an append-only ledger of every state
 * a clinical note has been in across its lifecycle: each UPDATE
 * inserts a row with the PREVIOUS state before the new value lands.
 *
 * Why a separate table instead of jsonb history on the parent row:
 *   - Append-only design forces immutability — can't be edited after
 *     the fact, which is what makes it useful for medico-legal review.
 *   - Each row has its own edited_by + edited_at columns so the
 *     audit query is "who changed this note when?" without parsing
 *     a JSON blob.
 *   - Per-version FK to staff is queryable.
 *
 * snapshot is jsonb for forward-compat: clinical_notes columns evolve,
 * but the version log doesn't need to track the schema. It just stores
 * whatever existed.
 *
 * RLS: clinic_id is denormalised from the parent note for fast filter
 * + future RLS policy. The service layer always sets clinic_id from
 * req.clinicId at write time (never from the parent row, defensively).
 *
 * Append-only with hasTable guards. Down is a no-op.
 */

export async function up(knex: Knex): Promise<void> {
  if (!(await knex.schema.hasTable('clinical_note_versions'))) {
    await knex.schema.createTable('clinical_note_versions', (t) => {
      t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
      t.uuid('note_id').notNullable();
      t.uuid('clinic_id').notNullable(); // denormalised from parent
      // Monotonic per-note version number. The service layer sets this
      // to MAX(version_number) + 1 inside the same transaction as the
      // update so concurrent edits don't collide.
      t.integer('version_number').notNullable();
      // Full row snapshot at the time of edit (JSONB so the schema
      // can evolve without rewriting old rows).
      t.jsonb('snapshot').notNullable();
      t.uuid('edited_by_staff_id').notNullable();
      t.timestamp('edited_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
      // Optional reason text for audit panes — defaults null but
      // future UI can require it for amended notes.
      t.text('edit_reason').nullable();
      // Snapshot of status at the time so a quick scan can answer
      // "when did this transition from draft to signed?"
      t.string('status_at_snapshot', 30).nullable();

      t.unique(['note_id', 'version_number']);
      t.index(['note_id', 'edited_at']);
      t.index(['clinic_id']);
    });
  }
}

export async function down(): Promise<void> {
  // No-op. Revision history is operational evidence — never dropped.
}
