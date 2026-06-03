import { Knex } from 'knex';

/**
 * Audit Tier 2.1 — Amendment E closeout for patient_team_assignments.
 *
 * Adds the escalation-link columns that the escalation controller +
 * routes have been writing under `@code-columns-exempt` for weeks:
 *
 *   - `referred_by_id uuid FK staff ON DELETE SET NULL`
 *     — the staff member who raised the escalation/transfer.
 *   - `escalation_id uuid FK escalations ON DELETE SET NULL`
 *     — link back to the escalations row that created the PTA. Keeps
 *       audit trail even after the escalation is soft-deleted.
 *   - `rejection_reason text NULL`
 *     — surfaced to the requesting clinician on a rejected transfer;
 *       written by `/escalations/:id/reject-transfer`.
 *   - `idx_patient_team_assignments_escalation_id` on escalation_id,
 *     per §7.1 (every FK column indexed).
 *
 * After this migration lands, the code in escalation.controller.ts:62,
 * escalation.controller.ts:72, and escalation.routes.ts:128 stops
 * needing `@code-columns-exempt` annotations. Those are removed in
 * Tier 2.4 / 2.5 of the same plan.
 *
 * `patient_team_assignments` does NOT have a `clinic_id` column (tenant
 * scoping is via patient_id → patients.clinic_id). The R3C intent is
 * to keep PTA narrow; Tier 2.3 removes the ghost `clinic_id` write in
 * episodeRoutes.ts that Postgres was silently dropping. Nothing in this
 * migration re-adds it.
 *
 * Reversible: down() drops the index and the three columns. Data loss
 * is confined to escalation metadata on existing rows — acceptable for
 * a local rollback since no production data depends on the columns
 * outside of the same commit cycle.
 *
 * 13-point audit: #8 DB (reversible, indexed), #10 API design (the
 * service-layer contract is now materialised), #12 Regression (the
 * exemptions that shielded ghost writes are resolved, not silenced).
 */
export async function up(knex: Knex): Promise<void> {
  await knex.schema.alterTable('patient_team_assignments', (t) => {
    t.uuid('referred_by_id').nullable().references('id').inTable('staff').onDelete('SET NULL');
    t.uuid('escalation_id').nullable().references('id').inTable('escalations').onDelete('SET NULL');
    t.text('rejection_reason').nullable();
    t.index(['escalation_id'], 'idx_patient_team_assignments_escalation_id');
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.alterTable('patient_team_assignments', (t) => {
    t.dropIndex(['escalation_id'], 'idx_patient_team_assignments_escalation_id');
    t.dropColumn('rejection_reason');
    t.dropColumn('escalation_id');
    t.dropColumn('referred_by_id');
  });
}
