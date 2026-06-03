#!/usr/bin/env tsx
/**
 * A2 runtime guard — bounded audit wait in loginController.
 *
 * Enforces one narrow invariant:
 * the `login.writeAuditLog` stage in authController login path must
 * route through `withTimeout(...)` using the same stage literal.
 *
 * This prevents drift back to unbounded audit awaits on login.
 */

import { readFileSync } from 'fs';
import { resolve, relative } from 'path';
import ts from 'typescript';

const ROOT = resolve(__dirname, '..', '..');
const DEFAULT_SOURCE_PATH = resolve(
  ROOT,
  'apps',
  'api',
  'src',
  'features',
  'auth',
  'authController.ts',
);

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

function findLoginController(sourceFile: ts.SourceFile): ts.FunctionDeclaration | null {
  for (const stmt of sourceFile.statements) {
    if (ts.isFunctionDeclaration(stmt) && stmt.name?.text === 'loginController') {
      return stmt;
    }
  }
  return null;
}

function findLineNo(source: string, needle: string): number {
  const idx = source.indexOf(needle);
  if (idx < 0) return 1;
  return source.slice(0, idx).split('\n').length;
}

export function runGuard(opts: RunGuardOpts = {}): RunGuardResult {
  const sourcePath = opts.sourcePath ?? DEFAULT_SOURCE_PATH;
  const relFile = relative(ROOT, sourcePath);
  let source: string;

  try {
    source = readFileSync(sourcePath, 'utf8');
  } catch {
    return {
      exitCode: 2,
      violations: [{ file: relFile, lineNo: 1, reason: 'source file missing or unreadable' }],
    };
  }

  const sourceFile = ts.createSourceFile(sourcePath, source, ts.ScriptTarget.Latest, true);
  const loginFn = findLoginController(sourceFile);
  if (!loginFn) {
    return {
      exitCode: 2,
      violations: [{ file: relFile, lineNo: 1, reason: 'loginController not found' }],
    };
  }

  const loginText = loginFn.getText(sourceFile);
  const violations: Violation[] = [];

  const hasAuditTimingStage = /withTiming\s*\(\s*['"]login\.writeAuditLog['"]/.test(loginText);
  if (!hasAuditTimingStage) {
    violations.push({
      file: relFile,
      lineNo: findLineNo(source, 'login.writeAuditLog'),
      reason: "loginController missing withTiming('login.writeAuditLog', ...)",
    });
  }

  const hasAuditTimeout = /withTimeout\s*\([\s\S]*?['"]login\.writeAuditLog['"]/.test(loginText);
  if (!hasAuditTimeout) {
    violations.push({
      file: relFile,
      lineNo: findLineNo(source, 'login.writeAuditLog'),
      reason: "login.writeAuditLog stage is not bounded with withTimeout(..., 'login.writeAuditLog')",
    });
  }

  return {
    exitCode: violations.length > 0 ? 1 : 0,
    violations,
  };
}

function main(): number {
  console.log('→ check-bounded-await-in-login-path');
  const result = runGuard();
  console.log(`  violations: ${result.violations.length}`);
  if (result.violations.length > 0) {
    for (const violation of result.violations) {
      console.log(`  - ${violation.file}:${violation.lineNo} — ${violation.reason}`);
    }
    return 1;
  }
  console.log('✓ login.writeAuditLog uses bounded timeout in loginController.');
  return 0;
}

if (require.main === module) {
  process.exitCode = main();
}
