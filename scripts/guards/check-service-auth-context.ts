#!/usr/bin/env tsx
/*
 * scripts/guards/check-service-auth-context.ts
 *
 * Phase R1 PR-R1-2 — CLAUDE.md §13 enforcement.
 *
 * ── Why this exists ──────────────────────────────────────────────
 * The 19-point audit found RBAC enforced at HTTP middleware only.
 * Services accepted raw `(clinicId: string, staffId: string, ...)`
 * without verifying the caller's access — a background job or
 * internal API calling `patientService.getById(anyClinicId, anyId)`
 * bypassed all authorization.
 *
 * CLAUDE.md §13 closes the gap: every NEW service method MUST accept
 * `auth: AuthContext` (from `@signacare/shared`) as its first parameter.
 * Methods accepting raw `(clinicId, actorId, ...)` are forbidden in
 * NEW code. Existing services migrate when next touched (incremental
 * adoption).
 *
 * This guard is the mechanical enforcement: parse every service file's
 * AST, find every exported method (object-literal method on the
 * exported service constant + top-level exported async function),
 * verify the first parameter is `auth: AuthContext`. Allowlist
 * baseline violations (using fingerprint format consistent with PR-R1-1.5)
 * so the existing 38 non-conforming services don't break the build,
 * but mechanically prevent NEW non-conforming methods.
 *
 * ── Scope ────────────────────────────────────────────────────────
 * Files: apps/api/src/features/(* /)*Service.ts (any depth).
 *
 * Methods checked:
 *   1. Properties of the exported service constant:
 *        export const fooService = { async create(...) {}, ... }
 *      → check `create`, etc. that are MethodDeclaration / shorthand
 *        method properties.
 *   2. Top-level `export async function methodName(...)` in service files.
 *
 * Methods NOT checked:
 *   - Private helpers (top-level `function foo()` without `export`)
 *   - Object-literal arrow-function properties OUTSIDE the service
 *     constant (e.g., callbacks, internal state)
 *   - Anything in *.test.ts / *.spec.ts
 *
 * ── First-param shape rules ──────────────────────────────────────
 * PASS:
 *   - `auth: AuthContext`
 *   - `auth: AuthContext | undefined`
 *   - First param is `_db: Knex` / `db: Knex` / `trx: Knex.Transaction`
 *     (repository helpers that live inside service files for
 *     organisational reasons; pattern is grandfathered)
 *   - No parameters (e.g., `getCurrentTime()`)
 *
 * FAIL:
 *   - Any other shape (`clinicId: string`, `id: string`, `dto: {...}`, etc.)
 *
 * ── Allowlist (line-shift-resilient fingerprint format) ──────────
 * Format: `<file> <fingerprint>  # comment`
 * (See scripts/guards/lib/allowlist-fingerprint.ts for the helper.)
 *
 * ── Run ──────────────────────────────────────────────────────────
 * `npm run guard:service-auth-context`
 *
 * Exit codes:
 *   0  every method's first param is AuthContext (or allowlisted)
 *   1  one or more violations
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
const ALLOWLIST_PATH = path.join(__dirname, 'check-service-auth-context.allowlist');

interface Violation {
  file: string;
  line: number;
  method: string;
  firstParam: string;
  reason: string;
  fingerprint: string | null;
}

function walk(dir: string, acc: string[] = []): string[] {
  let entries: fs.Dirent[];
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); }
  catch { return acc; }
  for (const e of entries) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (e.name === 'node_modules' || e.name.startsWith('.')) continue;
      walk(p, acc);
    } else if (e.isFile() && p.endsWith('Service.ts')) {
      if (p.includes('.test.') || p.includes('.spec.')) continue;
      acc.push(p);
    }
  }
  return acc;
}

function getFirstParamShape(params: ts.NodeArray<ts.ParameterDeclaration>): {
  kind: 'pass-auth' | 'pass-knex' | 'pass-empty' | 'fail';
  firstParam: string;
} {
  if (params.length === 0) {
    return { kind: 'pass-empty', firstParam: '<empty>' };
  }
  const first = params[0]!;
  const name = first.name.getText();
  const typeText = first.type ? first.type.getText() : '<no-type>';
  const display = `${name}: ${typeText}`;

  // PASS: auth: AuthContext (with optional union)
  if (name === 'auth' && typeText.includes('AuthContext')) {
    return { kind: 'pass-auth', firstParam: display };
  }

  // PASS: Knex/Transaction first-param (repository helpers in service files)
  if (
    typeText === 'Knex' ||
    typeText === 'Knex.Transaction' ||
    typeText.endsWith('.Knex') ||
    typeText.endsWith('.Transaction') ||
    /^Knex(<|\.)/.test(typeText)
  ) {
    return { kind: 'pass-knex', firstParam: display };
  }

  return { kind: 'fail', firstParam: display };
}

function findServiceConstantInitializer(sourceFile: ts.SourceFile): ts.ObjectLiteralExpression | null {
  // Look for: export const <something>Service = { ... }
  for (const stmt of sourceFile.statements) {
    if (!ts.isVariableStatement(stmt)) continue;
    const exported = stmt.modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword);
    if (!exported) continue;
    for (const decl of stmt.declarationList.declarations) {
      if (!ts.isIdentifier(decl.name)) continue;
      if (!decl.name.text.endsWith('Service')) continue;
      if (!decl.initializer || !ts.isObjectLiteralExpression(decl.initializer)) continue;
      return decl.initializer;
    }
  }
  return null;
}

function scanServiceFile(filePath: string, allowlist: AllowlistEntry[]): Violation[] {
  const source = fs.readFileSync(filePath, 'utf-8');
  const lines = source.split('\n');
  const sourceFile = ts.createSourceFile(filePath, source, ts.ScriptTarget.Latest, true);
  const findings: Violation[] = [];
  const relPath = path.relative(REPO_ROOT, filePath);
  // Track per-(file,fingerprint) violation count for multiplicity
  const violationBuckets = new Map<string, number>();

  function reportFinding(node: ts.Node, methodName: string, firstParam: string, reason: string) {
    const { line } = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
    const lineno = line + 1;
    const lineContent = lines[line] ?? '';
    const fp = fingerprint(lineContent);
    findings.push({
      file: relPath,
      line: lineno,
      method: methodName,
      firstParam,
      reason,
      fingerprint: fp,
    });
  }

  // 1. Object-literal methods on exported xService constant
  const serviceObj = findServiceConstantInitializer(sourceFile);
  if (serviceObj) {
    for (const prop of serviceObj.properties) {
      if (!ts.isMethodDeclaration(prop) && !ts.isPropertyAssignment(prop)) continue;
      let methodName = '<anonymous>';
      let params: ts.NodeArray<ts.ParameterDeclaration> | null = null;

      if (ts.isMethodDeclaration(prop)) {
        if (ts.isIdentifier(prop.name)) methodName = prop.name.text;
        params = prop.parameters;
      } else if (ts.isPropertyAssignment(prop)) {
        if (ts.isIdentifier(prop.name)) methodName = prop.name.text;
        // Allow `methodName: async (...) => {}` shape
        if (
          ts.isArrowFunction(prop.initializer) ||
          ts.isFunctionExpression(prop.initializer)
        ) {
          params = prop.initializer.parameters;
        }
      }

      if (!params) continue;
      const shape = getFirstParamShape(params);
      if (shape.kind === 'fail') {
        reportFinding(prop, methodName, shape.firstParam, 'first param is not auth: AuthContext');
      }
    }
  }

  // 2. Top-level `export async function methodName(...)` in service files
  for (const stmt of sourceFile.statements) {
    if (!ts.isFunctionDeclaration(stmt)) continue;
    const exported = stmt.modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword);
    if (!exported) continue;
    if (!stmt.name) continue;
    const methodName = stmt.name.text;
    const shape = getFirstParamShape(stmt.parameters);
    if (shape.kind === 'fail') {
      reportFinding(stmt, methodName, shape.firstParam, 'first param is not auth: AuthContext');
    }
  }

  // Apply allowlist with multiplicity tracking
  const finalFindings: Violation[] = [];
  for (const f of findings) {
    if (f.fingerprint == null) {
      // Empty/whitespace fingerprint never matches allowlist (defence)
      finalFindings.push(f);
      continue;
    }
    const key = `${f.file}\t${f.fingerprint}`;
    const seen = (violationBuckets.get(key) ?? 0) + 1;
    violationBuckets.set(key, seen);
    const allowedCount = getAllowlistedCount(f.file, f.fingerprint, allowlist);
    if (seen > allowedCount) {
      // Surplus — REJECT
      const reason =
        allowedCount > 0
          ? `over-count: ${seen} occurrences vs ${allowedCount} allowlisted (fingerprint ${f.fingerprint})`
          : f.reason;
      finalFindings.push({ ...f, reason });
    }
  }
  return finalFindings;
}

function main(): number {
  const allowlist = loadAllowlist(ALLOWLIST_PATH);
  const files = walk(SCAN_ROOT);
  const violations: Violation[] = [];

  for (const file of files) {
    const fileViolations = scanServiceFile(file, allowlist);
    violations.push(...fileViolations);
  }

  console.error('→ check-service-auth-context (PR-R1-2; CLAUDE.md §13)');
  console.error(`  scanned:     ${files.length} *Service.ts file(s)`);
  console.error(`  allowlist:   ${path.relative(REPO_ROOT, ALLOWLIST_PATH)} (${allowlist.length} entries)`);
  console.error('');

  if (violations.length === 0) {
    console.error('✓ Every service method accepts `auth: AuthContext` as first parameter.');
    return 0;
  }

  console.error(`✗ ${violations.length} service method(s) missing AuthContext as first parameter:\n`);
  for (const v of violations) {
    console.error(`  ${v.file}:${v.line}  ${v.method}(...)`);
    console.error(`    first-param: ${v.firstParam}`);
    console.error(`    reason: ${v.reason}`);
    console.error('');
  }
  console.error(
    'Fix: change first param to `auth: AuthContext` per CLAUDE.md §13. ' +
      "If genuinely repository-helper or framework hook, add `<file> <fingerprint>` to " +
      `${path.relative(REPO_ROOT, ALLOWLIST_PATH)} with a cascade BUG citation.`,
  );
  return 1;
}

if (require.main === module) {
  process.exit(main());
}
