// apps/api/scripts/generate-schema-snapshot.ts
//
// Regenerate apps/api/src/db/schema-snapshot.json from the live database
// after every migration. The snapshot is the source of truth for the
// check-row-interface-matches-db.ts CI guard: the guard runs without a DB
// connection and compares every `export interface X(Row|Db)` against the
// snapshot's column list for the table X is bound to via
// `db<X>('<table>')`.
//
// Why a snapshot: CI jobs that don't spin up Postgres (lint, typecheck,
// guards) can still enforce the rule. The integration-test job runs a
// live check against Postgres as a second line of defence.
//
// Usage:
//   npm run db:snapshot
//
// The script connects using the standard DB env vars (same as
// `migrate:latest`) and writes a deterministic JSON file with tables +
// columns sorted alphabetically so the diff is small and reviewable.

import { db } from '../src/db/db';
import { writeFileSync } from 'fs';
import { resolve } from 'path';

interface ColumnRow {
  table_name: string;
  column_name: string;
  ordinal_position: number;
}

// BUG-637 — FK metadata captured for the FK-aware join lint guard.
// Every `medication_administrations.patient_medication_id REFERENCES
// patient_medications(id)` style relationship lands here so the guard
// can validate Knex `.innerJoin(...)`/`.leftJoin(...)` calls and raw
// SQL `JOIN ... ON ...` patterns against the canonical FK target.
interface ForeignKeyRow {
  local_table: string;
  local_column: string;
  foreign_table: string;
  foreign_column: string;
}

interface SchemaSnapshot {
  generatedAt: string;
  // Full ISO-8601 timestamp of the most-recent regen. Written even when the
  // table content is otherwise unchanged, so every `npm run db:snapshot`
  // produces a git-visible diff. Required for the snapshot-freshness guard
  // (Phase R) to distinguish "operator re-ran the generator after a
  // comment-only migration change" from "operator forgot to regen".
  generatedAtIso: string;
  database: string;
  tables: Record<string, string[]>;
  // BUG-637 — FK relationships keyed by `localTable.localColumn` →
  // `{ foreignTable, foreignColumn }`. Structure preserved as a flat
  // map (not nested) so consumers can lookup `fkByLocalColumn['ma.patient_medication_id']`
  // in O(1). Sorted alphabetically for deterministic JSON diff.
  foreignKeys: Record<string, { foreignTable: string; foreignColumn: string }>;
}

async function main(): Promise<void> {
  // List every public-schema table with its columns (stable order).
  const rows = (await db
    .withSchema('information_schema')
    .from('columns')
    .where({ table_schema: 'public' })
    .orderBy(['table_name', 'ordinal_position'])
    .select('table_name', 'column_name', 'ordinal_position')) as ColumnRow[];

  const tables: Record<string, string[]> = {};
  for (const r of rows) {
    if (!tables[r.table_name]) tables[r.table_name] = [];
    tables[r.table_name].push(r.column_name);
  }

  // Sort tables by name so the JSON is deterministic.
  const sortedTables: Record<string, string[]> = {};
  for (const name of Object.keys(tables).sort()) {
    sortedTables[name] = tables[name];
  }

  // BUG-637 — extract FK relationships for the FK-aware join lint guard.
  // Postgres `pg_constraint` is used (not `information_schema.constraint_column_usage`)
  // because the latter requires constraint ownership for visibility — `app_user`
  // sees 0 rows there. `pg_constraint` is readable by any role with USAGE on the
  // public schema. The pg_attribute lookups resolve the column-array indexes
  // (`conkey`/`confkey`) to actual column names. Single-column FKs are the
  // common case; composite FKs are joined into a comma-separated string and
  // skipped by the guard (out of scope; rare in this schema).
  const fkRows = (await db.raw(`
    SELECT
      conrelid::regclass::text AS local_table,
      ARRAY_TO_STRING(ARRAY(
        SELECT a.attname FROM pg_attribute a
        WHERE a.attrelid = conrelid AND a.attnum = ANY(conkey) ORDER BY a.attnum
      ), ',') AS local_column,
      confrelid::regclass::text AS foreign_table,
      ARRAY_TO_STRING(ARRAY(
        SELECT a.attname FROM pg_attribute a
        WHERE a.attrelid = confrelid AND a.attnum = ANY(confkey) ORDER BY a.attnum
      ), ',') AS foreign_column
    FROM pg_constraint
    WHERE contype = 'f'
      AND connamespace = 'public'::regnamespace
    ORDER BY local_table, local_column
  `)).rows as ForeignKeyRow[];

  const sortedFks: Record<string, { foreignTable: string; foreignColumn: string }> = {};
  for (const fk of fkRows) {
    sortedFks[`${fk.local_table}.${fk.local_column}`] = {
      foreignTable: fk.foreign_table,
      foreignColumn: fk.foreign_column,
    };
  }

  const dbNameRow = (await db.raw('SELECT current_database() AS name')).rows[0] as { name: string };

  const now = new Date();
  const snapshot: SchemaSnapshot = {
    generatedAt: now.toISOString().split('T')[0], // date only — reviewer-friendly
    generatedAtIso: now.toISOString(), // full timestamp — guarantees git-visible diff per regen
    database: dbNameRow.name,
    tables: sortedTables,
    foreignKeys: sortedFks,
  };

  const outPath = resolve(__dirname, '..', 'src', 'db', 'schema-snapshot.json');
  writeFileSync(outPath, JSON.stringify(snapshot, null, 2) + '\n');
  // eslint-disable-next-line no-console
  console.log(`Schema snapshot written: ${outPath}`);
  // eslint-disable-next-line no-console
  console.log(`  Database: ${snapshot.database}`);
  // eslint-disable-next-line no-console
  console.log(`  Tables:   ${Object.keys(sortedTables).length}`);
  // eslint-disable-next-line no-console
  console.log(`  Columns:  ${rows.length}`);
  // eslint-disable-next-line no-console
  console.log(`  FKs:      ${Object.keys(sortedFks).length}`);

  await db.destroy();
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error('Snapshot generation failed:', err);
  process.exit(1);
});
