/**
 * scripts/generate-types/parser.ts
 *
 * Phase 0b.1b-i — extracted from `scripts/generate-types-from-migrations.ts`
 * per L5 0b.1a advisory #2 (god-file split — was 715 LOC, above 600 LOC WARN).
 * Re-export contract verified by the umbrella test suite — see fix-registry
 * row R-FIX-PHASE-0B.1B-I-GOD-FILE-SPLIT for the absorb-2 test count + the
 * commit body for the quoted command output.
 *
 * RESPONSIBILITY: parse Knex migration source into discrete events
 * (createTable / alterTable / dropTable) + extract column declarations
 * + modifiers from each event body.
 *
 * Phase 0b.1b-i absorbs L5 0b.1a advisory #1 (silent-skip-on-unparseable).
 * `findTableEvents` accepts an optional `onFailure` callback fired when
 * `extractCallbackBody` returns null (unbalanced braces / malformed migration).
 * Default behavior (no callback) emits `console.warn` for backward compat;
 * the driver passes a failure-collector callback so it can hard-fail in
 * full-run mode (gold-standard per L3 absorb-2 + operator authorization
 * 2026-05-04: warn in --dry-run, process.exit(1) in full-run).
 *
 * Phase 0b.1b-i absorbs L5 0b.1a advisory #3 (decimal precision):
 * `parseBuilderBody` now extracts the (precision, scale) tuple from
 * `t.decimal('col', N, M)`. Captured in `ColumnDef.decimalPrecision` +
 * `decimalScale`; emitter consumes for `z.string().regex(...)`.
 */

export type KnexColumnType =
  | 'uuid'
  | 'string'
  | 'text'
  | 'integer'
  | 'bigInteger'
  | 'boolean'
  | 'date'
  | 'timestamp'
  | 'time'
  | 'jsonb'
  | 'json'
  | 'decimal'
  | 'specificType'
  | 'unknown';

export interface ColumnDef {
  readonly name: string;
  readonly knexType: KnexColumnType;
  readonly nullable: boolean;
  readonly hasDefault: boolean;
  readonly isPrimary: boolean;
  readonly references?: { table: string; column: string };
  readonly stringMaxLength?: number; // from t.string('col', N)
  readonly specificTypeRaw?: string; // from t.specificType('col', 'pg_type')
  readonly decimalPrecision?: number; // from t.decimal('col', N, M) — Phase 0b.1b-i
  readonly decimalScale?: number;
}

export interface ParseEvent {
  readonly kind: 'createTable' | 'alterTable' | 'dropTable';
  readonly tableName: string;
  readonly bodySource: string; // empty for dropTable (no callback)
  readonly migrationFile: string;
}

/**
 * Phase 0b.1b-i absorb-2 of L5 0b.1a advisory #1: failure record for
 * unparseable callback bodies. Driver collects these via the optional
 * `onFailure` callback to `findTableEvents` and decides warn-vs-hard-fail
 * based on `--dry-run` flag.
 */
export interface ParseFailure {
  readonly migrationFile: string;
  readonly kind: 'createTable' | 'alterTable';
  readonly tableName: string;
  readonly reason: string;
}

export const KNEX_COLUMN_TYPES: readonly KnexColumnType[] = [
  'uuid', 'string', 'text', 'integer', 'bigInteger', 'boolean',
  'date', 'timestamp', 'time', 'jsonb', 'json', 'decimal',
];

const SKIP_BUILDER_METHODS = new Set([
  'index', 'unique', 'foreign', 'dropIndex', 'dropUnique', 'dropForeign',
  'primary', 'inherits', 'comment', 'engine', 'charset', 'collate',
]);

/**
 * Phase 0b.1b-ii-A absorb (2026-05-04): scope event detection to the body of
 * `export async function up(knex: ...): Promise<void> { ... }` only. Without
 * this, `dropTableIfExists` calls in `down()` (the rollback path) are treated
 * as in-band events and silently remove tables from the post-replay state.
 * Pre-fix: 34 real tables (scribe_*, letters/letter_*, capacity_assessments,
 * clinic_settings, llm_prompts_outputs, model_*, etc.) were silently dropped
 * by their own rollback hooks. Returns null when no `up` function found
 * (caller treats as "no events"; preserves silent-skip semantics for non-
 * migration source like extension files).
 */
