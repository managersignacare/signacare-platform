/**
 * CI guard: Knex migrations must use the schema builder for simple DDL,
 * and every `knex.raw()` call must carry a taxonomy-compliant exemption
 * annotation on the line immediately above it.
 *
 * Why this exists — Phase R (2026-04-18). Phase 0.7.5 c24 drifted away
 * from builder-first. CLAUDE.md §12.4 (2026-04-19 consistency pass)
 * tightened the rule further: every raw() block — even ones that match
 * an allowed category — must be annotated with one of the taxonomy
 * reasons below, so the reason for each raw call is locally visible
 * and greppable.
 *
 * Allowed taxonomy (CLAUDE.md §12.4):
 *
 *   rls_policy                — CREATE POLICY / ENABLE RLS
 *   drop_policy_if_exists     — DROP POLICY IF EXISTS
 *   check_constraint          — ADD CONSTRAINT ... CHECK
 *   drop_constraint_if_exists — DROP CONSTRAINT IF EXISTS
 *   column_comment            — COMMENT ON COLUMN / COMMENT ON TABLE
 *   data_backfill_insert      — INSERT INTO ... SELECT / VALUES
 *   data_backfill_update      — UPDATE ... SET
 *   data_backfill_delete      — DELETE FROM
 *   idempotency_guard         — IF [NOT] EXISTS on ADD/DROP COLUMN etc.
 *   view_create               — CREATE [OR REPLACE] [MATERIALIZED] VIEW
 *   view_drop                 — DROP VIEW
 *   trigger_create            — CREATE TRIGGER
 *   trigger_drop              — DROP TRIGGER
 *   function_create           — CREATE FUNCTION / DO $$
 *   function_drop             — DROP FUNCTION
 *   extension_create          — CREATE EXTENSION
 *   partition_attach          — ATTACH / CREATE TABLE ... PARTITION OF
 *   partition_detach          — DETACH PARTITION
 *   index_partial             — CREATE INDEX ... WHERE
 *   index_functional          — CREATE INDEX on expression / JSON path
 *   grant                     — GRANT
 *   revoke                    — REVOKE / ALTER DEFAULT PRIVILEGES
 *   introspection             — SELECT FROM pg_* / information_schema
 *   session_local             — SET LOCAL / SET search_path
 *   dynamic_identifier        — ${...} template interpolation
 *
 * File-level directive: `// @migration-squashed-baseline` at the top
 * of a file opts that file out of the per-call annotation requirement
 * (but every raw block must still match an ALLOWED_TOKENS category).
 * Use for consolidated baselines with hundreds of raw calls per §12.4.
 *
 * Exit code:
 *   0 — every migration complies with §12.4
 *   1 — one or more migrations violate the rule
 */

import { readFileSync, readdirSync, statSync } from 'fs';
import { resolve } from 'path';

const MIGRATIONS_DIR = resolve(__dirname, '..', '..', 'apps', 'api', 'migrations');
// BUG-343 — migration-shape helpers live under src/db/migrations-helpers/
// so they type-check as first-class TS. Their knex.raw() calls must
// carry the same §12.4 taxonomy annotations as migration-file raw()
// calls to preserve the coverage invariant across extraction.
const MIGRATIONS_HELPERS_DIR = resolve(
  __dirname,
  '..',
  '..',
  'apps',
  'api',
  'src',
  'db',
  'migrations-helpers',
);

interface Violation {
  file: string;
  lineNo: number;
  rawBody: string;
  reason: string;
}

/**
 * Tokens that justify the use of knex.raw(). If any match (case-insensitive,
 * word-boundary where sensible), the raw SQL is accepted as legitimate.
 */
