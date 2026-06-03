#!/usr/bin/env tsx
/*
 * scripts/guards/check-jsonb-extraction.ts
 *
 * Phase R1 PR-R1-4 — CLAUDE.md §1.7 enforcement (JSONB extraction in
 * GET responses).
 *
 * ── Why this exists ──────────────────────────────────────────────
 * CLAUDE.md §1.7:
 *   "Data stored in JSONB must be extracted in GET responses."
 *
 * Several tables store extended data in JSONB columns
 * (`treatment_pathways.milestones`, `templates.content`,
 * `contact_records.content`, `escalations.description`, etc.). When
 * the frontend expects extracted top-level fields (e.g., `pathwayType`,
 * `totalSessions`), the GET endpoint MUST extract them from the JSONB
 * via a mapper. Returning the raw JSONB column to the wire causes
 * frontend crashes ("undefined is not iterable") or silent data loss.
 *
 * The response-shape guard (PR-R1-1.5) already catches `res.json(rawRow)`
 * for ANY non-canonical response. The JSONB-extraction guard adds a
 * stricter file-level check: every TS file under `apps/api/src/features/`
 * that queries a JSONB-bearing table MUST contain a canonical mapper
 * (`*ToResponse(...)`) that references at least one of the JSONB column
 * names — proof that JSONB extraction is in place.
 *
 * ── Discovery ────────────────────────────────────────────────────
 * JSONB columns are auto-discovered from migration files
 * (`apps/api/migrations/*.ts`):
 *   - `createTable('<table>', (t) => { ... t.jsonb('<col>') ... })`
 *   - `alterTable('<table>', (t) => { ... t.jsonb('<col>') ... })`
 *
 * The list is computed once at startup. If a migration is added that
 * declares a new JSONB column, the guard automatically learns it.
 *
 * ── Scope ────────────────────────────────────────────────────────
 * Files: apps/api/src/features/(* /)*.ts (production handlers).
 *
 * ── Run ──────────────────────────────────────────────────────────
 * `npm run guard:jsonb-extraction`
 *
 * Exit codes:
 *   0  every file querying a JSONB-bearing table contains an extraction mapper
 *   1  one or more files lack a JSONB-extraction mapper
 */

import * as fs from 'fs';
import * as path from 'path';

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const MIGRATIONS_DIR = path.join(REPO_ROOT, 'apps', 'api', 'migrations');
const SCAN_ROOT = path.join(REPO_ROOT, 'apps', 'api', 'src', 'features');
const ALLOWLIST_PATH = path.join(__dirname, 'check-jsonb-extraction.allowlist');

interface Violation {
  file: string;
  table: string;
  jsonbColumns: string[];
  reason: string;
}

/**
 * Discover JSONB columns by parsing migrations. Walks every `.ts` file in
 * `apps/api/migrations/` for `createTable` / `alterTable` blocks containing
 * `t.jsonb('colname')` declarations. The table name is captured from the
 * surrounding `createTable('table', ...)` / `alterTable('table', ...)` call.
 *
 * Returns: Map<tableName, Set<jsonbColumnName>>
 */
