import { Knex } from 'knex';

/**
 * Audit Tier 14 — seed 4 disabled feature flags for the R&D spikes
 * that aren't ready for implementation.
 *
 * These are NOT TODOs. Each spike is deferred for a specific
 * structural reason documented in
 * `docs/audit-2026-04-19/tier-14-spikes.md`:
 *
 *   - scribe-multimodal-vision — requires a vetted multimodal LLM
 *     deployment strategy (VRAM budget, hosting cost) that belongs
 *     on the infrastructure roadmap, not this release.
 *   - scribe-agentic-workflows — pending Anthropic MCP + tool-use
 *     protocol stabilisation + a clinical-safety review of what
 *     autonomous EHR writes are acceptable.
 *   - scribe-audio-fingerprint-consent — biometric consent shape is
 *     still ethics-committee-dependent; privacy-by-design review not
 *     complete.
 *   - scribe-patient-redaction — NLP redaction of third-party names
 *     / IDs requires a clinically reviewed redaction policy.
 *
 * Seeding the flags now means:
 *   (a) product code can reference the flag names today
 *       (requireFeatureEnabled('scribe-multimodal-vision')) so the
 *       enable path is mechanical — flip the flag, re-deploy,
 *       re-test,
 *   (b) admin UIs don't race-condition on "unknown flag",
 *   (c) the fix-registry row R-FIX-TIER-14-SPIKE-FLAGS verifies the
 *       flags stay in-place until the spike lands.
 *
 * Default: DISABLED. Enabling requires the spike's exit criteria
 * (see tier-14-spikes.md) to be met.
 */
const SPIKE_FLAGS = [
  {
    name: 'scribe-multimodal-vision',
    description: 'Multimodal (image + audio) scribe input. DEFERRED — infra cost / VRAM spike required.',
  },
  {
    name: 'scribe-agentic-workflows',
    description: 'Autonomous scribe-to-EHR writes via MCP tool-use. DEFERRED — protocol stabilisation + clinical-safety review.',
  },
  {
    name: 'scribe-audio-fingerprint-consent',
    description: 'Voice-biometric consent capture. DEFERRED — ethics committee + privacy-by-design review.',
  },
  {
    name: 'scribe-patient-redaction',
    description: 'Auto-redact third-party names / IDs from transcripts. DEFERRED — clinical redaction policy TBD.',
  },
];

export async function up(knex: Knex): Promise<void> {
  for (const { name, description } of SPIKE_FLAGS) {
    // @migration-raw-exempt: data_backfill_insert
    await knex.raw(
      `INSERT INTO feature_flags (clinic_id, name, description, enabled, rollout_percentage)
       SELECT NULL, ?, ?, false, 0
       WHERE NOT EXISTS (
         SELECT 1 FROM feature_flags WHERE clinic_id IS NULL AND name = ?
       )`,
      [name, description, name],
    );
  }
}

export async function down(knex: Knex): Promise<void> {
  for (const { name } of SPIKE_FLAGS) {
    await knex('feature_flags').whereNull('clinic_id').where({ name }).delete();
  }
}
