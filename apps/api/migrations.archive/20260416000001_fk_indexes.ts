/**
 * Phase 0.7.1 Commit 3 — Add missing indexes on foreign key columns.
 *
 * The deep audit found 181 FK columns without covering indexes,
 * causing full table scans on JOINs (CLAUDE.md §7.1). This migration
 * programmatically discovers every FK constraint, checks for an
 * existing index, and creates one where missing.
 *
 * Uses CREATE INDEX IF NOT EXISTS for idempotency — safe to re-run.
 */
import type { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  // Discover all FK columns missing indexes in one query.
  const rows = await knex.raw(`
    SELECT
      tc.table_name,
      kcu.column_name
    FROM information_schema.table_constraints tc
    JOIN information_schema.key_column_usage kcu
      ON tc.constraint_name = kcu.constraint_name
      AND tc.table_schema = kcu.table_schema
    WHERE tc.constraint_type = 'FOREIGN KEY'
      AND tc.table_schema = 'public'
      AND NOT EXISTS (
        SELECT 1 FROM pg_indexes pi
        WHERE pi.schemaname = 'public'
          AND pi.tablename = tc.table_name
          AND pi.indexdef LIKE '%' || kcu.column_name || '%'
      )
    ORDER BY tc.table_name, kcu.column_name
  `);

  const missing: Array<{ table_name: string; column_name: string }> = rows.rows ?? [];

  for (const { table_name, column_name } of missing) {
    const idxName = `idx_${table_name}_${column_name}`.slice(0, 63);
    await knex.raw(`CREATE INDEX IF NOT EXISTS ?? ON ?? (??)`, [
      idxName,
      table_name,
      column_name,
    ]);
  }
}

export async function down(_knex: Knex): Promise<void> {
  // Dropping indexes is safe but unhelpful — the indexes only help
  // performance. A rollback would leave the schema functional but
  // slower. Use nuclear reseed if a full rollback is needed.
}
