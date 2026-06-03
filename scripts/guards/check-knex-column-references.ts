/**
 * PR-R1-13 — CI guard: Knex query-builder column-string references MUST
 * point at columns that exist on the bound table per `schema-snapshot.json`.
 *
 * Why this exists — NEW-S1-A/B/CASCADE-A/B (2026-04-30) closed the same
 * drift class repeatedly:
 *
 *   - NEW-S1-A   `lr.order_id` ghost (actual column: `pathology_order_id`)
 *   - NEW-S1-B   `m.recipient_id` ghost (column does not exist on messages)
 *   - CASCADE-A  `tasks.due_at` ghost (actual column: `due_date`)
 *   - CASCADE-B  `mtp.clinic_id` + `mtp.staff_id` ghost (clinic_id doesn't
 *                exist on message_thread_participants; participant is
 *                `user_id` not `staff_id`)
 *
 * Each was a runtime SQL error hidden in code that compiled cleanly. The
 * existing CLAUDE.md §15 row-interface guard (`check-row-interface-matches-db`)
 * catches drift in TypeScript Row interfaces but does NOT cover Knex
 * query-builder column-string references. PR-R1-13 closes the structural
 * gap by AST-walking every Knex builder call site under `apps/api/src/`
 * and validating every column reference against `schema-snapshot.json`.
 *
 * Patterns covered (single-guard scope per user direction Q1=a):
 *   1. `.where('alias.col', val)` / `.where({ 'alias.col': val })` / bare
 *      `.where('col', val)`
 *   2. `.whereRaw('col …')` — bare-column raw SQL fragments
 *   3. `.join('table as alias', 'a.col', 'b.col')` and siblings
 *      (.innerJoin / .leftJoin / .rightJoin / .fullOuterJoin)
 *      — note: BUG-637 (check-fk-aware-joins) already validates 3-arg
 *      JOIN FK-correctness; THIS guard validates column-existence on the
 *      same args (the two checks are complementary).
 *   4. `.orderBy('col')` / `.groupBy('col')` / `.having('col')`
 *   5. `.select('col as alias')` / `.distinct('col')` / `.distinctOn('col')`
 *      / `.returning('col')` / `.returning(['c1', 'c2'])`
 *   6. Raw SQL `JOIN ... ON a.col = b.col` inside `db.raw()` /
 *      `.whereRaw()` strings
 *   7. Multi-condition Knex JOINs `(j) => j.on(...).andOn(...)` —
 *      DEFERRED to PR-R1-13b when scope balloons (BUG-637-FOLLOWUP-MULTI-CONDITION
 *      already tracks this for FK-validation; same scope here).
 *
 * Two-stage validation:
 *
 *   Stage 1 (strict, zero false-positives):
 *     dotted form `<alias>.<col>` resolves alias → table via query-scoped
 *     alias map, then validates column membership via snapshot lookup.
 *
 *   Stage 2 (best-effort, narrow false-positive surface):
 *     bare-column `'col'` resolves against the bound table from the
 *     nearest enclosing `db('table')` opener. Common SQL fragments
 *     (`CURRENT_DATE`, `count(...)`, `sum(...)`, `*`, `json_*`, `concat(...)`)
 *     are whitelisted and skipped. Tokens with whitespace, parens, or
 *     non-identifier chars are also skipped.
 *
 * Allowlist:
 *   - Inline `// @knex-col-exempt: <reason>` on the line directly above
 *     the call site (REQUIRES non-empty reason per PR-R1-11 cycle-2 lesson)
 *   - File-level fingerprint allowlist `check-knex-column-references.allowlist`
 *     for grandfathered baseline drift (drains as files are touched)
 *
 * Scope:
 *   `apps/api/src/features/`
 *   `apps/api/src/mcp/`
 *   `apps/api/src/integrations/`
 *   `apps/api/src/jobs/`
 *
 *   Excludes `apps/api/src/middleware/` and `apps/api/src/shared/` per the
 *   PR-R1-5 precedent — those layers use raw pool primitives outside the
 *   db/dbRead/trx identifier convention.
 *
 * Mutation-resistant testing:
 *   `runGuard()` is exported for end-to-end invocation from vitest fixtures
 *   (sibling pattern of PR-R1-12 cycle-2). Internal helpers
 *   (`parseTableAlias`, `findQueryScopedAliases`, `resolveColRef`,
 *   `extractColumnRefsFromCall`) are also exported for unit tests.
 *
 * Exit codes:
 *   0 — every Knex column reference resolves to a real column
 *   1 — one or more ghost-column references detected
 *   2 — schema-snapshot.json malformed or missing
 */

import { readFileSync, readdirSync, statSync } from 'fs';
import { resolve, relative } from 'path';
import {
  loadAllowlist as loadFingerprintAllowlist,
  isAllowlisted as isAllowlistedFingerprint,
  fingerprint as fingerprintLine,
  getAllowlistedCount,
  type AllowlistEntry,
} from './lib/allowlist-fingerprint';

const ROOT = resolve(__dirname, '..', '..');
const DEFAULT_SNAPSHOT_PATH = resolve(ROOT, 'apps', 'api', 'src', 'db', 'schema-snapshot.json');
const DEFAULT_SCAN_ROOTS = [
  resolve(ROOT, 'apps', 'api', 'src', 'features'),
  resolve(ROOT, 'apps', 'api', 'src', 'mcp'),
  resolve(ROOT, 'apps', 'api', 'src', 'integrations'),
  resolve(ROOT, 'apps', 'api', 'src', 'jobs'),
];
const DEFAULT_ALLOWLIST_PATH = resolve(__dirname, 'check-knex-column-references.allowlist');

