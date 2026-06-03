#!/usr/bin/env tsx
/*
 * scripts/guards/check-migration-rollback-discipline.ts
 *
 * Phase R1 PR-R1-3 — CLAUDE.md §12.4 enforcement (rollback discipline).
 *
 * ── Why this exists ──────────────────────────────────────────────
 * CLAUDE.md §12.4 mandates:
 *   "down() order: the exact mirror, with IF EXISTS on every DROP
 *    so the down path is re-runnable."
 *
 * A bad `down()` migration is hazardous: if a `latest` cycle errors mid-
 * batch and Knex tries to roll back, a missing/broken `down()` leaves
 * the DB in a half-migrated state. Production rollbacks (after a hot
 * incident) need `down()` to actually work.
 *
 * The structural answer: STATIC AST scan at pre-commit. Catches the
 * most common defect classes deterministically without DB:
 *
 *   1. `down` function is missing entirely
 *   2. `down` exists but body is effectively empty (no statements,
 *      or only `return;`/`/* TODO * /`)
 *   3. Raw SQL `DROP TABLE/POLICY/CONSTRAINT/INDEX/TRIGGER/FUNCTION`
 *      without `IF EXISTS` (CLAUDE.md §12.4 sub-rule 4)
 *   4. Knex builder `t.dropTable(...)` instead of `t.dropTableIfExists(...)`
 *      or `knex.schema.dropTable(...)` instead of `dropTableIfExists`
 *
 * Class 5 — runtime verification (live up→down→up cycle in CI) — is
 * filed as BUG-PR-R1-3-FOLLOWUP-LIVE-ROLLBACK-CYCLE for the integration
 * test layer.
 *
 * ── Documented coverage gaps (cycle-2 absorb explicit) ───────────
 * The static guard does NOT catch:
 *   - DROP statements built via JS string concatenation:
 *       `'DROP TABLE ' + name`  / array.join(' ')
 *   - Concise arrow body without a Block:
 *       `export const down = async (k) => doSomething(k)` — bypasses
 *     the empty-detection heuristic. All 54 existing migrations use
 *     the function-declaration form so this is inert today.
 *   - Fake-meaningful down() bodies that pass the empty check but do
 *     no DB work (e.g. `console.log('rolled back'); return;`).
 *   - DROP statements emitted only via dynamic dispatch
 *     (`knex[op]('TABLE', name)` where `op = 'dropTable'`).
 *
 * SQL comments (`-- DROP TABLE foo` / `/ * DROP TABLE foo * /`) ARE
 * stripped before scanning so they do NOT generate false positives.
 *
 * ── Scope ────────────────────────────────────────────────────────
 * Files: apps/api/migrations/*.ts (the Knex-tracked migration directory).
 *
 * ── Run ──────────────────────────────────────────────────────────
 * `npm run guard:migration-rollback-discipline`
 *
 * Exit codes:
 *   0  every migration has a valid down() with IF EXISTS on DROPs
 *   1  one or more violations
 */

import * as fs from 'fs';
import * as path from 'path';
import * as ts from 'typescript';

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const MIGRATIONS_DIR = path.join(REPO_ROOT, 'apps', 'api', 'migrations');

interface Violation {
  file: string;
  line: number;
  kind: 'missing-down' | 'empty-down' | 'raw-drop-no-if-exists' | 'builder-drop-table-no-if-exists';
  detail: string;
}

function listMigrations(): string[] {
  if (!fs.existsSync(MIGRATIONS_DIR)) return [];
  return fs
    .readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith('.ts'))
    .sort()
    .map((f) => path.join(MIGRATIONS_DIR, f));
}

/** Find a body for `down` — supports both forms (cycle-2 absorb L3 finding #4):
 *
 *   1. `export async function down(knex: Knex): Promise<void> { ... }`
 *   2. `export const down = async (knex: Knex): Promise<void> => { ... }`
 *      (or function expression in same shape)
 *
 * Returns the function/arrow body (always a Block) or null when neither form
 * is found. Concise arrow bodies (`down = async (k) => doSomething(k)`) are
 * NOT supported here — they bypass the empty-detection heuristic, which is
 * a false-negative class. All 54 existing migrations use the function-
 * declaration form so this is inert today; documented as coverage-gap
 * follow-up.
 */
export function findDownBody(sourceFile: ts.SourceFile): ts.Block | null {
  // Form 1: function declaration
  for (const stmt of sourceFile.statements) {
    if (ts.isFunctionDeclaration(stmt)) {
      const exported = stmt.modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword);
      if (!exported || !stmt.name) continue;
      if (stmt.name.text === 'down' && stmt.body) return stmt.body;
    }
    // Form 2: variable statement with arrow / function expression
    if (ts.isVariableStatement(stmt)) {
      const exported = stmt.modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword);
      if (!exported) continue;
      for (const decl of stmt.declarationList.declarations) {
        if (!ts.isIdentifier(decl.name) || decl.name.text !== 'down') continue;
        if (!decl.initializer) continue;
        if (
          (ts.isArrowFunction(decl.initializer) || ts.isFunctionExpression(decl.initializer)) &&
          decl.initializer.body &&
          ts.isBlock(decl.initializer.body)
        ) {
          return decl.initializer.body;
        }
      }
    }
  }
  return null;
}