const ALLOWED_TOKENS: Array<{ pattern: RegExp; label: string }> = [
  // RLS
  { pattern: /\bPOLICY\b/i, label: 'RLS policy' },
  { pattern: /\bROW\s+LEVEL\s+SECURITY\b/i, label: 'ROW LEVEL SECURITY' },
  // Triggers
  { pattern: /\bTRIGGER\b/i, label: 'trigger' },
  // Functions / anonymous blocks
  { pattern: /\bFUNCTION\b/i, label: 'function' },
  { pattern: /\bDO\s+\$\$/, label: 'anonymous DO block' },
  { pattern: /\bLANGUAGE\s+plpgsql\b/i, label: 'pl/pgsql' },
  { pattern: /\bCURSOR\b/i, label: 'cursor (pl/pgsql)' },
  { pattern: /\bDECLARE\b/i, label: 'DECLARE (pl/pgsql)' },
  // Views
  { pattern: /\bVIEW\b/i, label: 'view' },
  { pattern: /\bREFRESH\s+MATERIALIZED\s+VIEW\b/i, label: 'refresh materialized view' },
  // Extensions
  { pattern: /\bEXTENSION\b/i, label: 'extension' },
  // Partitioning
  { pattern: /\bPARTITION\s+(?:OF|BY)\b/i, label: 'partitioning' },
  // Access control
  { pattern: /\bGRANT\b/i, label: 'GRANT' },
  { pattern: /\bREVOKE\b/i, label: 'REVOKE' },
  { pattern: /\bALTER\s+DEFAULT\s+PRIVILEGES\b/i, label: 'ALTER DEFAULT PRIVILEGES' },
  // Comments
  { pattern: /\bCOMMENT\s+ON\b/i, label: 'COMMENT ON' },
  // Session / search_path
  { pattern: /\bSET\s+LOCAL\b/i, label: 'SET LOCAL' },
  { pattern: /\bSET\s+search_path\b/i, label: 'SET search_path' },
  // Introspection
  { pattern: /\binformation_schema\b/i, label: 'information_schema query' },
  { pattern: /\bpg_(?:roles|constraint|policies|indexes|tables|class|attribute|stat_activity|database|trigger|namespace|proc)\b/i, label: 'pg_* catalog query' },
  // DML
  { pattern: /\bINSERT\s+INTO\b/i, label: 'INSERT (backfill)' },
  { pattern: /\bUPDATE\s+\w+\s+SET\b/i, label: 'UPDATE (backfill)' },
  { pattern: /\bDELETE\s+FROM\b/i, label: 'DELETE (backfill)' },
  // Partial / functional index features
  { pattern: /\bCREATE\s+(?:UNIQUE\s+)?INDEX\b[\s\S]*?\bWHERE\b/i, label: 'partial index' },
  { pattern: /\bCREATE\s+(?:UNIQUE\s+)?INDEX\b[\s\S]*?\b(?:LOWER|UPPER|COALESCE)\s*\(/i, label: 'functional index (expression)' },
  { pattern: /\bCREATE\s+(?:UNIQUE\s+)?INDEX\b[\s\S]*?::(?:jsonb|text|uuid)\b/i, label: 'functional index (cast)' },
  { pattern: /\bCREATE\s+(?:UNIQUE\s+)?INDEX\b[\s\S]*?(?:->>|->|#>>|#>)/, label: 'functional index (JSON path)' },
  // Generic functional index: `ON <table> ((<expr>))` — the double-paren
  // is PostgreSQL's syntax for "treat this as an expression, not a column".
  // Covers cases like `ON backup_config((true))` for singleton-row enforcement.
  { pattern: /\bCREATE\s+(?:UNIQUE\s+)?INDEX\b[\s\S]*?\bON\s+\w+\s*\(\s*\(/i, label: 'functional index (expression in double parens)' },
  { pattern: /\bCREATE\s+INDEX\s+CONCURRENTLY\b/i, label: 'concurrent index' },
  // Idempotency
  { pattern: /\bIF\s+NOT\s+EXISTS\b/i, label: 'IF NOT EXISTS' },
  { pattern: /\bIF\s+EXISTS\b/i, label: 'IF EXISTS' },
  // CHECK constraints with expressions
  { pattern: /\bCHECK\s*\(/i, label: 'CHECK constraint' },
  // Dynamic identifiers via template interpolation — used for
  // canonical-name renames where the table/column name is not a literal.
  { pattern: /\$\{[^}]+\}/, label: 'dynamic identifier (template interpolation)' },
];

/**
 * Simple-DDL patterns. If a raw SQL block matches one of these and has NO
 * allowed-token match, it's a violation.
 */
const SIMPLE_DDL_PATTERNS: Array<{ pattern: RegExp; label: string; builder: string }> = [
  {
    pattern: /\bCREATE\s+TABLE\s+\w+\s*\(/i,
    label: 'CREATE TABLE',
    builder: "knex.schema.createTable('<name>', (t) => { t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()')); ... })",
  },
  {
    pattern: /\bALTER\s+TABLE\s+\w+\s+ADD\s+COLUMN\b/i,
    label: 'ALTER TABLE ADD COLUMN',
    builder: "knex.schema.alterTable('<table>', (t) => { t.<type>('<col>'); })",
  },
  {
    pattern: /\bALTER\s+TABLE\s+\w+\s+DROP\s+COLUMN\b/i,
    label: 'ALTER TABLE DROP COLUMN',
    builder: "knex.schema.alterTable('<table>', (t) => { t.dropColumn('<col>'); })",
  },
  {
    pattern: /\bALTER\s+TABLE\s+\w+\s+ALTER\s+COLUMN\b/i,
    label: 'ALTER TABLE ALTER COLUMN',
    builder: "knex.schema.alterTable('<table>', (t) => { t.<type>('<col>').notNullable().alter(); })",
  },
  {
    pattern: /\bCREATE\s+(?:UNIQUE\s+)?INDEX\s+\w+\s+ON\s+\w+/i,
    label: 'CREATE INDEX (simple)',
    builder: "knex.schema.alterTable('<table>', (t) => { t.index(['<col>'], 'idx_name'); }) — or .unique([...]) for unique indexes",
  },
  {
    pattern: /\bDROP\s+TABLE\s+\w+/i,
    label: 'DROP TABLE',
    builder: "knex.schema.dropTable('<name>') or knex.schema.dropTableIfExists('<name>')",
  },
  {
    pattern: /\bDROP\s+INDEX\s+\w+/i,
    label: 'DROP INDEX (simple)',
    builder: "knex.schema.alterTable('<table>', (t) => { t.dropIndex(['<col>'], '<idx_name>'); })",
  },
];

function walkTs(dir: string): string[] {
  const out: string[] = [];
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return out;
  }
  for (const entry of entries) {
    const full = resolve(dir, entry);
    const s = statSync(full);
    if (s.isDirectory()) continue;
    if (entry.endsWith('.ts') && !entry.endsWith('.d.ts')) {
      out.push(full);
    }
  }
  return out;
}

/**
 * Extract every `knex.raw(...)` call's argument.
 *
 * We match both patterns:
 *   knex.raw(`...multiline SQL...`)
 *   knex.raw('...SQL...')
 *   knex.raw("...SQL...")
 *   await knex.raw(`...`)
 *   return knex.raw(`...`)
 *
 * Returns the inner SQL with enclosing quote/backtick stripped, plus the
 * 1-based starting line number of the `knex.raw(` call.
 */
function extractRawBlocks(src: string): Array<{ lineNo: number; body: string; startIndex: number }> {
  const blocks: Array<{ lineNo: number; body: string; startIndex: number }> = [];
  // Matches statement-level `knex.raw(` — preceded by `await` / `return`
  // or by whitespace at the start of a line. Excludes scalar uses inside
  // builder chains like `.defaultTo(knex.raw('gen_random_uuid()'))`
  // which are expressions, not DDL statements.
  const rawRe = /(?:^|\n)\s*(?:await\s+|return\s+)?((?:knex|trx|db|dbAdmin|dbRead|dbConn|dbWrite)\.raw)\s*\(\s*(`|'|")/g;
  let m: RegExpExecArray | null;
  while ((m = rawRe.exec(src)) !== null) {
    const quoteChar = m[2];
    const bodyStart = m.index + m[0].length;
    // The annotation-walker (readExemption) needs the position of the
    // `knex.raw` identifier itself, not the start of the full match
    // (which is before the leading newline + whitespace). Locate group
    // 1 within m[0] to get the absolute index of `knex.raw`.
    const rawCallOffset = m.index + m[0].lastIndexOf(m[1]);
    // Find the matching closing quote/backtick. Backticks support ${}
    // interpolation; quotes don't. We handle backticks specially by walking
    // past ${...} groups.
    let i = bodyStart;
    while (i < src.length) {
      const ch = src[i];
      if (ch === '\\') {
        i += 2;
        continue;
      }
      if (quoteChar === '`' && ch === '$' && src[i + 1] === '{') {
        let depth = 1;
        i += 2;
        while (i < src.length && depth > 0) {
          if (src[i] === '{') depth++;
          else if (src[i] === '}') depth--;
          i++;
        }
        continue;
      }
      if (ch === quoteChar) break;
      i++;
    }
    if (i >= src.length) continue; // unterminated; skip
    const body = src.substring(bodyStart, i);
    const lineNo = src.substring(0, rawCallOffset).split('\n').length;
    // Use rawCallOffset (position of `knex.raw`) as the anchor for
    // readExemption — it walks backward to the line above the raw call.
    blocks.push({ lineNo, body, startIndex: rawCallOffset });
  }
  return blocks;
}

// CLAUDE.md §12.4 fixed taxonomy for `@migration-raw-exempt` reasons. Any
// raw() block outside a squashed-baseline file MUST carry one of these
// categories on the line directly above the call.
const TAXONOMY = new Set([
  'rls_policy',
  'drop_policy_if_exists',
  'check_constraint',
  'drop_constraint_if_exists',
  'column_comment',
  'data_backfill_insert',
  'data_backfill_update',
  'data_backfill_delete',
  'idempotency_guard',
  'view_create',
  'view_drop',
  'trigger_create',
  'trigger_drop',
  'function_create',
  'function_drop',
  'extension_create',
  'partition_attach',
  'partition_detach',
  'index_partial',
  'index_functional',
  'grant',
  'revoke',
  'introspection',
  'session_local',
  'dynamic_identifier',
]);

/**
 * Read the `@migration-raw-exempt: <category>` annotation on the line
 * directly above the raw call. Returns `null` when missing, or the
 * category string when present.
 */
function readExemption(src: string, startIndex: number): string | null {
  // Walk backward from startIndex to the start of the line containing
  // the call. Then check the previous line for the exemption marker.
  let lineStart = startIndex;
  while (lineStart > 0 && src[lineStart - 1] !== '\n') lineStart--;
  if (lineStart === 0) return null;
  const prevEnd = lineStart - 1; // position of the '\n'
  let prevStart = prevEnd;
  while (prevStart > 0 && src[prevStart - 1] !== '\n') prevStart--;
  const prevLine = src.substring(prevStart, prevEnd);
  const m = prevLine.match(/@migration-raw-exempt\s*:\s*([A-Za-z_][A-Za-z0-9_]*)/);
  return m ? m[1] : null;
}

/** File-level `@migration-squashed-baseline` directive check. */
function isSquashedBaseline(src: string): boolean {
  return /@migration-squashed-baseline\b/.test(src);
}

function checkBlock(body: string): { violation: false } | { violation: true; label: string; builder: string } {
  // If any allowed token matches, the raw call is justified.
  for (const { pattern } of ALLOWED_TOKENS) {
    if (pattern.test(body)) return { violation: false };
  }
  // No allowed token → check for simple-DDL patterns.
  for (const { pattern, label, builder } of SIMPLE_DDL_PATTERNS) {
    if (pattern.test(body)) {
      return { violation: true, label, builder };
    }
  }
  // No simple-DDL pattern either → probably a non-DDL raw (e.g. empty block,
  // or a pattern we don't recognise). Accept.
  return { violation: false };
}

function main(): void {
  const files = [
    ...walkTs(MIGRATIONS_DIR),
    // BUG-343 — also scan the migration-helpers dir (empty before BUG-343;
    // scan gracefully returns [] if the dir doesn't exist yet).
    ...walkTs(MIGRATIONS_HELPERS_DIR),
  ];
  const violations: Violation[] = [];
  const annotationViolations: Violation[] = [];
  let rawBlocksScanned = 0;
  let rawBlocksExempt = 0;
  let rawBlocksAllowed = 0;
  let squashedFiles = 0;

  for (const f of files) {
    const src = readFileSync(f, 'utf-8');
    const squashed = isSquashedBaseline(src);
    if (squashed) squashedFiles++;
    const blocks = extractRawBlocks(src);
    for (const b of blocks) {
      rawBlocksScanned++;
      const result = checkBlock(b.body);
      const exemption = readExemption(src, b.startIndex);

      if (squashed) {
        // Squashed baseline: per-call annotation not required. Still
        // enforce category-match so we don't silently accept simple-DDL
        // raw calls that should use the builder.
        if (result.violation) {
          violations.push({
            file: f,
            lineNo: b.lineNo,
            rawBody: b.body.substring(0, 200).replace(/\s+/g, ' ').trim(),
            reason: `${result.label} — use schema builder instead.\n     Replacement: ${result.builder}`,
          });
        } else if (exemption !== null) {
          rawBlocksExempt++;
        } else {
          rawBlocksAllowed++;
        }
        continue;
      }

      // Non-squashed migration: annotation is MANDATORY per §12.4.
      if (exemption === null) {
        annotationViolations.push({
          file: f,
          lineNo: b.lineNo,
          rawBody: b.body.substring(0, 200).replace(/\s+/g, ' ').trim(),
          reason: 'missing `// @migration-raw-exempt: <category>` annotation on the line directly above.',
        });
        continue;
      }
      if (!TAXONOMY.has(exemption)) {
        annotationViolations.push({
          file: f,
          lineNo: b.lineNo,
          rawBody: b.body.substring(0, 200).replace(/\s+/g, ' ').trim(),
          reason: `unknown category "${exemption}". Valid categories (CLAUDE.md §12.4): ${[...TAXONOMY].join(', ')}.`,
        });
        continue;
      }
      rawBlocksExempt++;
      if (result.violation) {
        // Even though the annotation exists, the SQL is simple-DDL the
        // builder could express. Flag as a builder-first violation.
        violations.push({
          file: f,
          lineNo: b.lineNo,
          rawBody: b.body.substring(0, 200).replace(/\s+/g, ' ').trim(),
          reason: `${result.label} — use schema builder instead.\n     Replacement: ${result.builder}`,
        });
      }
    }
  }

  console.error(`\n→ check-migration-convention`);
  console.error(`  migrations dir: ${relpath(MIGRATIONS_DIR)}`);
  console.error(`  files scanned:  ${files.length} (${squashedFiles} squashed-baseline)`);
  console.error(`  raw() blocks:   ${rawBlocksScanned} total, ${rawBlocksExempt} annotated, ${rawBlocksAllowed} squashed-allowlisted`);

  const totalFail = violations.length + annotationViolations.length;

  if (annotationViolations.length > 0) {
    console.error(`\n✗ FAIL: ${annotationViolations.length} raw SQL call(s) missing or invalid §12.4 annotation:\n`);
    for (const v of annotationViolations) {
      console.error(`  ${relpath(v.file)}:${v.lineNo}`);
      console.error(`     SQL preview: ${v.rawBody.substring(0, 120)}${v.rawBody.length > 120 ? '…' : ''}`);
      console.error(`     ${v.reason}`);
      console.error('');
    }
  }

  if (violations.length > 0) {
    console.error(`\n✗ FAIL: ${violations.length} raw SQL call(s) should use schema builder:\n`);
    for (const v of violations) {
      console.error(`  ${relpath(v.file)}:${v.lineNo}`);
      console.error(`     SQL preview: ${v.rawBody.substring(0, 120)}${v.rawBody.length > 120 ? '…' : ''}`);
      console.error(`     ${v.reason}`);
      console.error('');
    }
  }

  if (totalFail > 0) {
    console.error(`Rule: CLAUDE.md §12.4 — every raw() call annotated with a taxonomy`);
    console.error(`category on the line directly above:`);
    console.error(`  // @migration-raw-exempt: <category>`);
    console.error(`  await knex.raw(\`...\`);`);
    console.error(`Squashed-baseline files may opt out via the file-level directive:`);
    console.error(`  // @migration-squashed-baseline`);
    process.exit(1);
  }

  console.error(`\n✓ All raw SQL calls carry a taxonomy-compliant §12.4 annotation.\n`);
}

function relpath(p: string): string {
  const root = resolve(__dirname, '..', '..');
  return p.startsWith(root) ? p.substring(root.length + 1) : p;
}

main();
