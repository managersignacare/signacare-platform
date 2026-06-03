/**
 * Phase 0.7.1 Commit 3 — Enforce NOT NULL on critical FK columns.
 *
 * message_threads.patient_id and referrals.patient_id are always
 * patient-scoped — there's no legitimate case for a NULL value.
 * CLAUDE.md §7.3 requires patient_id to be NOT NULL on every
 * patient-scoped table.
 *
 * audit_log.clinic_id stays NULLABLE — system-level events (backups,
 * migrations, config changes) run outside a clinic context and the
 * v2 baseline migration intentionally made it nullable with ON DELETE
 * SET NULL.
 */
import type { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  await knex.schema.alterTable('message_threads', (t) => {
    t.uuid('patient_id').notNullable().alter();
  });
  await knex.schema.alterTable('referrals', (t) => {
    t.uuid('patient_id').notNullable().alter();
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.alterTable('message_threads', (t) => {
    t.uuid('patient_id').nullable().alter();
  });
  await knex.schema.alterTable('referrals', (t) => {
    t.uuid('patient_id').nullable().alter();
  });
}