/** A function body is "effectively empty" if it has no statements OR only
 *  a bare `return;`. A no-op down() (e.g., for ledger-only wrappers around
 *  pre-existing SQL) is allowed if it explicitly opts in via comment.
 *
 *  Cycle-2 absorb (L3 finding #3): `@migration-down-noop:` requires a
 *  STRUCTURED reason (BUG-ID or alphanumeric tag — at minimum one
 *  non-whitespace token after the colon). An empty `@migration-down-noop:`
 *  comment is rejected. This mirrors §12.4's `@migration-raw-exempt:
 *  <category>` taxonomy enforcement.
 */
// Citation must appear on the SAME LINE as the marker (cycle-2 fix:
// cycle-1 regex would capture chars from the NEXT line — e.g. the
// closing `}` — letting `// @migration-down-noop:` (no reason) pass.
const NOOP_OPTIN_REGEX = /\/\/\s*@migration-down-noop:[ \t]*(\S[^\n\r]*)/;

export function isEffectivelyEmpty(body: ts.Block, _source: string): boolean {
  // Allow explicit no-op opt-in comment within the function body, but
  // ONLY if the citation is non-empty.
  const optInMatch = body.getText().match(NOOP_OPTIN_REGEX);
  if (optInMatch && optInMatch[1] && optInMatch[1].trim().length > 0) return false;

  if (body.statements.length === 0) return true;
  if (body.statements.length === 1) {
    const only = body.statements[0]!;
    if (ts.isReturnStatement(only) && !only.expression) return true;
  }
  // ALSO empty if every statement is a return/no-op
  let nonNoop = 0;
  for (const s of body.statements) {
    if (ts.isReturnStatement(s) && !s.expression) continue;
    nonNoop++;
  }
  return nonNoop === 0;
}

/** Look for raw SQL DROP statements that lack IF EXISTS within the down body.
 *  We scan template / string literals for `DROP <TYPE>` immediately followed
 *  (case-insensitive) by anything other than `IF EXISTS`.
 */
const DROP_KEYWORDS_REQUIRING_IF_EXISTS = [
  'TABLE',
  'POLICY',
  'CONSTRAINT',
  'INDEX',
  'TRIGGER',
  'FUNCTION',
  'VIEW',
  'MATERIALIZED VIEW',
  'TYPE',
  'SCHEMA',
];

/**
 * Strip SQL comments from a string before scanning for DROP keywords.
 * Cycle-2 absorb (L3 finding #5 / coverage gap): a literal `-- DROP TABLE x`
 * inside a longer comment string would otherwise be falsely flagged.
 *
 *   --line-comment\n     → stripped through end-of-line
 *   /* block-comment * /  → stripped through closing
 */
