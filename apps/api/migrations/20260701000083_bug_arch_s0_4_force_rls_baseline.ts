import { Knex } from 'knex';

/**
 * BUG-ARCH-FORCE-RLS-BASELINE
 *
 * Enforce FORCE ROW LEVEL SECURITY on every public base table that already
 * has RLS enabled. This removes the implicit owner bypass pathway and makes
 * policy posture explicit at the table boundary.
 *
 * NOTE:
 * - FORCE RLS is ineffective if the active DB role has BYPASSRLS.
 * - Production readiness therefore also requires DBA posture: the runtime
 *   owner role used by app/admin pools must be NOBYPASSRLS.
 */

type RlsTableRow = { table_name: string };

async function listRlsTables(knex: Knex): Promise<string[]> {
  const result = (await knex.raw(`
    SELECT c.relname AS table_name
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relkind = 'r'
      AND c.relrowsecurity = true
    ORDER BY c.relname
  `)) as { rows: RlsTableRow[] };
  return result.rows.map((r: RlsTableRow) => r.table_name);
}

export async function up(knex: Knex): Promise<void> {
  const tables = await listRlsTables(knex);

  for (const tableName of tables) {
    // @migration-raw-exempt: rls_policy
    await knex.raw('ALTER TABLE ?? FORCE ROW LEVEL SECURITY', [tableName]);
  }
}

export async function down(knex: Knex): Promise<void> {
  const tables = await listRlsTables(knex);

  for (const tableName of tables) {
    // @migration-raw-exempt: rls_policy
    await knex.raw('ALTER TABLE ?? NO FORCE ROW LEVEL SECURITY', [tableName]);
  }
}
