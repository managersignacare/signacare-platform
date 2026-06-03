/**
 * Phase 0.7.5 c24 C5 — separate patient team reallocation workflow from
 * the assignment row itself.
 *
 * Background: the reallocationService code has always stored reallocation
 * workflow state (referral_status, referred_by_id, reviewed_by_id,
 * reviewed_at, rejection_reason) as extra fields on
 * `patient_team_assignments`, but those columns were never added to the
 * schema. Every request/approve/reject call crashed at runtime (SD14).
 *
 * The fix splits the concepts:
 *   - `patient_team_assignments` stays the "current active team for this
 *     patient" table — immutable from this migration's perspective.
 *   - `patient_team_reallocations` (NEW) carries the workflow lifecycle:
 *     who requested a move, who approved/rejected it, why.
 *
 * Approve path (executed by reallocationService.approve — see the c5
 * code change in the same commit):
 *   1. Flip existing active assignment rows (patient + clinic) to
 *      is_active=false.
 *   2. Upsert an active assignment row with the target org unit and
 *      primary clinician (same semantics as before).
 *   3. Update the reallocation row: status='active', reviewed_by_id,
 *      reviewed_at.
 *
 * Reject path just updates the reallocation row with status='rejected',
 * rejection_reason, reviewed_by_id, reviewed_at — no change to
 * patient_team_assignments.
 *
 * RLS + indexes per CLAUDE.md §6.3 + §9.3.
 */
import type { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  const exists = await knex.schema.hasTable('patient_team_reallocations');
  if (exists) return;

  await knex.schema.createTable('patient_team_reallocations', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.uuid('clinic_id').notNullable().references('id').inTable('clinics').onDelete('RESTRICT');
    t.uuid('patient_id').notNullable().references('id').inTable('patients').onDelete('CASCADE');

    // Target team + clinician the request wants to move the patient to.
    t.uuid('to_org_unit_id').notNullable().references('id').inTable('org_units').onDelete('RESTRICT');
    t.uuid('to_primary_clinician_id').nullable().references('id').inTable('staff').onDelete('SET NULL');

    // Optional snapshot of the current team at request time so audits
    // can still show "from → to" even if the assignment moves again.
    t.uuid('from_org_unit_id').nullable().references('id').inTable('org_units').onDelete('SET NULL');

    // Workflow lifecycle — matches the codes the service writes today.
    t.string('status', 30).notNullable().defaultTo('pending_approval');

    // Who requested, who reviewed (approved or rejected), with timestamps
    // and optional rejection reason text. referred_by_id NOT NULL —
    // every request must have an identified requester for the four-eyes
    // check the service enforces (can't self-approve).
    t.uuid('referred_by_id').notNullable().references('id').inTable('staff').onDelete('RESTRICT');
    t.uuid('reviewed_by_id').nullable().references('id').inTable('staff').onDelete('SET NULL');
    t.timestamp('reviewed_at', { useTz: true }).nullable();
    t.text('reason').nullable();
    t.text('rejection_reason').nullable();

    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());

    // At most one pending reallocation per (patient, clinic) at any
    // time — enforced with a partial unique index instead of a full
    // UNIQUE constraint so completed rejected/approved rows don't
    // block new requests.
    t.index(['clinic_id']);
    t.index(['patient_id']);
    t.index(['clinic_id', 'status']);
  });

  await knex.raw(`
    CREATE UNIQUE INDEX uq_patient_team_reallocations_one_pending
      ON patient_team_reallocations (clinic_id, patient_id)
      WHERE status = 'pending_approval';
  `);

  // updated_at trigger — match the pattern used by other tables.
  await knex.raw(`
    CREATE TRIGGER trg_patient_team_reallocations_updated_at
      BEFORE UPDATE ON patient_team_reallocations
      FOR EACH ROW EXECUTE FUNCTION set_updated_at();
  `);

  // RLS
  await knex.raw('ALTER TABLE patient_team_reallocations ENABLE ROW LEVEL SECURITY');
  await knex.raw(`
    CREATE POLICY rls_patient_team_reallocations_tenant
      ON patient_team_reallocations
      FOR ALL
      USING (clinic_id = NULLIF(current_setting('app.clinic_id', true), '')::uuid)
      WITH CHECK (clinic_id = NULLIF(current_setting('app.clinic_id', true), '')::uuid);
  `);
}

export async function down(knex: Knex): Promise<void> {
  await knex.raw('DROP TABLE IF EXISTS patient_team_reallocations CASCADE');
}
