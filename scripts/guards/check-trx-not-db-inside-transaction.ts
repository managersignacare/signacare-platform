#!/usr/bin/env tsx
/*
 * scripts/guards/check-trx-not-db-inside-transaction.ts
 *
 * Phase R1 PR-R1-5 — CLAUDE.md §2.1 enforcement (transaction boundary).
 *
 * ── Why this exists ──────────────────────────────────────────────
 * CLAUDE.md §2.1:
 *   "Every query inside a transaction MUST use the transaction object."
 *
 * 4 connection pool leaks were caused by calling `db()` inside a
 * `db.transaction()` block. `db()` opens a NEW connection from the
 * pool; only `trx()` uses the transaction's connection. Under load
 * this exhausts the pool — every transaction holds 2 connections
 * (one for the transaction, one leaked) and the pool runs out.
 *
 * The structural answer: AST-walk every transaction callback and
 * REJECT every leak shape — direct calls AND repository-helper
 * calls that don't propagate the trx parameter.
 *
 * ── Scope ────────────────────────────────────────────────────────
 * Files: apps/api/src/features/(* /)*.ts (production handlers).
 *
 * Out of scope (intentional, documented):
 *   - apps/api/src/middleware/, apps/api/src/shared/ — these layers
 *     use raw pool primitives (`appPoolRaw`, `dbAdmin`) outside the
 *     §2.1 identifier convention; CLAUDE.md §2.1 applies to feature
 *     code, not infra plumbing.
 *   - Aliased imports of `db` (e.g. `import { db as database } from
 *     ...`). The codebase uses unaliased `db` everywhere (verified by
 *     `grep -nE "import.*\\bdb\\s+as\\s+\\w+" apps/api/src/features/`
 *     returning 0 hits). A future contributor adding an alias would
 *     bypass this guard. Tracked as
 *     BUG-PR-R1-5-FOLLOWUP-ALIASED-DB-IMPORT.
 *
 * Detection (two leak classes):
 *
 *   CLASS A — DIRECT CALL (the easy half):
 *     1. Find every `<expr>.transaction(<callback>)` where <expr> is
 *        `db` or `dbRead` (top-level identifiers from shared/db).
 *     2. Inside the callback body (block), find any nested call
 *        expression whose callee is `db`, `dbRead`, `db.raw`, or
 *        `dbRead.raw`. These should be the callback parameter.
 *
 *   CLASS B — REPOSITORY-HELPER CALL (the canonical §2.1 example):
 *     CLAUDE.md §2.1 explicitly cites:
 *       const esc = await escalationRepository.findById(clinicId, id);
 *           // uses db(), not trx!
 *     A repo helper that internally calls `db(...)` opens a fresh
 *     pool connection — silently. The structural rule: every call
 *     to a name matching `*Repository.*` / `*Repo.*` inside a
 *     transaction callback MUST receive `trx` (or the transaction
 *     parameter, whatever the callback names it) as one of its
 *     arguments. If it doesn't, the helper cannot be transaction-
 *     aware and the leak is silent.
 *
 *     False-positive defence: ONLY repo-style names trigger this rule.
 *     Pure helpers / mappers / formatters (`mapXxxToResponse(...)`,
 *     `parseDate(...)`, `dateToIso(...)`) don't end in `Repository.`/
 *     `Repo.` and are not flagged. If a repo legitimately doesn't
 *     touch the DB on a particular method (rare), the inline
 *     annotation `// @trx-not-needed: <reason>` on the call line
 *     opts out.
 *
 * False-positive defence (general):
 *   - Nested transactions (`db.transaction(... => db.transaction(...))`)
 *     are flagged at the innermost transaction scope.
 *
 * ── Run ──────────────────────────────────────────────────────────
 * `npm run guard:trx-not-db-inside-transaction`
 *
 * Exit codes:
 *   0  every transaction body uses `trx` for nested queries
 *   1  one or more transaction bodies leak `db(...)` calls
 */

