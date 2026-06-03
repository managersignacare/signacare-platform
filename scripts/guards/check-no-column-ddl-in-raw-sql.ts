#!/usr/bin/env tsx
/**
 * scripts/guards/check-no-column-ddl-in-raw-sql.ts
 *
 * Phase 0b.1c — second-line defense guard.
 *
 * RESPONSIBILITY: hard-block column DDL inside `knex.raw(...)` calls in
 * any migration file (excluding the squashed baseline). This is the
 * SECOND independent layer above `check-migration-convention.ts`.
 *
 * Layer 1 (`check-migration-convention.ts`) uses a taxonomy-exemption
 * approach — any raw SQL must carry a `// @migration-raw-exempt: <category>`
 * annotation, where `<category>` constrains the legitimate purposes.
 * Layer 1 has 21 valid categories; `idempotency_guard` is one of them
 * and was used to grandfather a single column-DDL site that the new
 * second-line defense is designed to catch.
 *
 * Layer 2 (this guard): NO exemption mechanism. Column DDL in raw SQL
 * is structurally NEVER the right answer because:
 *   1. The Knex builder fully expresses CREATE TABLE / ADD COLUMN /
 *      DROP COLUMN / ALTER COLUMN / RENAME COLUMN.
 *   2. For Postgres-specific column types (vector, citext, etc.) the
 *      builder's `t.specificType('<col>', '<pg_type>')` is the canonical
 *      escape — STILL inside the builder, so the type generator parses
 *      it.
 *   3. For idempotency, the JS-level pattern is `await
 *      knex.schema.hasColumn(...)` + `knex.schema.alterTable(...)` (see
 *      BUG-371's lock_version migration as the canonical reference).
 *   4. Column DDL inside `knex.raw(...)` is INVISIBLE to the
 *      migration-driven type generator (Phase 0b.1a/b) — the column
 *      doesn't appear in the generated Row interface, so consumer code
 *      that relies on the type either crashes at compile (column
 *      missing) or silently drops the field.
 *
 * Because column DDL is structurally never legitimate in raw SQL, the
 * guard has NO exemption mechanism. If a future case genuinely needs an
 * exemption, the fix is to extend `t.specificType()` or add a JS-level
 * `hasColumn` guard, NOT to allowlist a violation.
 *
 * Scan target: `apps/api/migrations/*.ts` (excluding files annotated
 * `@migration-squashed-baseline`, which are historical consolidated
 * snapshots).
 *
 * permanent: the squashed baseline contains `ALTER TABLE ... ADD COLUMN
 * search_tsv tsvector GENERATED ALWAYS AS (...)` computed columns — a
 * Postgres-native feature with no Knex builder equivalent (no
 * `t.generatedAlwaysAs()`). These cannot be rewritten in builder form;
 * the squashed-baseline exclusion is structurally permanent.
 *
 * Detection: any of these patterns inside any `knex.raw(...)` call:
 *   - `\bCREATE\s+TABLE\b`
 *   - `\bALTER\s+TABLE\b ... \b(ADD|DROP|ALTER|RENAME)\s+COLUMN\b`
 *
 * Exit codes:
 *   0 — clean
 *   1 — at least one violation
 */

import * as fs from 'fs';
import * as path from 'path';
import { REPO_ROOT } from './lib/repoRoot';

const MIGRATIONS_DIR = path.join(REPO_ROOT, 'apps/api/migrations');

interface Violation {
  readonly file: string;
  readonly line: number;
  readonly snippet: string;
  readonly kind: 'CREATE TABLE' | 'ADD COLUMN' | 'DROP COLUMN' | 'ALTER COLUMN' | 'RENAME COLUMN';
}

/**
 * Find each `knex.raw(...)` call in the migration source and return its
 * SQL content + the line number of the call.
 */