export function extractUpFunctionBody(source: string): string | null {
  const upRegex = /export\s+async\s+function\s+up\s*\([^)]*\)\s*:\s*Promise<[^>]*>\s*\{/;
  const m = upRegex.exec(source);
  if (!m) return null;
  const bodyStart = m.index + m[0].length;
  return extractCallbackBody(source, bodyStart);
}

/**
 * Phase 0b.1b-ii-A absorb (2026-05-04, operator-authorized): parse top-level
 * `const <NAME> = '<table>';` (or `"..."` / `\`...\``) bindings from the source.
 * Used by `findTableEvents` to resolve `createTable(TABLE, ...)` to the
 * literal `'llm_prompts_outputs'` (the one production migration that uses
 * a const-bound table name). Operator-scoped: only plain string-literal
 * RHS; identifier-bound consts (`const TABLE = OTHER`) and call-expression
 * RHS (`const TABLE = makeTableName('x')`) are NOT resolved — those will
 * fall through to the "binding not a plain string" fail-loud path in
 * `findTableEvents`.
 */
export function parseTopLevelStringConsts(source: string): Map<string, string> {
  const bindings = new Map<string, string>();
  // (?:^|\n) anchors at line start so we don't match inside other expressions.
  // export-prefix optional. Only single-line plain-string-literal RHS.
  const re = /(?:^|\n)\s*(?:export\s+)?const\s+([A-Za-z_$][\w$]*)\s*=\s*['"`]([a-z_][a-z0-9_]*)['"`]\s*;/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(source)) !== null) {
    bindings.set(m[1], m[2]);
  }
  return bindings;
}

/**
 * Phase 0b.1b-ii-A absorb (2026-05-04, operator-authorized): parse top-level
 * `const X = ['a', 'b', 'c'] as const;` (or without `as const`) bindings to
 * support batch-alter migrations like BUG-371 that use a for-of loop over a
 * top-level string array. All array elements must be plain string literals
 * matching the [a-z_][a-z0-9_]* table-name shape; arrays containing any
 * non-literal element are NOT registered (fail-loud propagates downstream).
 */
export function parseTopLevelStringArrayConsts(source: string): Map<string, string[]> {
  const bindings = new Map<string, string[]>();
  const re = /(?:^|\n)\s*(?:export\s+)?const\s+([A-Za-z_$][\w$]*)\s*=\s*\[([^\]]+)\](?:\s+as\s+const)?\s*;/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(source)) !== null) {
    const name = m[1];
    const itemsRaw = m[2];
    const parts = itemsRaw.split(',').map((s) => s.trim()).filter(Boolean);
    const items: string[] = [];
    let allLiterals = true;
    for (const part of parts) {
      const litMatch = /^['"`]([a-z_][a-z0-9_]*)['"`]$/.exec(part);
      if (!litMatch) {
        allLiterals = false;
        break;
      }
      items.push(litMatch[1]);
    }
    if (allLiterals && items.length > 0) bindings.set(name, items);
  }
  return bindings;
}

/**
 * Phase 0b.1b-ii-A absorb (2026-05-04, operator-authorized): pre-process the
 * up() body to expand `for (const X of CONST_NAME) { BODY }` loops where
 * `CONST_NAME` is a top-level `const CONST_NAME = ['a', 'b', 'c'] as const`.
 * Each loop iteration becomes a synthetic copy of BODY with the bare-word
 * `X` token replaced by the quoted string literal. The createTable/alterTable
 * regex walk then sees the expanded form. Non-string-array `for-of` patterns
 * are left in place untouched (fail-loud propagates downstream when the
 * parser encounters the unresolved identifier).
 */
