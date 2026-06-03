import { Knex } from 'knex';

/**
 * Phase R follow-up (2026-04-18) — escalation.routes has team-transfer accept
 * and reject endpoints since Phase 0. They write `referral_status`, `reviewed_by_id`,
 * and `reviewed_at` on `patient_team_assignments`. The columns were never added
 * to the R2 baseline, so every accept-transfer and reject-transfer hit
 * `column "referral_status" of relation "patient_team_assignments" does not exist`
 * at runtime. The `@code-columns-exempt` comments in escalation.routes claimed
 * "baseline is the fix" — it wasn't. This migration is the real fix.
 *
 * `team-summary` dashboard also aggregates by referral_status to count
 * pending team referrals; without this column the dashboard returns zeros.
 */
export async function up(knex: Knex): Promise<void> {
  await knex.schema.alterTable('patient_team_assignments', (t) => {
    t.string('referral_status', 40).notNullable().defaultTo('new');
    t.uuid('reviewed_by_id').nullable().references('id').inTable('staff').onDelete('SET NULL');
    t.timestamp('reviewed_at', { useTz: true }).nullable();
    t.index(['org_unit_id', 'referral_status']);
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.alterTable('patient_team_assignments', (t) => {
    t.dropIndex(['org_unit_id', 'referral_status']);
    t.dropColumn('reviewed_at');
    t.dropColumn('reviewed_by_id');
    t.dropColumn('referral_status');
  });
}
