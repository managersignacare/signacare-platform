/**
 * CI guard: query-builder column references + raw-SQL table.column references
 * must name real columns on the target table per schema-snapshot.json.
 *
 * Why this exists — Phase R follow-up (2026-04-18). The existing
 * `check-code-writes-real-columns.ts` guard only covers `.insert({...})`
 * and `.update({...})` object literals. It does NOT cover:
 *
 *   - `.orderBy('col', 'desc')`                       ← Bug 5: assessment_datetime
 *   - `.select('col', 'col as alias', ...)`            ← Bug 5 (timeline query)
 *   - `.groupBy('col')` / `.groupBy(['a','b'])`
 *   - `.where({col: v})` / `.andWhere({col: v})` — object forms
 *   - `.whereNull('col')` / `.whereNotNull('col')` / `.whereIn('col', ...)`
 *   - `db.raw(\`SELECT audit_log.createdat ...\`)`      ← Bug 11: ghost raw SQL
 *   - `.whereRaw(\`foo.bar = ?\`)` / `.havingRaw` / `.orderByRaw`
 *
 * Those gaps let three ghost-column bugs (Bug 5 assessment_datetime,
 * Bug 6 review_datetime, Bug 11 audit_log.createdat/entityid/ipaddress)
 * ship in v1.1.0 and crash at runtime in v1.1.0 + patient-chart load.
 *
 * This guard closes those gaps. Two detection modes:
 *
 *   Mode A — BUILDER METHODS (string-literal column args)
 *     Finds each of the methods above, extracts the string-literal
 *     column name(s), and verifies against schema-snapshot.json for
 *     the nearest resolvable `db('<table>')` binding.
 *
 *   Mode B — RAW SQL WITH table.column REFERENCES
 *     Finds `db.raw(\`...\`)` / `dbRead.raw` / `trx.raw` / `knex.raw` /
 *     `.whereRaw` / `.havingRaw` / `.orderByRaw` calls. Strips
 *     ${...} interpolations. Scans the cleaned SQL for <ident>.<ident>
 *     tokens. For each token where the LHS (<ident>) is a real table
 *     in the snapshot, verifies the RHS (<col>) exists on that table.
 *     LHS tokens that are NOT real tables (aliases, CTEs, subqueries)
 *     are skipped — safer than guessing.
 *
 * Exemption: `// @query-col-exempt: <reason>` above the call.
 *
 * Exit code:
 *   0 — every builder call + every raw SQL table.col ref is real
 *   1 — one or more ghost references detected
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
  kind: string;           // e.g. "orderBy('ghost')" or "audit_log.ghost_col (raw SQL)"
  table: string;
  ghostColumns: string[];
  knownColumns: string[];
  preview: string;
}

// ─── Shared: resolve table binding (back-search) ─────────────────────────────
// Same logic as check-code-writes-real-columns.ts. Kept inline (no cross-file
// helper) per CLAUDE.md §no-abstraction-shortcuts — each guard self-documents.
function resolveBoundTable(src: string, position: number): string | null {
  const windowStart = Math.max(0, position - 3000);
  const window = src.substring(windowStart, position);
  const bindingRe =
    /(?:db|trx|dbAdmin|dbRead|dbWrite|dbConn|knex)(?:<[^>]+>)?\s*\(\s*['"]([A-Za-z_][A-Za-z0-9_]*)['"]/g;
  const coalesceRe =
    /\(\s*(?:trx|db|dbAdmin|dbRead|dbWrite|dbConn|knex)\s*(?:\?\?|\|\|)\s*(?:trx|db|dbAdmin|dbRead|dbWrite|dbConn|knex)\s*\)\s*\(\s*['"]([A-Za-z_][A-Za-z0-9_]*)['"]/g;
  const fromRe = /\.\s*from\s*\(\s*['"]([A-Za-z_][A-Za-z0-9_]*)['"]/g;
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
  allMatches.sort((a, b) => b.idx - a.idx);
  for (const m of allMatches) {
    const between = window.substring(m.idx);
    if (/;\s*\n\s*\S/.test(between)) continue;
    return m.table;
  }
  return null;
}

function isExempt(src: string, position: number): boolean {
  let cursor = position;
  while (cursor > 0 && src[cursor - 1] !== '\n') cursor--;
  for (let depth = 0; depth < 8; depth++) {
    if (cursor === 0) return false;
    const prevEnd = cursor - 1;
    let prevStart = prevEnd;
    while (prevStart > 0 && src[prevStart - 1] !== '\n') prevStart--;
    const prevLine = src.substring(prevStart, prevEnd);
    const trimmed = prevLine.trim();
    if (/@query-col-exempt\s*:/.test(trimmed)) return true;
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

/** Walk forward from `openParenIndex` to matching `)`. */
function extractArgument(src: string, openParenIndex: number): { body: string; endIndex: number } | null {
  let depth = 1, i = openParenIndex + 1;
  let inSingle = false, inDouble = false, inBacktick = false, inBacktickExpr = 0;
  let inLineComment = false, inBlockComment = false;
  while (i < src.length && depth > 0) {
    const ch = src[i], next = src[i + 1];
    if (inLineComment) { if (ch === '\n') inLineComment = false; i++; continue; }
    if (inBlockComment) { if (ch === '*' && next === '/') { inBlockComment = false; i += 2; continue; } i++; continue; }
    if (inSingle) { if (ch === '\\') { i += 2; continue; } if (ch === "'") inSingle = false; i++; continue; }
    if (inDouble) { if (ch === '\\') { i += 2; continue; } if (ch === '"') inDouble = false; i++; continue; }
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

/** Extract outermost template-literal body from a raw(...) arg. Handles
 *  single backtick template or plain string. Returns null if not a template. */
function extractTemplateLiteral(arg: string): string | null {
  const trimmed = arg.trim();
  if (trimmed.startsWith('`')) {
    const end = findMatchingBacktick(trimmed, 0);
    if (end === -1) return null;
    return trimmed.substring(1, end);
  }
  if (trimmed.startsWith("'") || trimmed.startsWith('"')) {
    const q = trimmed[0];
    const end = trimmed.indexOf(q, 1);
    if (end === -1) return null;
    return trimmed.substring(1, end);
  }
  return null;
}

function findMatchingBacktick(s: string, start: number): number {
  let i = start + 1;
  while (i < s.length) {
    if (s[i] === '\\') { i += 2; continue; }
    if (s[i] === '$' && s[i + 1] === '{') {
      let depth = 1;
      i += 2;
      while (i < s.length && depth > 0) {
        if (s[i] === '{') depth++;
        else if (s[i] === '}') depth--;
        i++;
      }
      continue;
    }
    if (s[i] === '`') return i;
    i++;
  }
  return -1;
}

/** Strip ${...} interpolations from a template-literal body. */
function stripInterpolations(sql: string): string {
  let out = '';
  let i = 0;
  while (i < sql.length) {
    if (sql[i] === '$' && sql[i + 1] === '{') {
      let depth = 1;
      i += 2;
      while (i < sql.length && depth > 0) {
        if (sql[i] === '{') depth++;
        else if (sql[i] === '}') depth--;
        i++;
      }
      out += ' ? ';
      continue;
    }
    out += sql[i];
    i++;
  }
  return out;
}

/** Extract string literals from a comma-separated arg list (e.g. select('a','b as x')).
 *  Returns only the string-literal args; non-literals (variables, raw(), etc.) are skipped. */
function extractStringArgs(arg: string): string[] {
  const out: string[] = [];
  let i = 0;
  let depth = 0;
  while (i < arg.length) {
    const ch = arg[i];
    if (ch === '(' || ch === '{' || ch === '[') { depth++; i++; continue; }
    if (ch === ')' || ch === '}' || ch === ']') { depth--; i++; continue; }
    if (depth > 0) { i++; continue; }
    if (ch === "'" || ch === '"') {
      const q = ch;
      let j = i + 1;
      while (j < arg.length) {
        if (arg[j] === '\\') { j += 2; continue; }
        if (arg[j] === q) break;
        j++;
      }
      if (j < arg.length) {
        out.push(arg.substring(i + 1, j));
        i = j + 1;
        continue;
      }
    }
    i++;
  }
  return out;
}

/** Extract column name from a string like "col", "col as alias", "table.col",
 *  "table.col as alias". Returns null if the input looks like a raw expression
 *  (contains parens, spaces that aren't " as ", SQL fn names). */
function parseColumnRef(s: string): { table: string | null; column: string } | null {
  const t = s.trim();
  if (!t) return null;
  // Strip "... as alias" — the alias isn't a column ref
  const asMatch = /^(.+?)\s+as\s+[A-Za-z_][A-Za-z0-9_]*\s*$/i.exec(t);
  const expr = (asMatch ? asMatch[1] : t).trim();
  // Bail if the expression looks complex (parens, arithmetic, functions)
  if (/[()*+\-/,\s]/.test(expr)) return null;
  // Bail if starts with a digit
  if (/^\d/.test(expr)) return null;
  const parts = expr.split('.');
  if (parts.length === 1) {
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(parts[0])) return null;
    return { table: null, column: parts[0] };
  }
  if (parts.length === 2) {
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(parts[0])) return null;
    if (parts[1] === '*') return null;  // table.*
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(parts[1])) return null;
    return { table: parts[0], column: parts[1] };
  }
  return null;
}

