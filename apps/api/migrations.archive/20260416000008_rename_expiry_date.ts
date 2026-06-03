/**
 * Phase 0.7.2 #32 — Standardize temporal column naming.
 * 4 tables use `expiry_date` while 10 use `expires_at`.
 * Rename the 4 to match the majority convention.
 */
import type { Knex } from 'knex';

const RENAMES = [
  { table: 'lai_given', from: 'expiry_date', to: 'expires_at' },
  { table: 'legal_orders', from: 'expiry_date', to: 'expires_at' },
  { table: 'prescriptions', from: 'expiry_date', to: 'expires_at' },
  { table: 'referral_validity', from: 'expiry_date', to: 'expires_at' },
];

export async function up(knex: Knex): Promise<void> {
  for (const { table, from, to } of RENAMES) {
    if (!(await knex.schema.hasTable(table))) continue;
    if (!(await knex.schema.hasColumn(table, from))) continue;
    if (await knex.schema.hasColumn(table, to)) continue;
    await knex.schema.alterTable(table, (t) => t.renameColumn(from, to));
  }
}

export async function down(knex: Knex): Promise<void> {
  for (const { table, from, to } of RENAMES) {
    if (!(await knex.schema.hasTable(table))) continue;
    if (!(await knex.schema.hasColumn(table, to))) continue;
    await knex.schema.alterTable(table, (t) => t.renameColumn(to, from));
  }
}
