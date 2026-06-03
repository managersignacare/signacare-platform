#!/usr/bin/env tsx
/**
 * V1 runtime-honesty guard for Playwright global setup.
 *
 * Enforces:
 * - no silent `.catch(() => ...)` suppression
 * - every `catch { ... }` in global setup must throw
 */

import { readFileSync } from 'node:fs';
import { resolve, relative } from 'node:path';
import ts from 'typescript';

const ROOT = resolve(__dirname, '..', '..');
const DEFAULT_SOURCE_PATH = resolve(ROOT, 'e2e', 'fixtures', 'global-setup.ts');

export interface Violation {
  file: string;
  lineNo: number;
  reason: string;
}

export interface RunGuardOpts {
  sourcePath?: string;
}

export interface RunGuardResult {
  exitCode: number;
  violations: Violation[];
}

function lineNoAt(source: string, index: number): number {
  return source.slice(0, index).split('\n').length;
}

function catchClauseThrows(catchClause: ts.CatchClause): boolean {
  let hasThrow = false;
  const visit = (node: ts.Node): void => {
    if (ts.isThrowStatement(node)) {
      hasThrow = true;
      return;
    }
    ts.forEachChild(node, visit);
  };
  visit(catchClause.block);
  return hasThrow;
}

function findGlobalSetupNode(sourceFile: ts.SourceFile): ts.Node | null {
  for (const stmt of sourceFile.statements) {
    if (ts.isFunctionDeclaration(stmt) && stmt.name?.text === 'globalSetup') {
      return stmt;
    }
  }
  return null;
}

export function runGuard(opts: RunGuardOpts = {}): RunGuardResult {
  const sourcePath = opts.sourcePath ?? DEFAULT_SOURCE_PATH;
  const relFile = relative(ROOT, sourcePath);
  const source = readFileSync(sourcePath, 'utf8');
  const sourceFile = ts.createSourceFile(sourcePath, source, ts.ScriptTarget.Latest, true);
  const violations: Violation[] = [];

  const silentCatchRegex = /\.catch\s*\(\s*\(\s*[^)]*\)\s*=>\s*(?:undefined|null|\{\s*\})\s*\)/g;
  let match: RegExpExecArray | null;
  while ((match = silentCatchRegex.exec(source)) !== null) {
    violations.push({
      file: relFile,
      lineNo: lineNoAt(source, match.index),
      reason: 'silent `.catch(() => undefined|null|{})` suppression is forbidden in global setup',
    });
  }

  const globalSetupNode = findGlobalSetupNode(sourceFile);
  if (!globalSetupNode) {
    violations.push({
      file: relFile,
      lineNo: 1,
      reason: 'globalSetup function not found',
    });
    return { exitCode: 1, violations };
  }

  const visit = (node: ts.Node): void => {
    if (ts.isCatchClause(node) && !catchClauseThrows(node)) {
      violations.push({
        file: relFile,
        lineNo: sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1,
        reason: 'catch clause does not rethrow (fail-open risk)',
      });
    }
    ts.forEachChild(node, visit);
  };
  visit(globalSetupNode);

  return {
    exitCode: violations.length > 0 ? 1 : 0,
    violations,
  };
}

function main(): number {
  console.log('→ check-playwright-globalsetup-fail-closed');
  const result = runGuard();
  console.log(`  violations: ${result.violations.length}`);
  if (result.violations.length > 0) {
    for (const v of result.violations) {
      console.log(`  - ${v.file}:${v.lineNo} — ${v.reason}`);
    }
    return 1;
  }
  console.log('✓ Playwright global setup catch paths are fail-closed.');
  return 0;
}

if (require.main === module) {
  process.exitCode = main();
}