export function discoverJsonbColumns(): Map<string, Set<string>> {
  const result = new Map<string, Set<string>>();
  if (!fs.existsSync(MIGRATIONS_DIR)) return result;

  const files = fs
    .readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith('.ts'))
    .map((f) => path.join(MIGRATIONS_DIR, f));

  for (const file of files) {
    const source = fs.readFileSync(file, 'utf-8');
    // Match `createTable('table', ...)` / `alterTable('table', ...)` blocks
    // and the JSONB column declarations inside them. Migrations use a
    // builder-callback shape so we extract by greedy scan: find the call,
    // then capture every `t.jsonb('col')` until the matching close paren.
    const callRegex = /\b(?:createTable|alterTable)\s*\(\s*['"]([a-z_]+)['"]\s*,/g;
    let m: RegExpExecArray | null;
    while ((m = callRegex.exec(source)) !== null) {
      const table = m[1]!;
      // Find matching close paren — naive paren-balance from the opening
      let depth = 1;
      let i = m.index + m[0].length;
      while (i < source.length && depth > 0) {
        const ch = source[i]!;
        if (ch === '(') depth++;
        else if (ch === ')') depth--;
        i++;
      }
      const blockEnd = i;
      const block = source.substring(m.index, blockEnd);
      const colRegex = /\.jsonb\s*\(\s*['"]([a-z_]+)['"]/g;
      let cm: RegExpExecArray | null;
      while ((cm = colRegex.exec(block)) !== null) {
        const col = cm[1]!;
        if (!result.has(table)) result.set(table, new Set());
        result.get(table)!.add(col);
      }
    }
  }
  return result;
}

function loadAllowlist(): Set<string> {
  try {
    const raw = fs.readFileSync(ALLOWLIST_PATH, 'utf-8');
    const out = new Set<string>();
    for (const line of raw.split('\n')) {
      const trimmed = line.split('#')[0]!.trim();
      if (trimmed) out.add(trimmed);
    }
    return out;
  } catch (err) {
    console.warn(`[check-jsonb-extraction] could not read allowlist at ${ALLOWLIST_PATH}: ${(err as Error).message}`);
    return new Set();
  }
}

function walk(dir: string, acc: string[] = []): string[] {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch (err) {
    console.warn(`[check-jsonb-extraction] could not read directory ${dir}: ${(err as Error).message}`);
    return acc;
  }
  for (const e of entries) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (e.name === 'node_modules' || e.name.startsWith('.')) continue;
      walk(p, acc);
    } else if (e.isFile() && p.endsWith('.ts')) {
      if (p.includes('.test.') || p.includes('.spec.')) continue;
      acc.push(p);
    }
  }
  return acc;
}

/**
 * For a given file, determine which JSONB-bearing tables it queries.
 * Cycle-2 absorb (L3 finding #1 P0): added typed-Knex shape support.
 * Pre-cycle-2 the regex `\bdb\s*\(\s*['"]…` did NOT match the typed
 * form `db<RowT>('table')` — `pathwayRepository.ts` (the CLAUDE.md
 * §1.7 canonical example) was silently uncovered. The new patterns
 * include an OPTIONAL `<...>` between the function name and the
 * opening paren.
 *
 * Looks for `db[<T>]('<table>')`, `dbRead[<T>]('<table>')`,
 * `trx[<T>]('<table>')`, `.from('<table>')`, `.into('<table>')`.
 */
export function findJsonbTablesInFile(
  source: string,
  jsonbTables: Map<string, Set<string>>,
): Map<string, Set<string>> {
  const found = new Map<string, Set<string>>();
  const queryPatterns = [
    // typed + non-typed forms collapsed via optional <...>
    /\bdb(?:<[^>]+>)?\s*\(\s*['"]([a-z_]+)['"]/g,
    /\bdbRead(?:<[^>]+>)?\s*\(\s*['"]([a-z_]+)['"]/g,
    /\btrx(?:<[^>]+>)?\s*\(\s*['"]([a-z_]+)['"]/g,
    /\.from\s*\(\s*['"]([a-z_]+)['"]/g,
    /\.into\s*\(\s*['"]([a-z_]+)['"]/g,
  ];
  for (const re of queryPatterns) {
    let m: RegExpExecArray | null;
    while ((m = re.exec(source)) !== null) {
      const tbl = m[1]!;
      if (jsonbTables.has(tbl)) {
        found.set(tbl, jsonbTables.get(tbl)!);
      }
    }
  }
  return found;
}

/**
 * Find the matching close brace for an opening brace at index `start`
 * in `source`. Returns the index AFTER the matching close brace, or
 * `source.length` if unbalanced (runaway). Used to extract the actual
 * body of a mapper function instead of a fixed-byte window.
 */
function findMatchingBrace(source: string, start: number): number {
  let depth = 0;
  let i = start;
  let inString: string | null = null;
  let inLineComment = false;
  let inBlockComment = false;
  while (i < source.length) {
    const ch = source[i]!;
    const next = source[i + 1];
    if (inLineComment) {
      if (ch === '\n') inLineComment = false;
      i++;
      continue;
    }
    if (inBlockComment) {
      if (ch === '*' && next === '/') {
        inBlockComment = false;
        i += 2;
        continue;
      }
      i++;
      continue;
    }
    if (inString) {
      if (ch === '\\') { i += 2; continue; }
      if (ch === inString) inString = null;
      i++;
      continue;
    }
    if (ch === '/' && next === '/') { inLineComment = true; i += 2; continue; }
    if (ch === '/' && next === '*') { inBlockComment = true; i += 2; continue; }
    if (ch === '"' || ch === "'" || ch === '`') { inString = ch; i++; continue; }
    if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) return i + 1;
    }
    i++;
  }
  return source.length;
}

/**
 * Strip JS/TS comments from a string. Used to defend the property-access
 * heuristic against false positives from comment text like
 *   // bare identifier, not r.content
 * which would otherwise match the `\b\w+\.content\b` branch.
 */
function stripJsComments(src: string): string {
  let out = src.replace(/\/\*[\s\S]*?\*\//g, ' ');
  out = out.replace(/\/\/[^\n\r]*/g, ' ');
  return out;
}

/**
 * For a given file, check whether a canonical extraction mapper is
 * present. A mapper is "canonical" if (a) its signature contains
 * `function ...ToResponse` or `const ...ToResponse = `; (b) its actual
 * body (matched-brace-extracted, NOT a fixed-byte window) references
 * at least ONE of the expected JSONB column names IN A PROPERTY-ACCESS
 * CONTEXT — `row.col` / `r['col']` / `parseCol(` / `m.col`. A bare
 * word-boundary mention (e.g. inside a comment or unrelated identifier)
 * is no longer accepted.
 *
 * Cycle-2 absorb (L3 finding #3 + #4): the cycle-1 4000-char window
 * + bare `\b<col>\b` regex auto-passed mappers that mentioned the
 * JSONB column for ANY reason — including comments and unrelated
 * code that happened to share the name (`content`, `metadata`,
 * `details`, `items`, `options` are common JSONB columns in the
 * codebase). Cycle-2 extracts the real mapper body via brace-balance,
 * strips JS comments, and requires property-access context to
 * validate extraction.
 */
export function hasJsonbExtractionMapper(source: string, expectedJsonbCols: Set<string>): boolean {
  const mapperDeclRe = /(?:function\s+(\w+ToResponse)\b|const\s+(\w+ToResponse)\s*=)/g;
  let m: RegExpExecArray | null;
  while ((m = mapperDeclRe.exec(source)) !== null) {
    // Find the opening brace of the function body. For `function foo() { ... }`
    // and `const foo = (...) => { ... }`, the first `{` after the declaration is
    // the body start.
    const declEnd = m.index + m[0].length;
    const openBraceIdx = source.indexOf('{', declEnd);
    if (openBraceIdx === -1) continue;
    const closeBraceIdx = findMatchingBrace(source, openBraceIdx);
    // Strip comments from the body BEFORE scanning for property access.
    // A comment like `// not r.content` would otherwise match the
    // property-access branch and falsely accept the mapper.
    const body = stripJsComments(source.substring(openBraceIdx, closeBraceIdx));
    // For bracket-access detection (`r['col']`) we scan the ORIGINAL body
    // because the column name is INSIDE a string literal and stripping
    // strings would erase the match. For dot-access + parseCol detection
    // we scan a STRIPPED body where string literals are blanked — that
    // way `'milestones field required'` does not auto-pass.
    const bodyNoStr = body
      .replace(/'(?:\\.|[^'\\])*'/g, (s) => ' '.repeat(s.length))
      .replace(/"(?:\\.|[^"\\])*"/g, (s) => ' '.repeat(s.length))
      .replace(/`(?:\\.|[^`\\])*`/g, (s) => ' '.repeat(s.length));
    for (const col of expectedJsonbCols) {
      // Bracket access: `r['col']` / `r["col"]`. Scan the ORIGINAL body.
      const bracketRe = new RegExp(`\\[['"]${col}['"]\\]`);
      if (bracketRe.test(body)) return true;
      // Dot access + parseCol helper. Scan the STRIPPED body so column
      // names inside string literals don't auto-pass.
      const propAccessRe = new RegExp(
        `(?:` +
          `\\b\\w+\\.${col}\\b` +
          `|\\bparse${col[0]!.toUpperCase()}${col.slice(1)}\\s*\\(` +
        `)`,
      );
      if (propAccessRe.test(bodyNoStr)) return true;
    }
  }
  return false;
}

function scanFile(file: string, jsonbTables: Map<string, Set<string>>, allowlist: Set<string>): Violation[] {
  const relPath = path.relative(REPO_ROOT, file);
  if (allowlist.has(relPath)) return [];
  const source = fs.readFileSync(file, 'utf-8');
  const used = findJsonbTablesInFile(source, jsonbTables);
  if (used.size === 0) return [];
  // Collect all expected JSONB columns for the tables this file uses
  const allExpected = new Set<string>();
  for (const cols of used.values()) {
    for (const c of cols) allExpected.add(c);
  }
  if (hasJsonbExtractionMapper(source, allExpected)) return [];

  // Allow `// @jsonb-extraction-exempt: <reason>` annotation at top of file
  if (/\/\/\s*@jsonb-extraction-exempt:\s*\S/.test(source)) return [];

  const findings: Violation[] = [];
  for (const [table, cols] of used) {
    findings.push({
      file: relPath,
      table,
      jsonbColumns: Array.from(cols),
      reason: `queries JSONB-bearing table '${table}' but file lacks a *ToResponse mapper extracting JSONB column(s) ${Array.from(cols).map(c => `'${c}'`).join(', ')}`,
    });
  }
  return findings;
}

function main(): number {
  const jsonbTables = discoverJsonbColumns();
  const allowlist = loadAllowlist();
  const files = walk(SCAN_ROOT);
  const violations: Violation[] = [];
  for (const f of files) {
    violations.push(...scanFile(f, jsonbTables, allowlist));
  }

  console.error('→ check-jsonb-extraction (PR-R1-4; CLAUDE.md §1.7)');
  console.error(`  jsonb-tables-discovered: ${jsonbTables.size}`);
  console.error(`  scanned:                 ${files.length} TS file(s)`);
  console.error(`  allowlist:               ${path.relative(REPO_ROOT, ALLOWLIST_PATH)} (${allowlist.size} entries)`);
  console.error('');

  if (violations.length === 0) {
    console.error('✓ Every file querying a JSONB-bearing table contains a *ToResponse extraction mapper.');
    return 0;
  }

  console.error(`✗ ${violations.length} JSONB-extraction violation(s):\n`);
  for (const v of violations) {
    console.error(`  ${v.file}`);
    console.error(`    table:  ${v.table}`);
    console.error(`    jsonb:  ${v.jsonbColumns.join(', ')}`);
    console.error(`    reason: ${v.reason}`);
    console.error('');
  }
  console.error(
    'Fix per CLAUDE.md §1.7: add a `*ToResponse(row)` mapper that extracts the JSONB column(s) into top-level fields. ' +
      'For grandfathered cases, add the file path to ' +
      `${path.relative(REPO_ROOT, ALLOWLIST_PATH)} with a cascade BUG citation, OR add ` +
      '`// @jsonb-extraction-exempt: <reason>` to the file header.',
  );
  return 1;
}

if (require.main === module) {
  process.exit(main());
}
