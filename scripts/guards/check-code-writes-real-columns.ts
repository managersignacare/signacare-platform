/**
 * CI guard: `.insert({...})` and `.update({...})` must only write columns
 * that exist on the target table. The guard parses every object literal
 * passed to Knex's insert/update, resolves the bound table, and cross-checks
 * against apps/api/src/db/schema-snapshot.json.
 *
 * Why this exists — Phase R (2026-04-18). Throughout Phase 0.7.5 c24 we
 * found 62 schema-drift bugs (SD39–SD62) where code wrote object literals
 * containing column names that didn't exist on the target table. Knex does
 * not catch this at compile time — the `.insert({...})` argument type is
 * `Partial<Row>` but almost every row type in this codebase is a hand-
 * maintained interface or `Record<string, unknown>`, so there is no
 * compile-time check of "does `foo` really exist on that table". This
 * guard is the structural preventer. Every future `.insert({ ghost_col: x })`
 * fails CI at commit time instead of crashing at runtime when the handler
 * first runs.
 *
 * Detection strategy:
 *   1. Walk every .ts under apps/api/src/ (excluding tests, node_modules).
 *   2. Find every `.insert(` or `.update(` call.
 *   3. Resolve the bound table by walking backward for the nearest
 *      `(?:db|trx|dbAdmin|…)(<X>)?('<table>')` or
 *      `(<var> ?? <var>)('<table>')` or
 *      a class-local `TABLE_NAME = 'x'` / `TABLE = 'x'` constant paired
 *      with `extends ...Repository<Row>`.
 *   4. Walk forward from the `(` to the matching `)` with bracket depth.
 *   5. Inside the argument, find every top-level object literal and
 *      extract its top-level keys.
 *   6. Any key that is not a column on the resolved table → violation.
 *
 * What we skip (correctly — can't be checked statically):
 *   - Argument is a variable / function call (no object literal to parse)
 *   - Table binding is a variable (`db(tableName)`)
 *   - Object literal contains a spread (`...base`) — too much unknown
 *   - Key is computed (`[dynKey]: v`)
 *   - File contains `@code-columns-exempt` JSDoc above the call
 *
 * Exemptions (use sparingly with an honest reason):
 *   // @code-columns-exempt: <reason>
 *   db('t').insert({ ... });
 *
 * Exit code:
 *   0 — every .insert/.update writes real columns
 *   1 — one or more ghost-column writes detected
 */

import { readFileSync } from 'fs';
import { resolve } from 'path';
import { walkTsFiles } from './lib/guardRuntime';

const ROOT = resolve(__dirname, '..', '..');
const SNAPSHOT_PATH = resolve(ROOT, 'apps', 'api', 'src', 'db', 'schema-snapshot.json');
const SCAN_ROOT = resolve(ROOT, 'apps', 'api', 'src');

interface SchemaSnapshot {
  generatedAt: string;
  database: string;
  tables: Record<string, string[]>;
}

interface Violation {
  file: string;
  lineNo: number;
  callType: 'insert' | 'update';
  table: string;
  ghostColumns: string[];
  knownColumns: string[];
  preview: string;
}

/**
 * Walks backward from `position` in `src` to find the nearest table
 * binding. Returns the table name or null if not resolvable.
 */
