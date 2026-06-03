import { Knex } from 'knex';

/**
 * Audit Tier 8 — seed 4 new global feature flags for the major
 * missing integrations. Each integration is gated so a clinic admin
 * can enable it once credentials + sandbox access are provisioned;
 * default is DISABLED because these external services require
 * real-world onboarding (HealthLink partner contract, MHR PRODA
 * credentials, Medicare ECLIPSE registration, lab RIS interface
 * agreement) that Signacare cannot auto-configure.
 *
 * Flags:
 *   integration-radiology-hl7   — outbound ORM^O01 + inbound ORU^R01 to RIS
 *   integration-healthlink      — secure-messaging outbound (letters, discharge)
 *   integration-medicare-eclipse — billing claims submission
 *   integration-mhr-docref      — FHIR DocumentReference push to MHR
 *
 * `ai-*` prefix is reserved for AI feature flags (Tier 5.1). These
 * use the `integration-*` prefix to distinguish from AI controls.
 */
const INTEGRATION_FLAGS = [
  { name: 'integration-radiology-hl7', description: 'Radiology RIS HL7 ORM^O01 outbound + ORU^R01 inbound' },
  { name: 'integration-healthlink',    description: 'HealthLink / Argus secure-messaging outbound' },
  { name: 'integration-medicare-eclipse', description: 'Medicare ECLIPSE billing claims submission' },
  { name: 'integration-mhr-docref',    description: 'My Health Record FHIR DocumentReference push' },
];

export async function up(knex: Knex): Promise<void> {
  for (const { name, description } of INTEGRATION_FLAGS) {
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
  for (const { name } of INTEGRATION_FLAGS) {
    await knex('feature_flags').whereNull('clinic_id').where({ name }).delete();
  }
}