// SQL fragments that LOOK like bare-column refs but are SQL constructs.
// Each pattern is matched case-insensitively against the trimmed token.
// If a token matches ANY pattern, it's skipped (no validation attempted).
const SQL_FRAGMENT_WHITELIST_PATTERNS = [
  /^\*$/,                              // wildcard select
  /^current_(date|timestamp|time)$/i,  // SQL date-time constants
  /^now\s*\(/i,                         // function call
  /^count\s*\(/i,
  /^sum\s*\(/i,
  /^avg\s*\(/i,
  /^min\s*\(/i,
  /^max\s*\(/i,
  /^coalesce\s*\(/i,
  /^nullif\s*\(/i,
  /^extract\s*\(/i,
  /^date_part\s*\(/i,
  /^date_trunc\s*\(/i,
  /^to_char\s*\(/i,
  /^to_timestamp\s*\(/i,
  /^cast\s*\(/i,
  /^json_/i,
  /^jsonb_/i,
  /^concat\s*\(/i,
  /^array_/i,
  /^row_number\s*\(/i,
  /^rank\s*\(/i,
  /^lag\s*\(/i,
  /^lead\s*\(/i,
  /^string_agg\s*\(/i,
  /^bool_/i,
  /^lower\s*\(/i,
  /^upper\s*\(/i,
  /^length\s*\(/i,
  /^substring\s*\(/i,
  /^trim\s*\(/i,
  /^null$/i,                           // literal NULL
  /^true$/i,
  /^false$/i,
  /^DEFAULT$/,                         // SQL DEFAULT keyword
];

// Reserved Knex / aggregate-alias / SQL keyword tokens that are NOT column refs.
// Conservative whitelist — false-positives here mean we skip a real bug;
// false-negatives mean we flag a legitimate column. Bias is toward
// false-positives (skip) since the guard's value is in catching obvious
// drift, not in flagging every conceivable shape.
const KNEX_NON_COLUMN_TOKENS = new Set([
  // ordering directions
  'asc', 'desc', 'ASC', 'DESC',
  // common aggregate / count aliases (used in .groupBy / .orderBy after a
  // .select(db.raw('... as cnt')) — SQL alias, not column)
  'cnt', 'count', 'cat', 'total', 'sum', 'avg', 'min', 'max',
  // SQL CASE expression keywords (extracted from db.raw('CASE WHEN ... ELSE ... END as alias') strings)
  'CASE', 'WHEN', 'THEN', 'ELSE', 'END', 'AS',
  // SQL clause keywords
  'FROM', 'WHERE', 'GROUP', 'BY', 'HAVING', 'JOIN', 'ON', 'INNER', 'LEFT', 'RIGHT',
  'OUTER', 'FULL', 'CROSS', 'NATURAL', 'USING', 'UNION', 'INTERSECT', 'EXCEPT',
  // SQL operator keywords
  'OR', 'AND', 'NOT', 'IS', 'BETWEEN', 'LIKE', 'ILIKE', 'SIMILAR', 'IN', 'EXISTS',
  'ALL', 'ANY', 'SOME',
  // SQL DML keywords
  'SELECT', 'DISTINCT', 'INSERT', 'UPDATE', 'DELETE', 'INTO', 'VALUES', 'RETURNING',
  // SQL flow-control keywords
  'LIMIT', 'OFFSET', 'FETCH', 'ROW', 'ROWS', 'FIRST', 'NEXT', 'ONLY', 'FOR',
  'SHARE', 'NOWAIT', 'CASCADE', 'RESTRICT',
]);

interface SchemaSnapshot {
  generatedAt: string;
  database: string;
  tables: Record<string, string[]>;
  foreignKeys: Record<string, { foreignTable: string; foreignColumn: string }>;
}

export type ViolationKind =
  | 'where-string'
  | 'where-object-key'
  | 'whereRaw-bare-col'
  | 'join-arg'
  | 'orderBy'
  | 'groupBy'
  | 'having'
  | 'select'
  | 'distinct'
  | 'returning'
  | 'rawSQL-JOIN-ON';

export interface Violation {
  file: string;
  lineNo: number;
  kind: ViolationKind;
  table: string | null;
  column: string;
  preview: string;
  reason: string;
}

interface ScanCounts {
  validated: number;
  skippedNoSnapshot: number;
  skippedSqlFragment: number;
  skippedNoAlias: number;
  skippedExempt: number;
}

// ── helpers ────────────────────────────────────────────────────────────

export function parseTableAlias(spec: string): { table: string; alias: string } {
  const m = spec.match(/^(\S+)\s+as\s+(\S+)$/i);
  if (m) return { table: m[1], alias: m[2] };
  return { table: spec, alias: spec };
}

export function resolveColRef(
  ref: string,
  aliases: Map<string, string>,
): { table: string; column: string } | null {
  const m = ref.match(/^([\w$]+)\.([\w$]+)$/);
  if (!m) return null;
  const aliasOrTable = m[1];
  const col = m[2];
  const table = aliases.get(aliasOrTable) || aliasOrTable;
  return { table, column: col };
}

/**
 * Build a regex that matches Knex query openers — the canonical 4
 * identifiers (`db`, `dbRead`, `trx`, `dbAdmin`) PLUS any local aliases
 * bound via the `?? db` ternary idiom (PR-R1-13 cycle-2 absorb), PLUS
 * parenthesised forms like `(trx ?? db)('table')`.
 */
function buildOpenerRegex(extraAliases: Set<string>): RegExp {
  const aliasList = ['db', 'dbRead', 'trx', 'dbAdmin', ...extraAliases]
    .map((a) => a.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
    .join('|');
  // Branches:
  //   (a) bare identifier call: `db('table')` / `conn('table')` (with optional generic <Type>)
  //   (b) parenthesised ternary: `(trx ?? db)('table')`
  //   (c) `.from('table')` chained
  return new RegExp(
    `(?:\\b(?:${aliasList})(?:<[^<>(){}]+>)?\\s*\\(\\s*['"\`]([^'"\`]+)['"\`])` +
      `|(?:\\(\\s*[\\w$.]+\\s*\\?\\?\\s*(?:db|dbRead|trx|dbAdmin)\\s*\\)\\s*\\(\\s*['"\`]([^'"\`]+)['"\`])` +
      `|(?:\\.from\\s*\\(\\s*['"\`]([^'"\`]+)['"\`])`,
    'g',
  );
}

/**
 * Find aliases bound by Knex query openers (`db('foo as f')`, `dbRead(...)`,
 * `trx(...)`, `(trx ?? db)('foo as f')`, or any `.join('table as alias', ...)`)
 * within a 3000-char window before the call site. Prevents alias bleed across
 * queries in the same file. Sibling pattern of FK-aware-joins guard's
 * `findQueryScopedAliases`.
 *
 * Cycle-2 absorb: accepts `dbAliases` set so locally-bound aliases like
 * `const conn = connOrTrx ?? db;` are recognised as openers.
 */
export function findQueryScopedAliases(
  source: string,
  callIndex: number,
  dbAliases: Set<string> = new Set(),
): Map<string, string> {
  const aliases = new Map<string, string>();
  const QUERY_WINDOW = 3000;
  const start = Math.max(0, callIndex - QUERY_WINDOW);

  // Find the nearest enclosing query opener at or after `start`.
  const openerRe = buildOpenerRegex(dbAliases);
  openerRe.lastIndex = start;
  let lastOpener = -1;
  let m: RegExpExecArray | null;
  while ((m = openerRe.exec(source)) !== null) {
    if (m.index >= callIndex) break;
    lastOpener = m.index;
  }
  const scopeStart = lastOpener >= 0 ? lastOpener : start;
  const scope = source.slice(scopeStart, callIndex);

  // Scan the scope for table+alias declarations from any opener or join.
  // Supports generic-call syntax `db<TypeArg>('table')` so identifiers like
  // `db<FeeScheduleRow>('fee_schedules')` correctly bind the alias. Also
  // recognises locally-bound aliases (cycle-2) and parenthesised ternary
  // openers.
  const aliasList = ['db', 'dbRead', 'trx', 'dbAdmin', ...dbAliases]
    .map((a) => a.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
    .join('|');
  const tableRe = new RegExp(
    `(?:\\b(?:${aliasList})(?:<[^<>(){}]+>)?\\s*\\(\\s*['"\`]([^'"\`]+)['"\`])` +
      `|(?:\\(\\s*[\\w$.]+\\s*\\?\\?\\s*(?:db|dbRead|trx|dbAdmin)\\s*\\)\\s*\\(\\s*['"\`]([^'"\`]+)['"\`])` +
      `|(?:(?:\\.from|\\.innerJoin|\\.leftJoin|\\.rightJoin|\\.fullOuterJoin|\\.join)\\s*\\(\\s*['"\`]([^'"\`]+)['"\`])`,
    'g',
  );
  let mm: RegExpExecArray | null;
  while ((mm = tableRe.exec(scope)) !== null) {
    const spec = mm[1] || mm[2] || mm[3] || '';
    if (!spec) continue;
    const { table, alias } = parseTableAlias(spec);
    aliases.set(alias, table);
  }
  return aliases;
}

export interface VarBinding {
  position: number;
  varName: string;
  table: string;
}

/**
 * PR-R1-13 cycle-2 absorb (L3 REJECT #1): scan a file for local variables
 * bound to one of the canonical db identifiers via the `?? db` ternary
 * idiom (sibling pattern of BUG-602's `conn` parameter convention).
 *
 * Examples this catches:
 *   const conn = connOrTrx ?? db;
 *   const conn = trx ?? dbAdmin;
 *   conn = connOrTrx ?? dbRead;
 *
 * Without this, `conn('table')` calls in the same file are silently skipped
 * by the opener regex (which only knows the canonical 4 identifiers), and
 * downstream column refs misattribute to the previous opener within the
 * 3000-char window — producing false-positive ghost-column violations.
 */
export function findDbAliasIdentifiers(source: string): Set<string> {
  const aliases = new Set<string>();
  const re =
    /\b(?:const|let|var)\s+([\w$]+)\s*=\s*[\w$]+\s*\?\?\s*(?:db|dbRead|trx|dbAdmin)\b/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(source)) !== null) {
    aliases.add(m[1]);
  }
  return aliases;
}

/**
 * Build a per-file LIST of variable→table binding declarations, sorted by
 * position. A given variable name may appear multiple times (re-declared in
 * different scopes); resolution picks the most-recent declaration BEFORE the
 * call site (positional scope-emulation; not full TS scope analysis).
 *
 * Example: mcpServer.ts has 12 `const q = db('<diff-table>')...` declarations,
 * one per case-block. A `q.clone().where(...)` at line 418 must resolve to
 * the `q` declared at line 412 (`db('appointments')`), NOT the last `q`
 * declared in the file (line 494, `db('risk_assessments')`).
 */
export function buildVariableTableMap(source: string): VarBinding[] {
  const out: VarBinding[] = [];
  const re =
    /\b(?:const|let|var)\s+([\w$]+)\s*=\s*(?:await\s+)?(?:db|dbRead|trx|dbAdmin)(?:<[^<>(){}]+>)?\s*\(\s*['"`]([^'"`]+)['"`]/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(source)) !== null) {
    const varName = m[1];
    const { table } = parseTableAlias(m[2]);
    out.push({ position: m.index, varName, table });
  }
  return out;
}

/** Lookup the most recent declaration of `varName` BEFORE `callIndex`. */
export function lookupVarAtPosition(
  bindings: VarBinding[],
  varName: string,
  callIndex: number,
): string | null {
  let best: VarBinding | null = null;
  for (const b of bindings) {
    if (b.varName !== varName) continue;
    if (b.position >= callIndex) break;
    if (!best || b.position > best.position) best = b;
  }
  return best ? best.table : null;
}

/**
 * Find the bound table for a bare-column reference (no `alias.` prefix).
 *
 * Strategy (in order):
 *   1. If the call is `VAR.clone().X(...)` or `VAR.X(...)` and VAR is in
 *      the variable→table map, use VAR's table. Defends against subquery
 *      context-bleed (mcpServer.ts pattern: q = db('appointments');
 *      q.whereIn('id', db('episodes')...); q.clone().where(...)).
 *   2. Otherwise fall back to nearest enclosing opener within QUERY_WINDOW.
 */
export function resolveBoundTable(
  source: string,
  callIndex: number,
  varBindings?: VarBinding[],
  dbAliases: Set<string> = new Set(),
): string | null {
  // Step 1: try variable-binding lookup. Find the identifier immediately
  // preceding the call (after stripping .clone() and similar passthroughs).
  if (varBindings && varBindings.length > 0) {
    // Look back from callIndex for the chain root identifier.
    // Skip backward over chained calls like `.clone()`, `.where(...)`, etc.
    // Paren-depth tracking: walk past balanced `(...)` and `[...]` so the
    // walk doesn't stop inside a chained call's args.
    let i = callIndex;
    let parenDepth = 0;
    let bracketDepth = 0;
    while (i > 0) {
      const c = source[i - 1];
      if (c === ')') parenDepth++;
      else if (c === '(') {
        if (parenDepth === 0) break; // unmatched opener — chain root reached
        parenDepth--;
      } else if (c === ']') bracketDepth++;
      else if (c === '[') {
        if (bracketDepth === 0) break;
        bracketDepth--;
      } else if (parenDepth === 0 && bracketDepth === 0) {
        // Top-level stop chars: end of statement / assignment / comma / brace.
        if (c === '\n' || c === ';' || c === '=' || c === '{' || c === '}' || c === ',') break;
      }
      i--;
    }
    const chainStart = source.slice(i, callIndex);
    // Strip leading `await `, `return `, and `yield ` keywords so the chain-root
    // identifier is the first user-defined token. Otherwise `await q.clone()`
    // would not match q as the chain root.
    const chainStartCleaned = chainStart.replace(/^\s*(?:await|return|yield)\s+/, '');
    // First identifier in the chain is the chain root.
    const idMatch = chainStartCleaned.match(/^\s*([\w$]+)\s*[.(]/);
    if (idMatch) {
      const rootVar = idMatch[1];
      const t = lookupVarAtPosition(varBindings, rootVar, callIndex);
      if (t) return t;
    }
  }

  // Step 2: nearest enclosing opener.
  const QUERY_WINDOW = 3000;
  const start = Math.max(0, callIndex - QUERY_WINDOW);
  const openerRe = buildOpenerRegex(dbAliases);
  openerRe.lastIndex = start;
  let lastTable: string | null = null;
  let m: RegExpExecArray | null;
  while ((m = openerRe.exec(source)) !== null) {
    if (m.index >= callIndex) break;
    const spec = m[1] || m[2] || m[3] || '';
    if (spec) {
      const { table } = parseTableAlias(spec);
      lastTable = table;
    }
  }
  return lastTable;
}

function isSqlFragment(token: string): boolean {
  const t = token.trim();
  if (!t) return true;
  if (KNEX_NON_COLUMN_TOKENS.has(t)) return true;
  // Pure-digit tokens (e.g., `'1'` from `db.raw('1')` literals) are never columns.
  if (/^-?\d+(\.\d+)?$/.test(t)) return true;
  for (const pat of SQL_FRAGMENT_WHITELIST_PATTERNS) {
    if (pat.test(t)) return true;
  }
  // Anything containing whitespace, parens, or non-identifier punctuation
  // beyond a single dot is treated as a SQL fragment (not a column ref).
  if (/[\s(),;+\-*/%=<>!]/.test(t)) return true;
  return false;
}

function isBareColumnIdentifier(token: string): boolean {
  return /^[\w$]+$/.test(token);
}

function isDottedRef(token: string): boolean {
  return /^[\w$]+\.[\w$]+$/.test(token);
}

function lineNoOfIndex(lineOffsets: number[], idx: number): number {
  // binary search for line number from offset
  let lo = 0;
  let hi = lineOffsets.length - 2;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (idx >= lineOffsets[mid] && idx < lineOffsets[mid + 1]) return mid + 1;
    if (idx < lineOffsets[mid]) hi = mid - 1;
    else lo = mid + 1;
  }
  return 1;
}

function buildLineOffsets(source: string): number[] {
  const offsets = [0];
  for (let i = 0; i < source.length; i++) {
    if (source[i] === '\n') offsets.push(i + 1);
  }
  offsets.push(source.length + 1);
  return offsets;
}

function hasInlineExemption(source: string, lineNo: number, lineOffsets: number[]): boolean {
  if (lineNo < 2) return false;
  const prevLineStart = lineOffsets[lineNo - 2];
  const prevLineEnd = lineOffsets[lineNo - 1];
  const prevLine = source.slice(prevLineStart, prevLineEnd);
  // Require @knex-col-exempt: <reason> with non-empty reason after the colon
  return /@knex-col-exempt:\s*\S/.test(prevLine);
}

// ── pattern detectors ──────────────────────────────────────────────────

function classifyAndValidate(
  raw: string,
  aliases: Map<string, string>,
  boundTable: string | null,
  snapshot: SchemaSnapshot,
  counts: ScanCounts,
): { ok: true } | { ok: false; reason: string; column: string; table: string | null } {
  const trimmed = raw.trim();
  if (isSqlFragment(trimmed)) {
    counts.skippedSqlFragment++;
    return { ok: true };
  }
  if (isDottedRef(trimmed)) {
    const col = resolveColRef(trimmed, aliases);
    if (!col) {
      counts.skippedNoAlias++;
      return { ok: true };
    }
    if (!snapshot.tables[col.table]) {
      counts.skippedNoSnapshot++;
      return { ok: true };
    }
    if (!snapshot.tables[col.table].includes(col.column)) {
      return {
        ok: false,
        reason: `column '${col.column}' does NOT exist on table '${col.table}' per schema-snapshot.json`,
        column: col.column,
        table: col.table,
      };
    }
    counts.validated++;
    return { ok: true };
  }
  if (isBareColumnIdentifier(trimmed) && boundTable) {
    if (!snapshot.tables[boundTable]) {
      counts.skippedNoSnapshot++;
      return { ok: true };
    }
    if (!snapshot.tables[boundTable].includes(trimmed)) {
      return {
        ok: false,
        reason: `column '${trimmed}' does NOT exist on table '${boundTable}' per schema-snapshot.json`,
        column: trimmed,
        table: boundTable,
      };
    }
    counts.validated++;
    return { ok: true };
  }
  // Token isn't a recognised column-ref shape (and not bound to a table).
  // Skip silently — Stage 2 best-effort cannot validate without a binding.
  counts.skippedNoAlias++;
  return { ok: true };
}

interface MatchPattern {
  re: RegExp;
  kind: ViolationKind;
  /** Extract column-ref tokens from a regex match. Returns array of strings (tokens). */
  extractTokens: (match: RegExpExecArray) => string[];
}

const PATTERNS: MatchPattern[] = [
  // (1) .where('alias.col', val) — single-column form
  // Match: .where('text', ...) where text is a column-ref-shaped token.
  {
    re: /\.(where|whereNot|whereNull|whereNotNull|whereIn|whereNotIn|andWhere|orWhere|whereBetween|whereNotBetween)\s*\(\s*['"`]([^'"`]+)['"`]/g,
    kind: 'where-string',
    extractTokens: (m) => [m[2]],
  },
  // (3) .join('t', 'a.col', 'b.col') — 3-arg form (FK guard validates FK; we validate column existence)
  {
    re: /\.(innerJoin|leftJoin|rightJoin|fullOuterJoin|join)\s*\(\s*['"`][^'"`]+['"`]\s*,\s*['"`]([^'"`]+)['"`]\s*,\s*['"`]([^'"`]+)['"`]\s*\)/g,
    kind: 'join-arg',
    extractTokens: (m) => [m[2], m[3]],
  },
  // (4) .orderBy / .groupBy / .having — single-string form
  {
    re: /\.(orderBy|groupBy|orderByRaw|groupByRaw|having|havingRaw)\s*\(\s*['"`]([^'"`]+)['"`]/g,
    kind: 'orderBy',
    extractTokens: (m) => [m[2]],
  },
  // (5) .returning('col') / .distinct('col') / .distinctOn('col') — single-string form
  {
    re: /\.(returning|distinct|distinctOn)\s*\(\s*['"`]([^'"`]+)['"`]/g,
    kind: 'returning',
    extractTokens: (m) => [m[2]],
  },
];

// Pattern (5b): .select('col1', 'col2', ...) or .select(['c1', 'c2'])
// Multi-arg select needs special handling — we extract all string-literal args
// from the call's argument list.
const SELECT_RE = /\.select\s*\(([^)]*)\)/g;

// Pattern (1b): .where({ key: val, ... }) — object-key form
// We match the .where( call and a balanced {...} arg, then extract keys.
const WHERE_OBJECT_RE = /\.(where|whereNot|andWhere|orWhere)\s*\(\s*\{([^{}]*?)\}\s*\)/g;

// Pattern (2): .whereRaw('col < CURRENT_DATE') — bare-column raw SQL
// We extract the raw SQL string and scan for `<col>` or `<alias>.<col>` tokens
// that aren't followed by `(` (which would make them functions).
const WHERE_RAW_RE = /\.whereRaw\s*\(\s*['"`]([^'"`]+)['"`]/g;

// Pattern (6): db.raw(`... JOIN <table> ON <a>.<col> = <b>.<col>`) — raw SQL JOIN-ON
const RAW_SQL_JOIN_ON_RE = /JOIN\s+\w+(?:\s+(?:as\s+)?\w+)?\s+ON\s+([\w$]+\.[\w$]+)\s*=\s*([\w$]+\.[\w$]+)/gi;

function extractObjectKeys(body: string): string[] {
  // Quick best-effort: extract identifiers that appear before `:` at top level
  // of the object. Strip nested {...} bodies first.
  const flat = body.replace(/\{[^{}]*\}/g, '');
  const out: string[] = [];
  const re = /(?:^|,)\s*['"`]?([\w$.]+)['"`]?\s*:/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(flat)) !== null) {
    out.push(m[1]);
  }
  return out;
}

function extractWhereRawTokens(rawSql: string): string[] {
  // Strip `${...}` interpolations so they don't appear as tokens.
  const stripped = rawSql.replace(/\$\{[^}]*\}/g, ' ');
  const out: string[] = [];
  // Find dotted references like `alias.col` not followed by (
  const dottedRe = /\b([\w$]+\.[\w$]+)\b(?!\s*\()/g;
  let m: RegExpExecArray | null;
  while ((m = dottedRe.exec(stripped)) !== null) {
    out.push(m[1]);
  }
  // Additionally, find bare-column tokens at the START of the string (common
  // form: `whereRaw('due_at < CURRENT_DATE')`). Restrict to the first token
  // of the string to avoid false-positives on later words.
  const firstTokenMatch = stripped.trim().match(/^([\w$]+)\s*(<|>|<=|>=|=|<>|!=|\bIS\b|\bIN\b|\bBETWEEN\b)/i);
  if (firstTokenMatch && !out.some((t) => t.split('.').pop() === firstTokenMatch[1])) {
    out.push(firstTokenMatch[1]);
  }
  return out;
}

function extractSelectArgs(body: string): string[] {
  // Body is the inside of .select(...). Extract all string-literal args
  // (top-level, not inside function calls or arrays of objects).
  // Skip if the body contains a raw-SQL builder call — the developer has
  // explicitly opted into SQL responsibility there. Reduces false-positives
  // from CASE WHEN ... ELSE ... END as alias strings.
  if (/\b(?:db|dbRead|trx|dbAdmin|knex)\.raw\s*\(|\.raw\s*\(/.test(body)) return [];
  const out: string[] = [];
  const stringRe = /['"`]([^'"`]+)['"`]/g;
  let m: RegExpExecArray | null;
  while ((m = stringRe.exec(body)) !== null) {
    // Strip ' as alias' suffix — the LHS is the column ref.
    const raw = m[1].replace(/\s+as\s+[\w$]+$/i, '').trim();
    if (raw) out.push(raw);
  }
  return out;
}

// ── file scanner ───────────────────────────────────────────────────────

/**
 * Strip line-comments (`// ...` to end of line) and block-comments
 * (`/* ... *\/`) by replacing their content with spaces. This preserves
 * line-offset structure so line numbers stay accurate, but prevents
 * false-positives on commented-out code (e.g.,
 * `// .whereNull('deleted_at')`). Strings are NOT stripped.
 */
function stripCommentsPreservingLayout(source: string): string {
  let out = '';
  let i = 0;
  const n = source.length;
  let inSingle = false;
  let inDouble = false;
  let inTemplate = false;
  while (i < n) {
    const c = source[i];
    const nx = source[i + 1];
    if (!inSingle && !inDouble && !inTemplate && c === '/' && nx === '/') {
      // line comment — replace with spaces until newline
      out += '  ';
      i += 2;
      while (i < n && source[i] !== '\n') {
        out += source[i] === '\n' ? '\n' : ' ';
        i++;
      }
      continue;
    }
    if (!inSingle && !inDouble && !inTemplate && c === '/' && nx === '*') {
      // block comment — replace with spaces, preserve newlines
      out += '  ';
      i += 2;
      while (i < n - 1 && !(source[i] === '*' && source[i + 1] === '/')) {
        out += source[i] === '\n' ? '\n' : ' ';
        i++;
      }
      if (i < n - 1) {
        out += '  ';
        i += 2;
      }
      continue;
    }
    if (!inDouble && !inTemplate && c === "'" && source[i - 1] !== '\\') inSingle = !inSingle;
    else if (!inSingle && !inTemplate && c === '"' && source[i - 1] !== '\\') inDouble = !inDouble;
    else if (!inSingle && !inDouble && c === '`' && source[i - 1] !== '\\') inTemplate = !inTemplate;
    out += c;
    i++;
  }
  return out;
}

function checkFile(
  file: string,
  rawSource: string,
  snapshot: SchemaSnapshot,
  allow: AllowlistEntry[],
  counts: ScanCounts,
  violationBuckets: Map<string, number>,
): Violation[] {
  const source = stripCommentsPreservingLayout(rawSource);
  // Keep raw source line offsets for inline-exemption check (the @knex-col-exempt
  // comment lives in raw source and is stripped from `source`).
  const rawLineOffsets = buildLineOffsets(rawSource);
  const violations: Violation[] = [];
  const relFile = relative(ROOT, file);
  const lineOffsets = buildLineOffsets(source);
  const lines = rawSource.split('\n');
  const varBindings = buildVariableTableMap(source);
  // Cycle-2 absorb (L3 REJECT #1): collect locally-bound db-aliases via
  // the `?? db` ternary idiom so `conn('table')` calls in BUG-602-pattern
  // repositories (e.g., referralRepository.ts) are recognised as openers.
  const dbAliases = findDbAliasIdentifiers(source);

  function maybeRecord(
    callIdx: number,
    kind: ViolationKind,
    res: ReturnType<typeof classifyAndValidate>,
  ): void {
    if (res.ok) return;
    const lineNo = lineNoOfIndex(lineOffsets, callIdx);
    // Check inline exemption on the RAW source (the `// @knex-col-exempt:`
    // comment was stripped from `source`); raw line numbers map 1:1 with
    // stripped line numbers because the stripper preserves layout.
    if (hasInlineExemption(rawSource, lineNo, rawLineOffsets)) {
      counts.skippedExempt++;
      return;
    }
    const fullLine = lines[lineNo - 1] || '';
    const preview = fullLine.trim().slice(0, 180);

    // Allowlist multiplicity check (PR-R1-1.5 cycle-2 pattern)
    if (isAllowlistedFingerprint(relFile, lineNo, fullLine, allow)) {
      const fp = fingerprintLine(fullLine);
      if (fp) {
        const key = `${relFile}|${fp}`;
        violationBuckets.set(key, (violationBuckets.get(key) || 0) + 1);
        const allowed = getAllowlistedCount(relFile, fp, allow);
        if ((violationBuckets.get(key) || 0) > allowed) {
          violations.push({
            file: relFile,
            lineNo,
            kind,
            table: res.table,
            column: res.column,
            preview,
            reason: `over-count: ${violationBuckets.get(key)} occurrences vs ${allowed} allowlisted (fingerprint ${fp}). ${res.reason}`,
          });
        }
      }
      return;
    }

    violations.push({
      file: relFile,
      lineNo,
      kind,
      table: res.table,
      column: res.column,
      preview,
      reason: res.reason,
    });
  }

  // ── Standard patterns (1, 3, 4, 5-returning) ─────────────────────────
  for (const pat of PATTERNS) {
    pat.re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = pat.re.exec(source)) !== null) {
      const tokens = pat.extractTokens(m);
      const aliases = findQueryScopedAliases(source, m.index, dbAliases);
      const boundTable = resolveBoundTable(source, m.index, varBindings, dbAliases);
      for (const tok of tokens) {
        const res = classifyAndValidate(tok, aliases, boundTable, snapshot, counts);
        maybeRecord(m.index, pat.kind, res);
      }
    }
  }

  // ── .select(...) — variable-arity ───────────────────────────────────
  SELECT_RE.lastIndex = 0;
  let sm: RegExpExecArray | null;
  while ((sm = SELECT_RE.exec(source)) !== null) {
    const args = extractSelectArgs(sm[1]);
    if (args.length === 0) continue;
    const aliases = findQueryScopedAliases(source, sm.index, dbAliases);
    const boundTable = resolveBoundTable(source, sm.index, varBindings, dbAliases);
    for (const tok of args) {
      const res = classifyAndValidate(tok, aliases, boundTable, snapshot, counts);
      maybeRecord(sm.index, 'select', res);
    }
  }

  // ── .where({ key: val, ... }) — object-key form ──────────────────────
  WHERE_OBJECT_RE.lastIndex = 0;
  let om: RegExpExecArray | null;
  while ((om = WHERE_OBJECT_RE.exec(source)) !== null) {
    const keys = extractObjectKeys(om[2]);
    const aliases = findQueryScopedAliases(source, om.index, dbAliases);
    const boundTable = resolveBoundTable(source, om.index, varBindings, dbAliases);
    for (const k of keys) {
      const res = classifyAndValidate(k, aliases, boundTable, snapshot, counts);
      maybeRecord(om.index, 'where-object-key', res);
    }
  }

  // ── .whereRaw('...') — bare-column raw SQL ──────────────────────────
  WHERE_RAW_RE.lastIndex = 0;
  let wm: RegExpExecArray | null;
  while ((wm = WHERE_RAW_RE.exec(source)) !== null) {
    const tokens = extractWhereRawTokens(wm[1]);
    const aliases = findQueryScopedAliases(source, wm.index, dbAliases);
    const boundTable = resolveBoundTable(source, wm.index, varBindings, dbAliases);
    for (const tok of tokens) {
      const res = classifyAndValidate(tok, aliases, boundTable, snapshot, counts);
      maybeRecord(wm.index, 'whereRaw-bare-col', res);
    }
  }

  // ── Raw SQL JOIN ... ON a.col = b.col inside db.raw() / .raw() ──────
  // Search for raw() / .raw() arg strings; extract JOIN-ON pairs.
  const RAW_CALL_RE = /(?:\b(?:db|dbRead|trx|dbAdmin)\.raw|\.raw|knex\.raw)\s*\(\s*[`'"]([^`'"]+)[`'"]/g;
  let rm: RegExpExecArray | null;
  while ((rm = RAW_CALL_RE.exec(source)) !== null) {
    const sql = rm[1];
    const aliases = findQueryScopedAliases(source, rm.index, dbAliases);
    let jm: RegExpExecArray | null;
    RAW_SQL_JOIN_ON_RE.lastIndex = 0;
    while ((jm = RAW_SQL_JOIN_ON_RE.exec(sql)) !== null) {
      for (const tok of [jm[1], jm[2]]) {
        const res = classifyAndValidate(tok, aliases, null, snapshot, counts);
        maybeRecord(rm.index, 'rawSQL-JOIN-ON', res);
      }
    }
  }

  return violations;
}

// ── runner (exported for tests) ────────────────────────────────────────

export interface RunGuardOpts {
  snapshotPath?: string;
  scanRoots?: string[];
  allowlistPath?: string;
}

export interface RunGuardResult {
  exitCode: 0 | 1 | 2;
  violations: Violation[];
  counts: ScanCounts;
  filesScanned: number;
  allowlistEntries: number;
}

function walkTs(dir: string, out: string[] = []): string[] {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return out;
  }
  for (const entry of entries) {
    const full = resolve(dir, entry);
    const s = statSync(full);
    if (s.isDirectory()) {
      if (entry === 'node_modules' || entry === 'dist' || entry === '__tests__') continue;
      walkTs(full, out);
    } else if (
      entry.endsWith('.ts') &&
      !entry.endsWith('.d.ts') &&
      !entry.endsWith('.test.ts') &&
      !entry.endsWith('.spec.ts')
    ) {
      out.push(full);
    }
  }
  return out;
}

export function runGuard(opts: RunGuardOpts = {}): RunGuardResult {
  const snapshotPath = opts.snapshotPath ?? DEFAULT_SNAPSHOT_PATH;
  const scanRoots = opts.scanRoots ?? DEFAULT_SCAN_ROOTS;
  const allowlistPath = opts.allowlistPath ?? DEFAULT_ALLOWLIST_PATH;

  let snapshot: SchemaSnapshot;
  try {
    snapshot = JSON.parse(readFileSync(snapshotPath, 'utf-8'));
  } catch (_err) {
    return {
      exitCode: 2,
      violations: [],
      counts: { validated: 0, skippedNoSnapshot: 0, skippedSqlFragment: 0, skippedNoAlias: 0, skippedExempt: 0 },
      filesScanned: 0,
      allowlistEntries: 0,
    };
  }
  if (!snapshot.tables || Object.keys(snapshot.tables).length === 0) {
    return {
      exitCode: 2,
      violations: [],
      counts: { validated: 0, skippedNoSnapshot: 0, skippedSqlFragment: 0, skippedNoAlias: 0, skippedExempt: 0 },
      filesScanned: 0,
      allowlistEntries: 0,
    };
  }

  const allow = loadFingerprintAllowlist(allowlistPath);
  const files: string[] = [];
  for (const root of scanRoots) {
    walkTs(root, files);
  }
  const counts: ScanCounts = {
    validated: 0,
    skippedNoSnapshot: 0,
    skippedSqlFragment: 0,
    skippedNoAlias: 0,
    skippedExempt: 0,
  };
  const violationBuckets = new Map<string, number>();
  const allViolations: Violation[] = [];

  for (const file of files) {
    const source = readFileSync(file, 'utf-8');
    const v = checkFile(file, source, snapshot, allow, counts, violationBuckets);
    allViolations.push(...v);
  }

  return {
    exitCode: allViolations.length > 0 ? 1 : 0,
    violations: allViolations,
    counts,
    filesScanned: files.length,
    allowlistEntries: allow.length,
  };
}

// ── CLI entry ──────────────────────────────────────────────────────────

function main(): void {
  const result = runGuard();

  // eslint-disable-next-line no-console
  console.log('→ check-knex-column-references (PR-R1-13; CLAUDE.md §1.1 + §15)');
  // eslint-disable-next-line no-console
  console.log(`  snapshot:   ${relative(ROOT, DEFAULT_SNAPSHOT_PATH)}`);
  // eslint-disable-next-line no-console
  console.log(`  allowlist:  ${relative(ROOT, DEFAULT_ALLOWLIST_PATH)} (${result.allowlistEntries} entries)`);
  // eslint-disable-next-line no-console
  console.log(`  scanned:    ${result.filesScanned} ts file(s)`);

  if (result.exitCode === 2) {
    // eslint-disable-next-line no-console
    console.error(`✗ schema-snapshot.json read failed or empty. Regenerate with \`npm run db:snapshot --workspace=apps/api\`.`);
    process.exit(2);
  }

  // eslint-disable-next-line no-console
  console.log(`\n  validated:           ${result.counts.validated}  (column refs resolved against snapshot)`);
  // eslint-disable-next-line no-console
  console.log(`  skipped sql-fragment: ${result.counts.skippedSqlFragment}  (CURRENT_DATE / count() / sum() / etc.)`);
  // eslint-disable-next-line no-console
  console.log(`  skipped no-snapshot:  ${result.counts.skippedNoSnapshot}  (table not in snapshot — likely CTE/subquery)`);
  // eslint-disable-next-line no-console
  console.log(`  skipped no-alias:     ${result.counts.skippedNoAlias}  (token shape ambiguous, no bound table)`);
  // eslint-disable-next-line no-console
  console.log(`  skipped exempt:       ${result.counts.skippedExempt}  (// @knex-col-exempt:)`);

  if (result.violations.length === 0) {
    // eslint-disable-next-line no-console
    console.log('\n✓ Every Knex column reference resolves to a real column.');
    process.exit(0);
  }

  // eslint-disable-next-line no-console
  console.error(`\n✗ ${result.violations.length} ghost-column reference(s) detected:\n`);
  for (const v of result.violations) {
    // eslint-disable-next-line no-console
    console.error(`  ${v.file}:${v.lineNo}  [${v.kind}]  ${v.table ?? '<no-table>'}.${v.column}`);
    // eslint-disable-next-line no-console
    console.error(`    reason: ${v.reason}`);
    // eslint-disable-next-line no-console
    console.error(`    preview: ${v.preview}`);
  }
  // eslint-disable-next-line no-console
  console.error(
    '\nFix shape: rename the column to match schema-snapshot.json. If the reference is intentional (subquery alias / CTE table / computed name), add `// @knex-col-exempt: <reason>` on the line directly above OR add `<file> <fingerprint>  # comment` to scripts/guards/check-knex-column-references.allowlist.',
  );
  process.exit(1);
}

if (require.main === module) main();