/** Extract top-level object literal keys from an arg (for .where({col: v})).
 *  Reuses the same logic as check-code-writes-real-columns.extractLiterals
 *  but collapsed for single top-level object. Returns null if not an object. */
interface ObjectLiteralInfo {
  keys: string[];
  hasSpread: boolean;
  hasDynamicKey: boolean;
}

function extractFirstObjectLiteral(arg: string): ObjectLiteralInfo | null {
  let i = 0;
  while (i < arg.length && /\s/.test(arg[i])) i++;
  if (arg[i] !== '{') return null;
  const info: ObjectLiteralInfo = { keys: [], hasSpread: false, hasDynamicKey: false };
  let j = i + 1;
  let depth = 0;
  let inSingle = false, inDouble = false, inBacktick = false, inBacktickExpr = 0;
  let inLineComment = false, inBlockComment = false;
  let tokenStart = j;
  let sawColon = false;
  const processKey = (endExclusive: number) => {
    const seg = arg.substring(tokenStart, endExclusive).trim();
    if (!seg) return;
    if (seg.startsWith('...')) { info.hasSpread = true; return; }
    const cleaned = seg.replace(/\s+/g, ' ').trim();
    if (cleaned.startsWith('[')) { info.hasDynamicKey = true; return; }
    const qm = /^['"]([^'"]+)['"]/.exec(cleaned);
    if (qm) { info.keys.push(qm[1]); return; }
    const im = /^([A-Za-z_$][\w$]*)/.exec(cleaned);
    if (im) info.keys.push(im[1]);
  };
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
      if (ch === ':') {
        if (!sawColon) processKey(j);
        sawColon = true;
        j++;
        continue;
      }
      if (ch === ',') { sawColon = false; tokenStart = j + 1; j++; continue; }
      if (ch === '{' || ch === '[' || ch === '(') { depth++; j++; continue; }
      if (ch === '}') { return info; }
    } else {
      if (ch === '{' || ch === '[' || ch === '(') { depth++; j++; continue; }
      if (ch === '}' || ch === ']' || ch === ')') { depth--; j++; continue; }
    }
    j++;
  }
  return info;
}

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
  let stringArgCalls = 0;
  let objectArgCalls = 0;
  let rawCalls = 0;
  let skippedNoTable = 0;
  let skippedUnknownTable = 0;
  let skippedComplexArg = 0;
  let exempt = 0;

  // Mode A — string-literal column args
  // .orderBy('col', ...), .groupBy('col'), .select('col', ...), .whereNull('col'), .whereNotNull('col'),
  // .whereIn('col', ...), .whereNotIn('col', ...), .distinct('col', ...)
  const stringArgCallRe =
    /\.\s*(orderBy|groupBy|select|whereNull|whereNotNull|whereIn|whereNotIn|distinct|min|max|avg|sum|count|pluck)\s*\(/g;

  // Mode A' — object-form where/andWhere/orWhere/whereNot
  const objectArgCallRe = /\.\s*(where|andWhere|orWhere|whereNot)\s*\(/g;

  // Mode B — raw SQL with table.col references
  // db.raw(`...`), dbRead.raw(`...`), trx.raw(`...`), knex.raw(`...`),
  // .whereRaw(`...`), .havingRaw(`...`), .orderByRaw(`...`), .fromRaw(`...`)
  const rawCallRe =
    /(?:\b(?:db|dbRead|dbWrite|dbAdmin|trx|knex|dbConn)\s*\.\s*raw\s*\()|\.(?:whereRaw|havingRaw|orderByRaw|fromRaw|joinRaw)\s*\(/g;

  const tableSet = new Set(Object.keys(snap.tables));

  for (const file of files) {
    const src = readFileSync(file, 'utf-8');

    // Mode A — string-literal column args
    stringArgCallRe.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = stringArgCallRe.exec(src)) !== null) {
      stringArgCalls++;
      const method = m[1];
      const callStart = m.index;
      const parenOpen = callStart + m[0].length - 1;
      if (isExempt(src, callStart)) { exempt++; continue; }
      const argInfo = extractArgument(src, parenOpen);
      if (!argInfo) { skippedComplexArg++; continue; }
      const table = resolveBoundTable(src, callStart);
      if (!table) { skippedNoTable++; continue; }
      const cols = snap.tables[table];
      if (!cols) { skippedUnknownTable++; continue; }
      const colSet = new Set(cols);

      const strings = extractStringArgs(argInfo.body);
      if (strings.length === 0) { skippedComplexArg++; continue; }

      // Pre-scan the enclosing statement for SELECT aliases — `" as X"` or
      // " AS X" — PostgreSQL accepts ORDER BY / GROUP BY on aliases, so
      // `.orderBy('cnt')` is valid when a preceding `.select(db.raw("count(*) as cnt"))`
      // defined the alias. Scan window = 3000 chars back (same as resolveBoundTable).
      const aliasWindowStart = Math.max(0, callStart - 3000);
      const aliasWindow = src.substring(aliasWindowStart, callStart);
      const aliasSet = new Set<string>();
      const aliasRe = /\bas\s+([A-Za-z_][A-Za-z0-9_]*)/gi;
      let am: RegExpExecArray | null;
      while ((am = aliasRe.exec(aliasWindow)) !== null) aliasSet.add(am[1]);

      for (const s of strings) {
        // orderBy supports 'desc'/'asc' as 2nd arg — ignore them
        if (method === 'orderBy' && (s === 'desc' || s === 'asc' || s === 'DESC' || s === 'ASC')) continue;
        const ref = parseColumnRef(s);
        if (!ref) continue;
        // If the literal is qualified (table.col), check that pair directly.
        if (ref.table) {
          if (!tableSet.has(ref.table)) continue;  // alias or unknown — skip
          const refCols = snap.tables[ref.table];
          if (!refCols.includes(ref.column)) {
            const lineNo = src.substring(0, callStart).split('\n').length;
            violations.push({
              file, lineNo,
              kind: `.${method}('${s}')`,
              table: ref.table,
              ghostColumns: [ref.column],
              knownColumns: refCols,
              preview: src.substring(callStart, Math.min(callStart + 120, argInfo.endIndex + 1)).replace(/\s+/g, ' ').trim(),
            });
          }
        } else {
          // If this bare identifier matches a SELECT alias in the enclosing
          // statement, it's a valid ORDER BY / GROUP BY target — skip.
          if (aliasSet.has(ref.column)) continue;
          if (!colSet.has(ref.column)) {
            const lineNo = src.substring(0, callStart).split('\n').length;
            violations.push({
              file, lineNo,
              kind: `.${method}('${s}')`,
              table,
              ghostColumns: [ref.column],
              knownColumns: cols,
              preview: src.substring(callStart, Math.min(callStart + 120, argInfo.endIndex + 1)).replace(/\s+/g, ' ').trim(),
            });
          }
        }
      }
    }

    // Mode A' — object-form where
    objectArgCallRe.lastIndex = 0;
    while ((m = objectArgCallRe.exec(src)) !== null) {
      objectArgCalls++;
      const method = m[1];
      const callStart = m.index;
      const parenOpen = callStart + m[0].length - 1;
      if (isExempt(src, callStart)) { exempt++; continue; }
      const argInfo = extractArgument(src, parenOpen);
      if (!argInfo) { skippedComplexArg++; continue; }
      const lit = extractFirstObjectLiteral(argInfo.body);
      if (!lit) continue;
      if (lit.hasSpread || lit.hasDynamicKey) { skippedComplexArg++; continue; }
      if (lit.keys.length === 0) continue;
      const table = resolveBoundTable(src, callStart);
      if (!table) { skippedNoTable++; continue; }
      const cols = snap.tables[table];
      if (!cols) { skippedUnknownTable++; continue; }
      const colSet = new Set(cols);
      // Resolve each key: bare identifier → check on resolved table;
      //                   qualified <t>.<c> → check pair directly (knex
      //                   accepts this for joined queries).
      const ghost: string[] = [];
      let ghostTable = table;
      let ghostKnown = cols;
      for (const k of lit.keys) {
        if (k.includes('.')) {
          const [lhs, rhs] = k.split('.', 2);
          if (!tableSet.has(lhs)) continue;  // alias — skip
          const qc = snap.tables[lhs];
          if (!qc.includes(rhs)) {
            ghost.push(k);
            ghostTable = lhs;
            ghostKnown = qc;
          }
        } else {
          if (!colSet.has(k)) ghost.push(k);
        }
      }
      if (ghost.length > 0) {
        const lineNo = src.substring(0, callStart).split('\n').length;
        violations.push({
          file, lineNo,
          kind: `.${method}({...})`,
          table: ghostTable,
          ghostColumns: ghost,
          knownColumns: ghostKnown,
          preview: src.substring(callStart, Math.min(callStart + 120, argInfo.endIndex + 1)).replace(/\s+/g, ' ').trim(),
        });
      }
    }

    // Mode B — raw SQL with <table>.<col> references
    rawCallRe.lastIndex = 0;
    while ((m = rawCallRe.exec(src)) !== null) {
      rawCalls++;
      const callStart = m.index;
      const parenOpen = callStart + m[0].length - 1;
      if (isExempt(src, callStart)) { exempt++; continue; }
      const argInfo = extractArgument(src, parenOpen);
      if (!argInfo) { skippedComplexArg++; continue; }
      const tmpl = extractTemplateLiteral(argInfo.body);
      if (!tmpl) { skippedComplexArg++; continue; }  // arg is a variable or non-template string
      const sql = stripInterpolations(tmpl);

      // Find every <ident>.<ident> token. LHS must be a real table in snapshot.
      const refRe = /\b([A-Za-z_][A-Za-z0-9_]*)\.([A-Za-z_][A-Za-z0-9_]*)\b/g;
      let r: RegExpExecArray | null;
      const seen = new Set<string>();  // dedupe per-raw-call
      while ((r = refRe.exec(sql)) !== null) {
        const lhs = r[1], rhs = r[2];
        const key = `${lhs}.${rhs}`;
        if (seen.has(key)) continue;
        seen.add(key);
        if (!tableSet.has(lhs)) continue;  // alias / CTE / subquery — skip
        const refCols = snap.tables[lhs];
        if (!refCols.includes(rhs)) {
          const lineNo = src.substring(0, callStart).split('\n').length;
          violations.push({
            file, lineNo,
            kind: `raw SQL: ${lhs}.${rhs}`,
            table: lhs,
            ghostColumns: [rhs],
            knownColumns: refCols,
            preview: sql.substring(0, 120).replace(/\s+/g, ' ').trim(),
          });
        }
      }
    }
  }

  console.error(`\n→ check-query-builder-columns`);
  console.error(`  scan root:          ${relpath(SCAN_ROOT)}`);
  console.error(`  snapshot:           ${snap.generatedAt}  (${tableSet.size} tables)`);
  console.error(`  string-arg calls:   ${stringArgCalls}  (orderBy/groupBy/select/whereNull/whereIn/min/max/…)`);
  console.error(`  object-arg calls:   ${objectArgCalls}  (where/andWhere/orWhere/whereNot)`);
  console.error(`  raw SQL calls:      ${rawCalls}  (db.raw, trx.raw, .whereRaw, .havingRaw, .orderByRaw, .fromRaw, .joinRaw)`);
  console.error(`  skipped:`);
  console.error(`    no-table:           ${skippedNoTable}  (no resolvable db('<name>') binding)`);
  console.error(`    unknown-table:      ${skippedUnknownTable}  (table not in snapshot)`);
  console.error(`    complex-arg:        ${skippedComplexArg}  (non-literal arg — variable, fn call, or non-template string)`);
  console.error(`    exempt:             ${exempt}  (annotated @query-col-exempt)`);

  if (violations.length > 0) {
    console.error(`\n✗ FAIL: ${violations.length} ghost-column reference(s) detected:\n`);
    for (const v of violations) {
      console.error(`  ${relpath(v.file)}:${v.lineNo}`);
      console.error(`     form: ${v.kind}`);
      console.error(`     table: ${v.table}`);
      console.error(`     ghost columns: ${v.ghostColumns.join(', ')}`);
      for (const g of v.ghostColumns) {
        const stem = g.toLowerCase().replace(/[^a-z0-9]/g, '');
        const near = v.knownColumns.filter((c) =>
          c.toLowerCase().replace(/[^a-z0-9]/g, '').includes(stem) ||
          stem.includes(c.toLowerCase().replace(/[^a-z0-9]/g, '')),
        );
        if (near.length > 0 && near.length <= 5) {
          console.error(`       ${g}  →  did you mean: ${near.join(', ')}?`);
        }
      }
      console.error(`     preview: ${v.preview.substring(0, 100)}${v.preview.length > 100 ? '…' : ''}`);
      console.error('');
    }
    console.error(`Rule: CLAUDE.md §15 (ghost-column prevention) + Phase R follow-up D.1 guard.`);
    console.error(`Fix one of:`);
    console.error(`  1. Rename the column reference to match the actual column name.`);
    console.error(`  2. Add a migration that introduces the column.`);
    console.error(`  3. If the reference is intentional (e.g. alias from a view not in`);
    console.error(`     snapshot), annotate with // @query-col-exempt: <reason>.`);
    process.exit(1);
  }
  console.error(`\n✓ All query-builder column references + raw SQL table.column refs are real.\n`);
}

function relpath(p: string): string {
  return p.startsWith(ROOT) ? p.substring(ROOT.length + 1) : p;
}

main();