import * as fs from 'fs';
import * as path from 'path';
import * as ts from 'typescript';
import {
  fingerprint,
  loadAllowlist,
  getAllowlistedCount,
  AllowlistEntry,
} from './lib/allowlist-fingerprint';

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const SCAN_ROOT = path.join(REPO_ROOT, 'apps', 'api', 'src', 'features');
const ALLOWLIST_PATH = path.join(__dirname, 'check-trx-not-db-inside-transaction.allowlist');

interface Violation {
  file: string;
  line: number;
  callee: string;
  reason: string;
  fingerprint: string | null;
}

function walk(dir: string, acc: string[] = []): string[] {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch (err) {
    console.warn(`[check-trx-not-db] could not read ${dir}: ${(err as Error).message}`);
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
 * Returns true if `expr` is a CallExpression whose callee is the
 * `db.transaction` / `dbRead.transaction` shape (PropertyAccessExpression
 * with property name 'transaction' on identifier 'db' or 'dbRead').
 */
export function isTransactionCall(expr: ts.Node): expr is ts.CallExpression {
  if (!ts.isCallExpression(expr)) return false;
  const callee = expr.expression;
  if (!ts.isPropertyAccessExpression(callee)) return false;
  if (callee.name.text !== 'transaction') return false;
  if (!ts.isIdentifier(callee.expression)) return false;
  return callee.expression.text === 'db' || callee.expression.text === 'dbRead';
}

/**
 * Returns the callback (function/arrow expression) passed to
 * `db.transaction(...)` / `dbRead.transaction(...)`. Returns null if
 * no callback is found.
 */
export function getTransactionCallback(call: ts.CallExpression): ts.ArrowFunction | ts.FunctionExpression | null {
  for (const arg of call.arguments) {
    if (ts.isArrowFunction(arg) || ts.isFunctionExpression(arg)) return arg;
  }
  return null;
}

/**
 * Get the parameter name of the transaction callback (typically `trx`,
 * but could be `tx`, `t`, `_trx`, etc.). Returns null if no parameter
 * exists. The result is the identifier name we expect to see passed
 * to repo helpers inside the body.
 */
export function getTrxParamName(cb: ts.ArrowFunction | ts.FunctionExpression): string | null {
  if (cb.parameters.length === 0) return null;
  const first = cb.parameters[0]!;
  if (ts.isIdentifier(first.name)) return first.name.text;
  return null;
}

/**
 * Returns true if `node` is a CallExpression whose callee identifier
 * looks like a repository / repo helper — name ends in `Repository`
 * or `Repo` followed by a method (`.<method>(...)`). Examples:
 *   escalationRepository.findById(...)
 *   patientRepo.update(...)
 * Pure helpers (`mapXxxToResponse(...)`, `parseDate(...)`,
 * `dateToIso(...)`) and Knex builder chains are NOT matched.
 */
export function isRepoHelperCall(node: ts.Node): node is ts.CallExpression {
  if (!ts.isCallExpression(node)) return false;
  const callee = node.expression;
  if (!ts.isPropertyAccessExpression(callee)) return false;
  if (!ts.isIdentifier(callee.expression)) return false;
  const objName = callee.expression.text;
  return /(?:Repository|Repo)$/.test(objName);
}

/**
 * Returns true if a call's argument list contains an Identifier with
 * text equal to `trxName` (the transaction parameter from the callback).
 * `trx` could be passed positionally or as part of an options object;
 * we accept both shapes by looking for the identifier anywhere in the
 * shallow argument list and inside object-literal property values.
 */
export function callPassesTrx(call: ts.CallExpression, trxName: string): boolean {
  for (const arg of call.arguments) {
    if (ts.isIdentifier(arg) && arg.text === trxName) return true;
    // Property shortcut: `repo.find(id, { trx })` — accept if any
    // ObjectLiteralExpression property value (or shorthand) is `trx`.
    if (ts.isObjectLiteralExpression(arg)) {
      for (const prop of arg.properties) {
        if (ts.isShorthandPropertyAssignment(prop) && prop.name.text === trxName) return true;
        if (
          ts.isPropertyAssignment(prop) &&
          ts.isIdentifier(prop.initializer) &&
          prop.initializer.text === trxName
        ) {
          return true;
        }
      }
    }
  }
  return false;
}

/**
 * Returns true if the line containing `node` has a trailing
 * `// @trx-not-needed:` annotation (the inline opt-out for repo-helper
 * calls that genuinely don't touch the DB).
 */
function hasTrxNotNeededAnnotation(node: ts.Node, sourceFile: ts.SourceFile, lines: string[]): boolean {
  const { line } = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
  const lineText = lines[line] ?? '';
  return /\/\/\s*@trx-not-needed:\s*\S/.test(lineText);
}

/**
 * Scan a function body for forbidden DB-touching calls inside a
 * transaction. Returns one finding per forbidden call site, classified
 * by `kind`:
 *
 *   'direct'      — `db(...)` / `dbRead(...)` direct call
 *   'direct-raw'  — `db.raw(...)` / `dbRead.raw(...)` member call
 *   'repo-no-trx' — `<x>Repository.<m>(...)` / `<x>Repo.<m>(...)`
 *                   without `trx` in the argument list
 *
 * `trx(...)` / `trx.raw(...)` calls are correct — not flagged.
 */
export function scanForForbiddenCalls(
  body: ts.Node,
  sourceFile: ts.SourceFile,
  lines: string[],
  trxName: string | null,
): Array<{ line: number; callee: string; kind: 'direct' | 'direct-raw' | 'repo-no-trx' }> {
  const findings: Array<{ line: number; callee: string; kind: 'direct' | 'direct-raw' | 'repo-no-trx' }> = [];
  function visit(node: ts.Node) {
    // Avoid recursing into nested transaction calls — those have their
    // own enforcement boundary.
    if (isTransactionCall(node)) {
      // Skip the entire sub-tree to prevent double-flagging.
      return;
    }
    if (ts.isCallExpression(node)) {
      const callee = node.expression;
      // Pattern A: `db(...)` / `dbRead(...)` direct call
      if (ts.isIdentifier(callee) && (callee.text === 'db' || callee.text === 'dbRead')) {
        const { line } = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
        findings.push({ line: line + 1, callee: `${callee.text}(...)`, kind: 'direct' });
      }
      // Pattern B: `db.raw(...)` / `dbRead.raw(...)` member call
      if (
        ts.isPropertyAccessExpression(callee) &&
        callee.name.text === 'raw' &&
        ts.isIdentifier(callee.expression) &&
        (callee.expression.text === 'db' || callee.expression.text === 'dbRead')
      ) {
        const { line } = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
        findings.push({ line: line + 1, callee: `${callee.expression.text}.raw(...)`, kind: 'direct-raw' });
      }
      // Pattern C: `<x>Repository.<m>(...)` / `<x>Repo.<m>(...)` without
      // `trx` in args — the canonical CLAUDE.md §2.1 leak shape.
      if (trxName && isRepoHelperCall(node) && !callPassesTrx(node, trxName)) {
        if (!hasTrxNotNeededAnnotation(node, sourceFile, lines)) {
          const { line } = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
          // Format the callee as `<obj>.<method>(...)` for the report
          const pa = callee as ts.PropertyAccessExpression;
          const objName = (pa.expression as ts.Identifier).text;
          const methodName = pa.name.text;
          findings.push({
            line: line + 1,
            callee: `${objName}.${methodName}(...)`,
            kind: 'repo-no-trx',
          });
        }
      }
    }
    ts.forEachChild(node, visit);
  }
  ts.forEachChild(body, visit);
  return findings;
}

export function scanFile(filePath: string, source: string, allowlist: AllowlistEntry[]): Violation[] {
  const lines = source.split('\n');
  const sourceFile = ts.createSourceFile(filePath, source, ts.ScriptTarget.Latest, true);
  const relPath = path.relative(REPO_ROOT, filePath);
  const findings: Violation[] = [];
  const violationBuckets = new Map<string, number>();

  function visit(node: ts.Node) {
    if (isTransactionCall(node)) {
      const cb = getTransactionCallback(node);
      if (cb && cb.body) {
        const trxName = getTrxParamName(cb);
        const calls = scanForForbiddenCalls(cb.body, sourceFile, lines, trxName);
        for (const c of calls) {
          const lineContent = lines[c.line - 1] ?? '';
          const fp = fingerprint(lineContent);
          const reasonByKind = {
            'direct': `\`${c.callee}\` called inside db.transaction() callback body — must use ${trxName ?? 'trx'} instead`,
            'direct-raw': `\`${c.callee}\` called inside db.transaction() callback body — must use ${trxName ?? 'trx'}.raw instead`,
            'repo-no-trx': `\`${c.callee}\` called inside db.transaction() callback without passing \`${trxName ?? 'trx'}\` — repo helper will open a fresh pool connection (CLAUDE.md §2.1 canonical leak shape)`,
          } as const;
          findings.push({
            file: relPath,
            line: c.line,
            callee: c.callee,
            reason: reasonByKind[c.kind],
            fingerprint: fp,
          });
        }
      }
      // Continue visiting the transaction call's children, BUT skip the
      // callback body (already scanned above) — recurse via the call's
      // children to catch nested transactions in OTHER args.
      // For simplicity we recurse the whole tree but the inner-most
      // transaction's callback gets scanned at its own top-level visit.
    }
    ts.forEachChild(node, visit);
  }
  visit(sourceFile);

  // Apply allowlist with multiplicity tracking
  const final: Violation[] = [];
  for (const f of findings) {
    if (f.fingerprint == null) {
      final.push(f);
      continue;
    }
    const key = `${f.file}\t${f.fingerprint}`;
    const seen = (violationBuckets.get(key) ?? 0) + 1;
    violationBuckets.set(key, seen);
    const allowedCount = getAllowlistedCount(f.file, f.fingerprint, allowlist);
    if (seen > allowedCount) {
      final.push({
        ...f,
        reason: allowedCount > 0
          ? `over-count: ${seen} occurrences vs ${allowedCount} allowlisted (fingerprint ${f.fingerprint})`
          : f.reason,
      });
    }
  }
  return final;
}

function main(): number {
  const allowlist = loadAllowlist(ALLOWLIST_PATH);
  const files = walk(SCAN_ROOT);
  const violations: Violation[] = [];
  for (const f of files) {
    const source = fs.readFileSync(f, 'utf-8');
    violations.push(...scanFile(f, source, allowlist));
  }

  console.error('→ check-trx-not-db-inside-transaction (PR-R1-5; CLAUDE.md §2.1)');
  console.error(`  scanned:    ${files.length} TS file(s)`);
  console.error(`  allowlist:  ${path.relative(REPO_ROOT, ALLOWLIST_PATH)} (${allowlist.length} entries)`);
  console.error('');

  if (violations.length === 0) {
    console.error('✓ Every `db.transaction(...)` callback uses `trx` for nested queries (no connection-pool leaks).');
    return 0;
  }

  console.error(`✗ ${violations.length} transaction-boundary violation(s):\n`);
  for (const v of violations) {
    console.error(`  ${v.file}:${v.line}`);
    console.error(`    callee: ${v.callee}`);
    console.error(`    reason: ${v.reason}`);
    console.error('');
  }
  console.error(
    'Fix per CLAUDE.md §2.1: replace `db(...)` / `db.raw(...)` with the transaction parameter (typically `trx`). ' +
      'Connection pool leaks are silent until the pool exhausts under load.',
  );
  return 1;
}

if (require.main === module) {
  process.exit(main());
}
