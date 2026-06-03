/**
 * Ledger-only wrapper — the actual SQL (../src/db/execSqlMigration
20260331_audit_log_tamper_protection.sql)
 * is executed by the pre-migration step in scripts/migrate.ts
 * via a standalone pg Client, BEFORE Knex runs the migration
 * batch. This .ts file exists solely to register in
 * knex_migrations so the ledger stays consistent.
 */
import type { Knex } from 'knex';
export async function up(_knex: Knex): Promise<void> { /* SQL ran in pre-migration step */ }
export async function down(_knex: Knex): Promise<void> { /* no-op */ }
