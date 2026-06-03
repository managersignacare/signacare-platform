/*
 * apps/api/migrations/20260701000040_pr_r1_13_drain_add_escalation_fields_to_structured_observations.ts
 *
 * PR-R1-13 DRAIN — Add `escalation_required` + `escalation_notes`
 * columns to `structured_observations`.
 *
 * Discovered by check-knex-column-references guard (PR-R1-13). The
 * `nurseFeatureRoutes.ts:424` shift-handover query filters
 * `where('escalation_required', true)` — but the column doesn't exist.
 * Currently the filter returns 0 rows always, so the shift-handover
 * auto-summary NEVER displays escalated observations. Clinical-safety
 * implication: nurses miss escalation context every shift.
 *
 * Per audit-20260418.md SD56, this column was flagged as planned but
 * never migrated. THIS migration is the fix.
 *
 * Columns added:
 *   - escalation_required BOOLEAN NOT NULL DEFAULT false
 *     (defaults to false so existing rows are unaffected; clinicians
 *      flag observations needing handover escalation by setting true)
 *   - escalation_notes TEXT (nullable; free-text rationale for the flag)
 *
 * Builder-first per CLAUDE.md §12.1. No raw SQL needed — schema-builder
 * fully expresses ADD COLUMN with default.
 *
 * Down() is REVERSIBLE per §12.4 — drops both columns. Acceptable since
 * pre-this-migration the columns didn't exist; rollback restores the
 * pre-migration state.
 *
 * R-FIX-PR-R1-13-DRAIN-STRUCTURED-OBSERVATIONS-MIGRATION
 */

import type { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  const hasEscRequired = await knex.schema.hasColumn(
    'structured_observations',
    'escalation_required',
  );
  const hasEscNotes = await knex.schema.hasColumn('structured_observations', 'escalation_notes');

  if (!hasEscRequired || !hasEscNotes) {
    await knex.schema.alterTable('structured_observations', (t) => {
      if (!hasEscRequired) {
        t.boolean('escalation_required').notNullable().defaultTo(false);
      }
      if (!hasEscNotes) {
        t.text('escalation_notes').nullable();
      }
    });
  }

  // Index on escalation_required for the shift-handover query
  // (`WHERE clinic_id = ? AND escalation_required = true AND observed_at >= ?`).
  // Partial index (only on rows where flag is true) — small index size,
  // efficient for the typical query shape.
  // @migration-raw-exempt: index_partial
  await knex.raw(`
    CREATE INDEX IF NOT EXISTS idx_structured_observations_escalation
      ON structured_observations (clinic_id, observed_at DESC)
      WHERE escalation_required = true
  `);
}

export async function down(knex: Knex): Promise<void> {
  // @migration-raw-exempt: idempotency_guard
  await knex.raw(`DROP INDEX IF EXISTS idx_structured_observations_escalation`);
  await knex.schema.alterTable('structured_observations', (t) => {
    t.dropColumn('escalation_notes');
    t.dropColumn('escalation_required');
  });
}