export function expandForOfLoops(upBody: string, arrayBindings: Map<string, string[]>): string {
  let result = '';
  let cursor = 0;
  const forRegex = /for\s*\(\s*const\s+([A-Za-z_$][\w$]*)\s+of\s+([A-Za-z_$][\w$]*)\s*\)\s*\{/;
  while (cursor < upBody.length) {
    const remaining = upBody.slice(cursor);
    const m = forRegex.exec(remaining);
    if (!m) break;
    const matchAbsoluteStart = cursor + m.index;
    const matchAbsoluteEnd = matchAbsoluteStart + m[0].length;
    const loopVarName = m[1];
    const arrayConstName = m[2];
    const items = arrayBindings.get(arrayConstName);
    if (!items) {
      // Not a recognized string-array binding; leave loop as-is.
      result += upBody.slice(cursor, matchAbsoluteEnd);
      cursor = matchAbsoluteEnd;
      continue;
    }
    const body = extractCallbackBody(upBody, matchAbsoluteEnd);
    if (body === null) {
      // Malformed loop body; bail out without further expansion.
      result += upBody.slice(cursor);
      return result;
    }
    const bodyEnd = matchAbsoluteEnd + body.length + 1; // +1 to step past closing `}`
    result += upBody.slice(cursor, matchAbsoluteStart);
    const wordRegex = new RegExp(`(?<![A-Za-z0-9_$])${loopVarName}(?![A-Za-z0-9_$])`, 'g');
    for (const item of items) {
      const expanded = body.replace(wordRegex, `'${item}'`);
      result += expanded + '\n';
    }
    cursor = bodyEnd;
  }
  result += upBody.slice(cursor);
  return result;
}

/**
 * Find each `knex.schema.{createTable,alterTable,dropTable}(...)` event in a
 * migration source. Returns one ParseEvent per opener.
 *
 * Phase 0b.1b-ii-A: scoped to `up()` body only via `extractUpFunctionBody`
 * (absorbs the 34-table silent-drop class — see helper docstring above).
 *
 * Phase 0b.1b-i absorb of L5 0b.1a advisory #1 (refined in absorb-2):
 * the silent-skip class is now reported via `onFailure` callback if the
 * caller supplies one (driver does this so it can hard-fail in full-run
 * mode per operator-authorized gold-standard 2026-05-04). If no callback
 * is supplied (legacy callers + tests of the warn path), falls back to
 * `console.warn` for backward compat.
 */
export function findTableEvents(
  source: string,
  migrationFile: string,
  onFailure?: (failure: ParseFailure) => void,
): ParseEvent[] {
  const events: ParseEvent[] = [];
  // Phase 0b.1b-ii-A: only inspect the up() body. A migration file without
  // an `export async function up(...)` declaration (or with unbalanced braces
  // in up()) is a parse failure (not a silent-skip): treat the same as a
  // null callback body per advisory #1 — route to onFailure callback if
  // supplied (driver decides hard-fail vs warn), else fall back to console.warn.
  const upBody = extractUpFunctionBody(source);
  if (upBody === null) {
    const reason = 'no balanced `export async function up(...)` declaration found';
    if (onFailure) {
      onFailure({ migrationFile, kind: 'createTable', tableName: '<file>', reason });
    } else {
      // eslint-disable-next-line no-console
      console.warn(
        `[generate-types/parser] WARN: ${migrationFile}: ${reason}. File SKIPPED.`,
      );
    }
    return events;
  }

  // Phase 0b.1b-ii-A: parse top-level string consts so `createTable(TABLE, ...)`
  // resolves to the underlying string literal. Operator-scoped: same-file
  // resolution only, plain-string RHS only.
  const bindings = parseTopLevelStringConsts(source);

  // Phase 0b.1b-ii-A: expand `for (const X of CONST_ARRAY) { ... }` loops in
  // up() body into N synthetic copies (one per array element). Covers the
  // BUG-371 batch-alter pattern (lock_version added to 3 prescribing tables).
  const arrayBindings = parseTopLevelStringArrayConsts(source);
  const expandedBody = expandForOfLoops(upBody, arrayBindings);

  /**
   * Resolve the captured table-name token (either a quoted literal or an
   * identifier) to a plain table name. Returns null + fires fail-loud when
   * an identifier is used but no plain-string-literal binding exists.
   */
  const resolveTableName = (token: string, kind: 'createTable' | 'alterTable' | 'dropTable'): string | null => {
    // Quoted literal: 'foo' / "foo" / `foo` — strip the quotes.
    if (token.length >= 2 && (token[0] === "'" || token[0] === '"' || token[0] === '`')) {
      return token.slice(1, -1);
    }
    // Identifier: look up the binding.
    const resolved = bindings.get(token);
    if (resolved !== undefined) return resolved;
    // Fail loud: identifier without a plain-string-literal binding.
    const reason = `identifier \`${token}\` is not bound to a plain string literal at file top level`;
    if (onFailure) {
      onFailure({
        migrationFile,
        kind: kind === 'dropTable' ? 'createTable' : kind, // ParseFailure only carries createTable|alterTable
        tableName: `<${token}>`,
        reason,
      });
    } else {
      // eslint-disable-next-line no-console
      console.warn(
        `[generate-types/parser] WARN: ${migrationFile}: ` +
          `${kind}(${token}, ...) ${reason}. Event SKIPPED.`,
      );
    }
    return null;
  };

  // createTable + alterTable have callback bodies. Opener accepts either a
  // quoted literal or an uppercase/identifier const-bound name.
  const openerRegex = /knex\.schema\.(createTable|alterTable)\s*\(\s*(['"`][a-z_][a-z0-9_]*['"`]|[A-Za-z_$][\w$]*)\s*,\s*(?:async\s+)?\(?\s*[\w$]*\s*\)?\s*=>\s*\{/g;
  let m: RegExpExecArray | null;
  while ((m = openerRegex.exec(expandedBody)) !== null) {
    const kind = m[1] as 'createTable' | 'alterTable';
    const rawTableToken = m[2];
    const tableName = resolveTableName(rawTableToken, kind);
    const bodyStart = openerRegex.lastIndex;
    const bodySource = extractCallbackBody(expandedBody, bodyStart);
    if (tableName === null) {
      // Already fired the fail-loud signal in resolveTableName; skip event.
      continue;
    }
    if (bodySource === null) {
      const reason = 'callback body could not be parsed (unbalanced braces / malformed)';
      if (onFailure) {
        onFailure({ migrationFile, kind, tableName, reason });
      } else {
        // eslint-disable-next-line no-console
        console.warn(
          `[generate-types/parser] WARN: ${migrationFile}: ` +
            `${kind}('${tableName}', ...) ${reason}. ` +
            `Event SKIPPED. Inspect the migration source.`,
        );
      }
      continue;
    }
    events.push({ kind, tableName, bodySource, migrationFile });
  }
  // Phase 0b.1a cycle-2 + 0b.1b-ii-A: dropTable + dropTableIfExists. Now
  // scoped to up() body and accepts identifier-bound table names.
  const dropRegex = /knex\.schema\.(dropTable|dropTableIfExists)\s*\(\s*(['"`][a-z_][a-z0-9_]*['"`]|[A-Za-z_$][\w$]*)\s*\)/g;
  while ((m = dropRegex.exec(expandedBody)) !== null) {
    const rawTableToken = m[2];
    const tableName = resolveTableName(rawTableToken, 'dropTable');
    if (tableName === null) continue;
    events.push({ kind: 'dropTable', tableName, bodySource: '', migrationFile });
  }
  return events;
}

/**
 * Walk forward from position of first `{` body char, tracking brace depth +
 * string/comment skips. Return body content between matched braces (exclusive).
 * Returns null on unbalanced braces.
 */
export function extractCallbackBody(source: string, bodyStart: number): string | null {
  let depth = 1;
  let i = bodyStart;
  while (i < source.length && depth > 0) {
    const ch = source[i];
    if (ch === '/' && source[i + 1] === '/') {
      while (i < source.length && source[i] !== '\n') i++;
      continue;
    }
    if (ch === '/' && source[i + 1] === '*') {
      i += 2;
      while (i < source.length - 1 && !(source[i] === '*' && source[i + 1] === '/')) i++;
      i += 2;
      continue;
    }
    if (ch === "'" || ch === '"' || ch === '`') {
      const quote = ch;
      i++;
      while (i < source.length && source[i] !== quote) {
        if (source[i] === '\\') i++;
        i++;
      }
      i++;
      continue;
    }
    if (ch === '{') depth++;
    else if (ch === '}') depth--;
    i++;
  }
  if (depth !== 0) return null;
  return source.slice(bodyStart, i - 1);
}

export interface ParsedBuilderBody {
  columnAdds: ColumnDef[];
  columnDrops: string[];
  columnRenames: Array<{ from: string; to: string }>;
}

export function parseBuilderBody(body: string): ParsedBuilderBody {
  const columnAdds: ColumnDef[] = [];
  const columnDrops: string[] = [];
  const columnRenames: Array<{ from: string; to: string }> = [];

  const callRegex = /\bt\.(\w+)\s*\(/g;
  let m: RegExpExecArray | null;
  while ((m = callRegex.exec(body)) !== null) {
    const method = m[1];
    const argsStart = callRegex.lastIndex;
    const argsEnd = findMatchingParen(body, argsStart);
    if (argsEnd === -1) continue;
    const argsRaw = body.slice(argsStart, argsEnd);
    const chainEnd = scanChainedModifiers(body, argsEnd + 1);
    const chainRaw = body.slice(argsEnd + 1, chainEnd);

    if (method === 'dropColumn') {
      const colName = parseFirstStringLiteral(argsRaw);
      if (colName) columnDrops.push(colName);
      continue;
    }
    if (method === 'renameColumn') {
      const args = parseStringLiteralList(argsRaw);
      if (args.length >= 2) columnRenames.push({ from: args[0], to: args[1] });
      continue;
    }
    if (SKIP_BUILDER_METHODS.has(method)) continue;
    if (method === 'specificType') {
      const args = parseStringLiteralList(argsRaw);
      if (args.length >= 1) {
        columnAdds.push({
          name: args[0],
          knexType: 'specificType',
          specificTypeRaw: args[1] ?? 'unknown',
          nullable: parseNullable(chainRaw),
          hasDefault: /\.defaultTo\s*\(/.test(chainRaw),
          isPrimary: /\.primary\s*\(/.test(chainRaw),
        });
      }
      continue;
    }
    if (!KNEX_COLUMN_TYPES.includes(method as KnexColumnType)) continue;

    const colName = parseFirstStringLiteral(argsRaw);
    if (!colName) continue;

    let stringMaxLength: number | undefined;
    let decimalPrecision: number | undefined;
    let decimalScale: number | undefined;
    if (method === 'string') {
      const lengthMatch = /,\s*(\d+)/.exec(argsRaw);
      if (lengthMatch) stringMaxLength = parseInt(lengthMatch[1], 10);
    }
    if (method === 'decimal') {
      // Phase 0b.1b-i absorb of L5 0b.1a advisory #3:
      // t.decimal('col', N, M) → capture (precision, scale) tuple.
      // Args after the column name: precision (required), scale (optional).
      const numbers = Array.from(argsRaw.matchAll(/,\s*(\d+)/g)).map((mm) => parseInt(mm[1], 10));
      if (numbers.length >= 1) decimalPrecision = numbers[0];
      if (numbers.length >= 2) decimalScale = numbers[1];
    }

    columnAdds.push({
      name: colName,
      knexType: method as KnexColumnType,
      nullable: parseNullable(chainRaw),
      hasDefault: /\.defaultTo\s*\(/.test(chainRaw),
      isPrimary: /\.primary\s*\(/.test(chainRaw),
      stringMaxLength,
      decimalPrecision,
      decimalScale,
      references: parseReferences(chainRaw),
    });
  }

  return { columnAdds, columnDrops, columnRenames };
}

function findMatchingParen(source: string, start: number): number {
  let depth = 1;
  let i = start;
  while (i < source.length && depth > 0) {
    const ch = source[i];
    if (ch === "'" || ch === '"' || ch === '`') {
      const q = ch;
      i++;
      while (i < source.length && source[i] !== q) {
        if (source[i] === '\\') i++;
        i++;
      }
      i++;
      continue;
    }
    if (ch === '(') depth++;
    else if (ch === ')') depth--;
    if (depth === 0) return i;
    i++;
  }
  return -1;
}

function scanChainedModifiers(source: string, start: number): number {
  let i = start;
  while (i < source.length) {
    const ch = source[i];
    if (ch === ';') return i;
    if (ch === '\n') {
      let j = i + 1;
      while (j < source.length && /[ \t]/.test(source[j])) j++;
      if (source[j] !== '.') return i;
    }
    if (ch === '(') {
      i = findMatchingParen(source, i + 1) + 1;
      continue;
    }
    if (ch === "'" || ch === '"' || ch === '`') {
      const q = ch;
      i++;
      while (i < source.length && source[i] !== q) {
        if (source[i] === '\\') i++;
        i++;
      }
      i++;
      continue;
    }
    i++;
  }
  return i;
}

function parseFirstStringLiteral(s: string): string | null {
  const m = /['"`]([^'"`]+)['"`]/.exec(s);
  return m ? m[1] : null;
}

function parseStringLiteralList(s: string): string[] {
  const out: string[] = [];
  const re = /['"`]([^'"`]+)['"`]/g;
  let m;
  while ((m = re.exec(s)) !== null) out.push(m[1]);
  return out;
}

function parseNullable(chain: string): boolean {
  if (/\.notNullable\s*\(/.test(chain)) return false;
  if (/\.primary\s*\(/.test(chain)) return false;
  return true;
}

function parseReferences(chain: string): { table: string; column: string } | undefined {
  const refMatch = /\.references\s*\(\s*['"`]([^'"`]+)['"`]\s*\)\s*\.inTable\s*\(\s*['"`]([^'"`]+)['"`]\s*\)/.exec(chain);
  if (refMatch) return { column: refMatch[1], table: refMatch[2] };
  return undefined;
}