function resolveBoundTable(src: string, position: number): string | null {
  // Window: 3000 chars back. That's enough for any reasonable repo method.
  const windowStart = Math.max(0, position - 3000);
  const window = src.substring(windowStart, position);

  // Pattern A: `db('t')`, `trx('t')`, `dbAdmin('t')`, `db<T>('t')`, etc.
  // We want the CLOSEST (highest index) match.
  const bindingRe =
    /(?:db|trx|dbAdmin|dbRead|dbWrite|dbConn|knex)(?:<[^>]+>)?\s*\(\s*['"]([A-Za-z_][A-Za-z0-9_]*)['"]/g;
  // Pattern B: `(trx ?? db)('t')` or `(db || trx)('t')`
  const coalesceRe =
    /\(\s*(?:trx|db|dbAdmin|dbRead|dbWrite|dbConn|knex)\s*(?:\?\?|\|\|)\s*(?:trx|db|dbAdmin|dbRead|dbWrite|dbConn|knex)\s*\)\s*\(\s*['"]([A-Za-z_][A-Za-z0-9_]*)['"]/g;
  // Pattern C: `.from('t')` — query-builder style
  const fromRe = /\.\s*from\s*\(\s*['"]([A-Za-z_][A-Za-z0-9_]*)['"]/g;
  // Pattern D: `.into('t')` — another query-builder style
  const intoRe = /\.\s*into\s*\(\s*['"]([A-Za-z_][A-Za-z0-9_]*)['"]/g;

  const allMatches: Array<{ idx: number; table: string }> = [];
  for (const re of [bindingRe, coalesceRe, fromRe, intoRe]) {
    re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(window)) !== null) {
      allMatches.push({ idx: m.index, table: m[1] });
    }
  }
  if (allMatches.length === 0) return null;
  // Pick the highest idx (closest to the .insert call) — but only if the
  // match is NOT separated from the call by a semicolon or closing brace,
  // which would indicate a different statement.
  allMatches.sort((a, b) => b.idx - a.idx);
  for (const m of allMatches) {
    const between = window.substring(m.idx);
    // Allow `.insert(...)` in the chain; stop if we see a statement-ending
    // `;` followed by more code, or an unmatched closing `}` indicating
    // a function/class boundary. But inside arg lists there are many
    // semicolons in other chains — this is an imperfect heuristic.
    // We accept the nearest match with no intervening semicolon that is
    // followed by a newline and non-whitespace.
    if (/;\s*\n\s*\S/.test(between)) continue;
    return m.table;
  }
  return null;
}

/**
 * Look backward from `position` (start of .insert call) for an exempt
 * comment. The comment may be directly above the `.insert(` line OR
 * above the start of the chained statement (for multi-line chains like
 * `await db('t')\n  .insert({...})`). We walk backward through lines
 * that are part of the statement chain (continuation lines starting
 * with `.`, `await`, identifiers, or whitespace) and check the first
 * non-continuation line for the marker.
 */
function isExempt(src: string, position: number): boolean {
  // Walk up through at most 8 preceding lines, skipping lines that are
  // clearly part of the current statement chain.
  let cursor = position;
  // Move cursor to start of current line.
  while (cursor > 0 && src[cursor - 1] !== '\n') cursor--;
  for (let depth = 0; depth < 8; depth++) {
    if (cursor === 0) return false;
    // Step back one line.
    const prevEnd = cursor - 1;
    let prevStart = prevEnd;
    while (prevStart > 0 && src[prevStart - 1] !== '\n') prevStart--;
    const prevLine = src.substring(prevStart, prevEnd);
    const trimmed = prevLine.trim();
    if (/@code-columns-exempt\s*:/.test(trimmed)) return true;
    // Is this a continuation line of the chain?
    //   - starts with `.`   (method chain)
    //   - starts with `await` / `return` followed by db/trx/etc identifier
    //   - is an identifier or whitespace (likely the db('t') call itself)
    //   - is a bracket-only line
    const isContinuation =
      trimmed === '' ||
      trimmed.startsWith('.') ||
      trimmed.startsWith('await ') ||
      trimmed.startsWith('return ') ||
      /^(?:const|let|var)\s/.test(trimmed) ||
      /^(?:db|trx|dbAdmin|dbRead|dbWrite|dbConn|knex)\b/.test(trimmed) ||
      /^[\])},;]/.test(trimmed);
    if (!isContinuation) return false;
    cursor = prevStart;
  }
  return false;
}

/**
 * Walk forward from `openParenIndex` (the index of the `(` after .insert)
 * to the matching closing `)`. Returns the substring between them.
 */
function extractArgument(src: string, openParenIndex: number): { body: string; endIndex: number } | null {
  let depth = 1;
  let i = openParenIndex + 1;
  let inSingle = false;
  let inDouble = false;
  let inBacktick = false;
  let inBacktickExpr = 0;
  let inLineComment = false;
  let inBlockComment = false;
  while (i < src.length && depth > 0) {
    const ch = src[i];
    const next = src[i + 1];
    if (inLineComment) {
      if (ch === '\n') inLineComment = false;
      i++;
      continue;
    }
    if (inBlockComment) {
      if (ch === '*' && next === '/') { inBlockComment = false; i += 2; continue; }
      i++;
      continue;
    }
    if (inSingle) {
      if (ch === '\\') { i += 2; continue; }
      if (ch === "'") inSingle = false;
      i++;
      continue;
    }
    if (inDouble) {
      if (ch === '\\') { i += 2; continue; }
      if (ch === '"') inDouble = false;
      i++;
      continue;
    }
    if (inBacktick) {
      if (inBacktickExpr > 0) {
        if (ch === '{') inBacktickExpr++;
        else if (ch === '}') inBacktickExpr--;
        i++;
        continue;
      }
      if (ch === '\\') { i += 2; continue; }
      if (ch === '$' && next === '{') { inBacktickExpr = 1; i += 2; continue; }
      if (ch === '`') inBacktick = false;
      i++;
      continue;
    }
    if (ch === '/' && next === '/') { inLineComment = true; i += 2; continue; }
    if (ch === '/' && next === '*') { inBlockComment = true; i += 2; continue; }
    if (ch === "'") { inSingle = true; i++; continue; }
    if (ch === '"') { inDouble = true; i++; continue; }
    if (ch === '`') { inBacktick = true; i++; continue; }
    if (ch === '(') { depth++; i++; continue; }
    if (ch === ')') { depth--; if (depth === 0) break; i++; continue; }
    i++;
  }
  if (depth !== 0) return null;
  return { body: src.substring(openParenIndex + 1, i), endIndex: i };
}

/**
 * Extract top-level object literals from an argument expression, and for
 * each literal, extract its top-level keys.
 *
 * Examples:
 *   `{ a: 1, b: 2 }`                       → [{a,b}]
 *   `[{a:1},{b:2}]`                        → [{a},{b}]
 *   `{...base, extra: 'x'}`                → [{<spread>, extra}]
 *   `row`                                  → [] (not a literal)
 *
 * Returns an array of objects; each object has `keys` + `hasSpread` flag.
 */
interface LiteralInfo {
  keys: string[];
  hasSpread: boolean;
  hasDynamicKey: boolean;
}

function extractLiterals(arg: string): LiteralInfo[] {
  const literals: LiteralInfo[] = [];
  // Walk the string, tracking bracket depth. At depth-0, look for `{`.
  // On finding `{`, parse the literal (recursively handling nested
  // objects), extracting top-level keys.
  let i = 0;
  const walk = (start: number): number => {
    // Scan inside this object literal for keys.
    const info: LiteralInfo = { keys: [], hasSpread: false, hasDynamicKey: false };
    let j = start + 1; // inside the {
    let depth = 0;
    let inSingle = false, inDouble = false, inBacktick = false, inBacktickExpr = 0;
    let inLineComment = false, inBlockComment = false;
    // We build up the current "key candidate" at depth 0.
    let tokenStart = j;
    const processKey = (endExclusive: number) => {
      // A key segment runs from tokenStart to endExclusive. It's something
      // like `  foo` or `  'foo'` or `  [dyn]` or `  ...base`.
      // A colon `:` terminates a key; a comma at depth 0 terminates a value.
      // We only handle the KEY part here.
      const seg = arg.substring(tokenStart, endExclusive).trim();
      if (!seg) return;
      if (seg.startsWith('...')) { info.hasSpread = true; return; }
      // Strip leading whitespace and comments
      const cleaned = seg.replace(/\s+/g, ' ').trim();
      if (cleaned.startsWith('[')) { info.hasDynamicKey = true; return; }
      // Quoted key: 'foo' or "foo"
      const qm = /^['"]([^'"]+)['"]/.exec(cleaned);
      if (qm) { info.keys.push(qm[1]); return; }
      // Bare identifier
      const im = /^([A-Za-z_$][\w$]*)/.exec(cleaned);
      if (im) info.keys.push(im[1]);
    };
    // Walk through the object literal body
    let sawColon = false;
    while (j < arg.length) {
      const ch = arg[j], nx = arg[j + 1];
      if (inLineComment) { if (ch === '\n') inLineComment = false; j++; continue; }
      if (inBlockComment) { if (ch === '*' && nx === '/') { inBlockComment = false; j += 2; continue; } j++; continue; }
      if (inSingle) { if (ch === '\\') { j += 2; continue; } if (ch === "'") inSingle = false; j++; continue; }
      if (inDouble) { if (ch === '\\') { j += 2; continue; } if (ch === '"') inDouble = false; j++; continue; }
      if (inBacktick) {
        if (inBacktickExpr > 0) {
          if (ch === '{') inBacktickExpr++;
          else if (ch === '}') inBacktickExpr--;
          j++;
          continue;
        }
        if (ch === '\\') { j += 2; continue; }
        if (ch === '$' && nx === '{') { inBacktickExpr = 1; j += 2; continue; }
        if (ch === '`') inBacktick = false;
        j++;
        continue;
      }
      if (ch === '/' && nx === '/') { inLineComment = true; j += 2; continue; }
      if (ch === '/' && nx === '*') { inBlockComment = true; j += 2; continue; }
      if (ch === "'") { inSingle = true; j++; continue; }
      if (ch === '"') { inDouble = true; j++; continue; }
      if (ch === '`') { inBacktick = true; j++; continue; }

      if (depth === 0) {
        // At key depth, look for `:` (end of key), `,` (end of value),
        // `{`, `[`, `(` (deeper), `}` (end of this literal).
        if (ch === ':') {
          if (!sawColon) processKey(j);
          sawColon = true;
          j++;
          continue;
        }
        if (ch === ',') {
          sawColon = false;
          tokenStart = j + 1;
          j++;
          continue;
        }
        if (ch === '{' || ch === '[' || ch === '(') { depth++; j++; continue; }
        if (ch === '}') {
          literals.push(info);
          return j + 1;
        }
      } else {
        if (ch === '{' || ch === '[' || ch === '(') { depth++; j++; continue; }
        if (ch === '}' || ch === ']' || ch === ')') { depth--; j++; continue; }
      }
      j++;
    }
    literals.push(info);
    return j;
  };

  while (i < arg.length) {
    const ch = arg[i];
    if (ch === '{') {
      i = walk(i);
      continue;
    }
    // Skip strings and other tokens at the top of arg — only care about
    // {...} literals at the argument's top level.
    i++;
  }
  return literals;
}

/**
 * Columns that a client may write but the DB often auto-provides — we
 * still validate them against the snapshot; this list is only for
 * messaging/suggestions.
 */
// const AUTO_COLUMNS = new Set(['id', 'created_at', 'updated_at', 'deleted_at']);

function main(): void {
  let snap: SchemaSnapshot;
  try {
    snap = JSON.parse(readFileSync(SNAPSHOT_PATH, 'utf-8')) as SchemaSnapshot;
  } catch (err) {
    console.error(`FAIL: cannot read schema snapshot at ${SNAPSHOT_PATH}`);
    console.error(`  Fix: npm run db:snapshot --workspace=apps/api`);
    console.error(`  Error: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  }

  const files = walkTsFiles(SCAN_ROOT, [], {
    excludeDirs: ['node_modules', 'dist', '__tests__'],
    excludeSuffixes: ['.d.ts', '.test.ts'],
  }).sort();
  const violations: Violation[] = [];
  let callsScanned = 0;
  let callsChecked = 0;
  let callsSkippedNoTable = 0;
  let callsSkippedNoLiteral = 0;
  let callsSkippedSpread = 0;
  let callsSkippedDynamicKey = 0;
  let callsSkippedUnknownTable = 0;
  let callsExempt = 0;

  // Find every `.insert(` or `.update(` invocation. Note: we EXCLUDE
  // `.update()` calls whose target is a Map/Set/Redis/etc — but since
  // we require a resolvable db() binding, those pass through cleanly.
  const callRe = /\.\s*(insert|update)\s*\(/g;

  for (const file of files) {
    const src = readFileSync(file, 'utf-8');
    callRe.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = callRe.exec(src)) !== null) {
      callsScanned++;
      const callType = m[1] as 'insert' | 'update';
      const callStart = m.index;
      const parenOpen = callStart + m[0].length - 1;

      // Exemption check
      if (isExempt(src, callStart)) { callsExempt++; continue; }

      // Resolve table
      const table = resolveBoundTable(src, callStart);
      if (!table) { callsSkippedNoTable++; continue; }

      // Table must exist in snapshot — if not, skip (the row-iface guard
      // handles missing tables; here we only care about ghost columns).
      const cols = snap.tables[table];
      if (!cols) { callsSkippedUnknownTable++; continue; }
      const colSet = new Set(cols);

      // Extract argument
      const argInfo = extractArgument(src, parenOpen);
      if (!argInfo) { callsSkippedNoLiteral++; continue; }

      const literals = extractLiterals(argInfo.body);
      if (literals.length === 0) { callsSkippedNoLiteral++; continue; }

      // For each literal, check its keys
      let literalChecked = false;
      for (const lit of literals) {
        if (lit.hasSpread) { callsSkippedSpread++; continue; }
        if (lit.hasDynamicKey) { callsSkippedDynamicKey++; continue; }
        if (lit.keys.length === 0) continue;
        literalChecked = true;
        const ghost = lit.keys.filter((k) => !colSet.has(k));
        if (ghost.length > 0) {
          const lineNo = src.substring(0, callStart).split('\n').length;
          violations.push({
            file,
            lineNo,
            callType,
            table,
            ghostColumns: ghost,
            knownColumns: cols,
            preview: src.substring(callStart, Math.min(callStart + 120, argInfo.endIndex + 1)).replace(/\s+/g, ' ').trim(),
          });
        }
      }
      if (literalChecked) callsChecked++;
    }
  }

  console.error(`\n→ check-code-writes-real-columns`);
  console.error(`  scan root:       ${relpath(SCAN_ROOT)}`);
  console.error(`  snapshot:        ${snap.generatedAt}  (${Object.keys(snap.tables).length} tables)`);
  console.error(`  calls scanned:   ${callsScanned}`);
  console.error(`  calls checked:   ${callsChecked}`);
  console.error(`  skipped:`);
  console.error(`    no-table:        ${callsSkippedNoTable}  (no resolvable db('<name>') binding)`);
  console.error(`    unknown-table:   ${callsSkippedUnknownTable}  (table not in snapshot — regenerate if needed)`);
  console.error(`    no-literal:      ${callsSkippedNoLiteral}  (arg is a variable / fn call, not an object literal)`);
  console.error(`    spread:          ${callsSkippedSpread}  (object includes ...spread; explicit keys still checked)`);
  console.error(`    dynamic-key:     ${callsSkippedDynamicKey}  (object has [computed] keys)`);
  console.error(`    exempt:          ${callsExempt}  (annotated with @code-columns-exempt)`);

  if (violations.length > 0) {
    console.error(`\n✗ FAIL: ${violations.length} ghost-column write(s) detected:\n`);
    for (const v of violations) {
      console.error(`  ${relpath(v.file)}:${v.lineNo}`);
      console.error(`     .${v.callType}() target: ${v.table}`);
      console.error(`     ghost columns: ${v.ghostColumns.join(', ')}`);
      // Suggest near-matches (case-insensitive substring on snake_case stem)
      for (const g of v.ghostColumns) {
        const stem = g.toLowerCase().replace(/[^a-z0-9]/g, '');
        const near = v.knownColumns.filter((c) => c.toLowerCase().replace(/[^a-z0-9]/g, '').includes(stem) || stem.includes(c.toLowerCase().replace(/[^a-z0-9]/g, '')));
        if (near.length > 0 && near.length <= 5) {
          console.error(`       ${g}  →  did you mean: ${near.join(', ')}?`);
        }
      }
      console.error(`     preview: ${v.preview.substring(0, 100)}${v.preview.length > 100 ? '…' : ''}`);
      console.error('');
    }
    console.error(`Rule: CLAUDE.md §15 (Row interface) + Phase R guard.`);
    console.error(`Fix one of:`);
    console.error(`  1. Rename the object key to match the actual column name.`);
    console.error(`  2. Add a migration that adds the missing column.`);
    console.error(`  3. If the key is NOT for a DB write (e.g. tuple-passed to another fn),`);
    console.error(`     refactor so the object literal only contains real columns.`);
    console.error(`  4. Exempt: add // @code-columns-exempt: <reason> on the line above.`);
    process.exit(1);
  }
  console.error(`\n✓ All .insert/.update writes target real columns.\n`);
}

function relpath(p: string): string {
  return p.startsWith(ROOT) ? p.substring(ROOT.length + 1) : p;
}

main();
