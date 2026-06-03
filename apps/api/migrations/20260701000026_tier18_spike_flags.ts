import { Knex } from 'knex';

/**
 * Audit Tier 18 — seed 4 disabled feature flags for the
 * collaboration / multi-signature / agentic sequencing / patient
 * redaction spikes.
 *
 * Same pattern as Tier 14: each spike is deferred for a structural
 * reason documented in `docs/audit-2026-04-19/tier-18-spikes.md`.
 * Flags are pre-registered so product code can reference them today;
 * flipping a flag without meeting its documented exit criteria is a
 * merge-gate violation.
 */
const TIER18_SPIKE_FLAGS = [
  {
    name: 'letters-concurrent-collaboration',
    description: 'Two clinicians editing the same letter concurrently with operational-transform merge. DEFERRED — CRDT library choice + conflict UX TBD.',
  },
  {
    name: 'letters-multi-signature',
    description: 'Multi-party signing (treating + consultant + approving supervisor). DEFERRED — crypto signing chain + revocation flow need legal review.',
  },
  {
    name: 'scribe-agentic-sequencing',
    description: 'Scribe auto-sequences downstream EHR writes (referral → letter → task → follow-up) in one accept step. DEFERRED — see tier-14 scribe-agentic-workflows; gated on same preconditions.',
  },
  {
    name: 'scribe-patient-attended-redaction',
    description: 'Live redaction of transcript while patient watches (consent + trust surface). DEFERRED — UX research + clinical-safety review required.',
  },
];

export async function up(knex: Knex): Promise<void> {
  for (const { name, description } of TIER18_SPIKE_FLAGS) {
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
  for (const { name } of TIER18_SPIKE_FLAGS) {
    await knex('feature_flags').whereNull('clinic_id').where({ name }).delete();
  }
}