export function findRawCalls(source: string): Array<{ sql: string; line: number }> {
  const out: Array<{ sql: string; line: number }> = [];
  // Track line numbers by counting newlines in the source up to each match.
  const re = /knex\.raw\s*\(\s*([`'"])/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(source)) !== null) {
    const quote = m[1];
    const sqlStart = m.index + m[0].length;
    let i = sqlStart;
    let sql = '';
    while (i < source.length) {
      const ch = source[i];
      if (ch === '\\' && i + 1 < source.length) {
        sql += source[i] + source[i + 1];
        i += 2;
        continue;
      }
      if (ch === quote) break;
      sql += ch;
      i++;
    }
    if (i >= source.length) continue; // unterminated — skip
    const line = source.slice(0, m.index).split('\n').length;
    out.push({ sql, line });
  }
  return out;
}

/**
 * Detect column DDL patterns inside a SQL fragment. Returns the matching
 * kind + first 80 chars of the matched substring, or null if clean.
 */
export function detectColumnDdl(sql: string): { kind: Violation['kind']; snippet: string } | null {
  // ALTER TABLE ... ADD/DROP/ALTER/RENAME COLUMN — match the column verb
  // within ~80 chars of "ALTER TABLE" so we don't false-match unrelated
  // column references in a downstream clause.
  const alterPatterns: Array<{ re: RegExp; kind: Violation['kind'] }> = [
    { re: /\bALTER\s+TABLE\b[\s\S]{0,80}?\bADD\s+COLUMN\b/i, kind: 'ADD COLUMN' },
    { re: /\bALTER\s+TABLE\b[\s\S]{0,80}?\bDROP\s+COLUMN\b/i, kind: 'DROP COLUMN' },
    { re: /\bALTER\s+TABLE\b[\s\S]{0,80}?\bALTER\s+COLUMN\b/i, kind: 'ALTER COLUMN' },
    { re: /\bALTER\s+TABLE\b[\s\S]{0,80}?\bRENAME\s+COLUMN\b/i, kind: 'RENAME COLUMN' },
  ];
  for (const { re, kind } of alterPatterns) {
    const m = re.exec(sql);
    if (m) return { kind, snippet: m[0].slice(0, 80) };
  }
  // CREATE TABLE — match the column-list opener
  const createTableRe = /\bCREATE\s+TABLE\b[^()]{0,80}?\(/i;
  const m = createTableRe.exec(sql);
  if (m) return { kind: 'CREATE TABLE', snippet: m[0].slice(0, 80) };
  return null;
}

function isSquashedBaseline(source: string): boolean {
  // Check the first 30 lines for the directive
  return /@migration-squashed-baseline/.test(source.split('\n').slice(0, 30).join('\n'));
}

interface RunResult {
  filesScanned: number;
  rawCallsScanned: number;
  squashedSkipped: number;
  violations: Violation[];
}

export function run(): RunResult {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(MIGRATIONS_DIR, { withFileTypes: true });
  } catch {
    return { filesScanned: 0, rawCallsScanned: 0, squashedSkipped: 0, violations: [] };
  }

  let filesScanned = 0;
  let rawCallsScanned = 0;
  let squashedSkipped = 0;
  const violations: Violation[] = [];

  for (const e of entries) {
    if (!e.isFile() || !e.name.endsWith('.ts')) continue;
    const file = path.join(MIGRATIONS_DIR, e.name);
    const source = fs.readFileSync(file, 'utf8');
    if (isSquashedBaseline(source)) {
      squashedSkipped++;
      continue;
    }
    filesScanned++;
    const rawCalls = findRawCalls(source);
    rawCallsScanned += rawCalls.length;
    for (const call of rawCalls) {
      const detection = detectColumnDdl(call.sql);
      if (detection) {
        violations.push({
          file: path.relative(REPO_ROOT, file),
          line: call.line,
          snippet: detection.snippet,
          kind: detection.kind,
        });
      }
    }
  }

  return { filesScanned, rawCallsScanned, squashedSkipped, violations };
}

function main() {
  // eslint-disable-next-line no-console
  console.log('\n→ check-no-column-ddl-in-raw-sql (Phase 0b.1c; second-line defense)\n');
  const result = run();
  // eslint-disable-next-line no-console
  console.log(`  migrations scanned:   ${result.filesScanned}`);
  // eslint-disable-next-line no-console
  console.log(`  squashed-baseline skipped: ${result.squashedSkipped}`);
  // eslint-disable-next-line no-console
  console.log(`  raw() calls scanned:  ${result.rawCallsScanned}`);
  // eslint-disable-next-line no-console
  console.log(`  violations:           ${result.violations.length}`);

  if (result.violations.length > 0) {
    // eslint-disable-next-line no-console
    console.error(`\n✗ ${result.violations.length} migration site(s) embed column DDL inside knex.raw():`);
    for (const v of result.violations) {
      // eslint-disable-next-line no-console
      console.error(`\n  ${v.file}:${v.line}  [${v.kind}]`);
      // eslint-disable-next-line no-console
      console.error(`    snippet: ${v.snippet.replace(/\s+/g, ' ').trim()}`);
    }
    // eslint-disable-next-line no-console
    console.error(`\nFix per CLAUDE.md §12.1 + Phase 0b.1c second-line-defense:`);
    // eslint-disable-next-line no-console
    console.error(`  - Use \`knex.schema.createTable / alterTable\` builder forms.`);
    // eslint-disable-next-line no-console
    console.error(`  - For Postgres-specific types (vector, citext, etc.):`);
    // eslint-disable-next-line no-console
    console.error(`      t.specificType('<col>', '<pg_type>')`);
    // eslint-disable-next-line no-console
    console.error(`  - For idempotency (column-not-exists guard):`);
    // eslint-disable-next-line no-console
    console.error(`      const has = await knex.schema.hasColumn('<table>', '<col>');`);
    // eslint-disable-next-line no-console
    console.error(`      if (!has) await knex.schema.alterTable('<table>', (t) => { ... });`);
    // eslint-disable-next-line no-console
    console.error(`  This guard has NO exemption mechanism; column DDL inside raw() is`);
    // eslint-disable-next-line no-console
    console.error(`  invisible to the migration-driven type generator (Phase 0b.1a/b).`);
    process.exit(1);
  }

  // eslint-disable-next-line no-console
  console.log('\n✓ No column DDL embedded in knex.raw() across active migrations.');
}

if (require.main === module) {
  main();
}