export function stripSqlComments(text: string): string {
  // Block comments first (greedy minimal match across newlines)
  let out = text.replace(/\/\*[\s\S]*?\*\//g, ' ');
  // Then line comments (non-greedy through end-of-line; also handles end-of-string)
  out = out.replace(/--[^\n\r]*/g, ' ');
  return out;
}

/**
 * Scan a string for unsafe DROP statements and return ALL violation
 * occurrences (cycle-2 absorb L3 finding #6: report every match, not
 * just the first per keyword).
 *
 * PG syntax accepted:
 *   DROP <kw> [CONCURRENTLY] [IF EXISTS] name
 * (Only INDEX actually accepts CONCURRENTLY in PG, but this regex
 * tolerates the optional token after any keyword — false-negative
 * impossible, false-positive only on syntactically-invalid PG which
 * the DB itself would reject at runtime so the guard's silence is
 * harmless.)
 */
export function findRawDropViolationsInString(text: string): Array<{ keyword: string; index: number }> {
  const violations: Array<{ keyword: string; index: number }> = [];
  const stripped = stripSqlComments(text);
  for (const kw of DROP_KEYWORDS_REQUIRING_IF_EXISTS) {
    // PG syntax: `DROP <kw> [CONCURRENTLY] [IF EXISTS] name`
    //   We want to FLAG only when neither IF EXISTS nor (CONCURRENTLY IF EXISTS)
    //   appears between `DROP <kw>` and the identifier. Cycle-1 used an
    //   optional capturing group BEFORE the IF EXISTS lookahead, which
    //   backtracks to satisfy the negation when CONCURRENTLY is present —
    //   the L3 finding #1 false positive on `DROP INDEX CONCURRENTLY IF
    //   EXISTS foo`. Cycle-2 fix: a SINGLE negative lookahead that allows
    //   optional CONCURRENTLY inside the rejected pattern, eliminating
    //   the backtracking ambiguity.
    const re = new RegExp(
      `\\bDROP\\s+${kw}\\s+(?!(?:CONCURRENTLY\\s+)?IF\\s+EXISTS\\b)`,
      'gi',
    );
    let m: RegExpExecArray | null;
    while ((m = re.exec(stripped)) !== null) {
      violations.push({ keyword: kw, index: m.index });
    }
  }
  return violations;
}

function scanRawDropsInBody(body: ts.Block, sourceFile: ts.SourceFile): Array<{ line: number; detail: string }> {
  const findings: Array<{ line: number; detail: string }> = [];
  function visit(node: ts.Node) {
    // Look for string and template literals that contain DROP statements
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
      const text = node.text;
      const viol = findRawDropViolationsInString(text);
      if (viol.length > 0) {
        const { line } = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
        for (const v of viol) findings.push({ line: line + 1, detail: `DROP ${v.keyword} without IF EXISTS (offset ${v.index})` });
      }
    } else if (ts.isTemplateExpression(node)) {
      // Template with substitutions — collect head + middles + tail texts
      const parts = [node.head.text, ...node.templateSpans.map((s) => s.literal.text)];
      const fullText = parts.join(' '); // approximate (substitutions are vars)
      const viol = findRawDropViolationsInString(fullText);
      if (viol.length > 0) {
        const { line } = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
        for (const v of viol) findings.push({ line: line + 1, detail: `DROP ${v.keyword} without IF EXISTS (offset ${v.index})` });
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(body);
  return findings;
}

/** Look for Knex builder calls `dropTable(name)` or `t.dropTable(...)` —
 *  forbidden in down(); must be `dropTableIfExists`/`t.dropTableIfExists`.
 *  Same for `dropIndex` (Knex builder DOES NOT have dropIndexIfExists, so
 *  `dropIndex` is acceptable; PG `DROP INDEX IF EXISTS` only available
 *  via raw — which the prior class-3 check already covers).
 */
function scanBuilderDropsInBody(body: ts.Block, sourceFile: ts.SourceFile): Array<{ line: number; detail: string }> {
  const findings: Array<{ line: number; detail: string }> = [];
  function visit(node: ts.Node) {
    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)) {
      const methodName = node.expression.name.text;
      if (methodName === 'dropTable') {
        // Allow `dropTable` only if `IfExists` companion (Knex builder pattern)
        // — but Knex's own method is named `dropTableIfExists`, so reaching here
        // with `dropTable` is the bug we want to catch.
        const { line } = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
        findings.push({ line: line + 1, detail: '`.dropTable(...)` should be `.dropTableIfExists(...)` per CLAUDE.md §12.4' });
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(body);
  return findings;
}

function scanMigrationFile(filePath: string): Violation[] {
  const source = fs.readFileSync(filePath, 'utf-8');
  const sourceFile = ts.createSourceFile(filePath, source, ts.ScriptTarget.Latest, true);
  const relPath = path.relative(REPO_ROOT, filePath);
  const findings: Violation[] = [];

  const downBody = findDownBody(sourceFile);
  if (!downBody) {
    findings.push({
      file: relPath,
      line: 1,
      kind: 'missing-down',
      detail: 'no `export async function down(knex: Knex)` or `export const down = async (...) => {...}` declaration',
    });
    return findings; // can't check body
  }

  if (isEffectivelyEmpty(downBody, source)) {
    const { line } = sourceFile.getLineAndCharacterOfPosition(downBody.getStart(sourceFile));
    findings.push({
      file: relPath,
      line: line + 1,
      kind: 'empty-down',
      detail:
        'down() body is empty or no-op. If genuinely intentional (ledger-only wrapper for pre-existing SQL), add `// @migration-down-noop: <reason>` inside the body. The reason MUST be non-empty (BUG-ID or alphanumeric tag).',
    });
    return findings;
  }

  // Raw DROP without IF EXISTS
  for (const v of scanRawDropsInBody(downBody, sourceFile)) {
    findings.push({
      file: relPath,
      line: v.line,
      kind: 'raw-drop-no-if-exists',
      detail: v.detail,
    });
  }

  // Knex builder dropTable without dropTableIfExists
  for (const v of scanBuilderDropsInBody(downBody, sourceFile)) {
    findings.push({
      file: relPath,
      line: v.line,
      kind: 'builder-drop-table-no-if-exists',
      detail: v.detail,
    });
  }

  return findings;
}

function main(): number {
  const files = listMigrations();
  const violations: Violation[] = [];
  for (const f of files) {
    violations.push(...scanMigrationFile(f));
  }

  console.error('→ check-migration-rollback-discipline (PR-R1-3; CLAUDE.md §12.4)');
  console.error(`  scanned: ${files.length} migration file(s)`);
  console.error('');

  if (violations.length === 0) {
    console.error('✓ Every migration has a non-empty down() with IF EXISTS on DROPs.');
    return 0;
  }

  console.error(`✗ ${violations.length} migration rollback-discipline violation(s):\n`);
  for (const v of violations) {
    console.error(`  ${v.file}:${v.line}`);
    console.error(`    kind: ${v.kind}`);
    console.error(`    detail: ${v.detail}`);
    console.error('');
  }
  console.error(
    'Fix per CLAUDE.md §12.4: every down() must be a re-runnable mirror of up() with IF EXISTS on every DROP.',
  );
  return 1;
}

if (require.main === module) {
  process.exit(main());
}
