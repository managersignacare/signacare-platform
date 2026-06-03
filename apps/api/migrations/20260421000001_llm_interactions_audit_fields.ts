// apps/api/migrations/20260421000001_llm_interactions_audit_fields.ts
//
// BUG-037 — add forensic-audit fields to llm_interactions so AI-assisted
// clinical outputs can be reproduced post-hoc:
//   - model_version : immutable digest preferred; tag-fallback accepted.
//   - temperature   : requested value (Ollama does not echo actual).
//   - pipeline      : ordered JSONB array of {stage, startedAt, durationMs,
//                     success, meta?} capturing which processing stages ran.
//
// All three nullable — no retrospective backfill (historical digests not
// knowable; NULL is honest).
//
// CHECK constraint: temperature ∈ [0, 2]. Range documented as Ollama-
// appropriate; review if a non-Ollama provider with a different temperature
// scale is integrated (BUG-037 plan §9 residual risk).
//
// Standard: HIPAA 164.312(b) audit controls; APP 11.1 security; TGA
// non-device evidence log.

import { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  await knex.schema.alterTable('llm_interactions', (t) => {
    t.text('model_version');
    t.decimal('temperature', 5, 3);
    t.jsonb('pipeline');
  });

  // @migration-raw-exempt: check_constraint
  await knex.raw(`
    ALTER TABLE llm_interactions
      ADD CONSTRAINT llm_interactions_temperature_range_check
      CHECK (temperature IS NULL OR (temperature >= 0 AND temperature <= 2))
  `);
}

export async function down(knex: Knex): Promise<void> {
  // @migration-raw-exempt: drop_constraint_if_exists
  await knex.raw(
    'ALTER TABLE llm_interactions DROP CONSTRAINT IF EXISTS llm_interactions_temperature_range_check',
  );
  await knex.schema.alterTable('llm_interactions', (t) => {
    t.dropColumn('pipeline');
    t.dropColumn('temperature');
    t.dropColumn('model_version');
  });
}
