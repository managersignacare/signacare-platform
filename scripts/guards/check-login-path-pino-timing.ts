#!/usr/bin/env tsx
/**
 * A1 — loginController timing guard.
 *
 * The A1 diagnostic slice requires every direct `await` in
 * `loginController` to be wrapped in `withTiming(...)`, unless the
 * line is explicitly annotated with `@login-path-timing-exempt:`.
 *
 * Scope is deliberately narrow:
 * - one file: apps/api/src/features/auth/authController.ts
 * - one function: loginController
 * - one invariant: direct awaited stages in the login path are timed
 *
 * This is not a generic "all awaits everywhere" rule. It protects the
 * specific diagnostic surface the v4 plan relies on.
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
  preview: string;
  reason: string;
}

export interface RunGuardOpts {
  sourcePath?: string;
}

export interface RunGuardResult {
  exitCode: number;
  violations: Violation[];
  awaitedStages: number;
  validatedWrappedStages: number;
  exemptedStages: number;
  boundedStageChecks: number;
  boundedStageFailures: number;
}

function buildLineOffsets(source: string): number[] {
  const offsets = [0];
  for (let i = 0; i < source.length; i++) {
    if (source[i] === '\n') offsets.push(i + 1);
  }
  offsets.push(source.length + 1);
  return offsets;
}

function lineNoOfIndex(lineOffsets: number[], idx: number): number {
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

function hasInlineExemption(source: string, lineNo: number, lineOffsets: number[]): boolean {
  if (lineNo < 2) return false;
  const prevLineStart = lineOffsets[lineNo - 2];
  const prevLineEnd = lineOffsets[lineNo - 1];
  const prevLine = source.slice(prevLineStart, prevLineEnd);
  return /@login-path-timing-exempt:\s*\S/.test(prevLine);
}

function isInsideNestedFunction(awaitNode: ts.AwaitExpression, loginFn: ts.FunctionLikeDeclaration): boolean {
  let current: ts.Node | undefined = awaitNode.parent;
  while (current && current !== loginFn) {
    if (ts.isFunctionLike(current)) {
      return true;
    }
    current = current.parent;
  }
  return false;
}

function findLoginController(sourceFile: ts.SourceFile): ts.FunctionDeclaration | null {
  for (const stmt of sourceFile.statements) {
    if (
      ts.isFunctionDeclaration(stmt) &&
      stmt.name?.text === 'loginController'
    ) {
      return stmt;
    }
  }
  return null;
}

function isWrappedWithTiming(awaitNode: ts.AwaitExpression): boolean {
  const expr = awaitNode.expression;
  return ts.isCallExpression(expr) && expr.expression.getText() === 'withTiming';
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
      violations: [{
        file: relFile,
        lineNo: 1,
        preview: '',
        reason: 'source file missing or unreadable',
      }],
      awaitedStages: 0,
      validatedWrappedStages: 0,
      exemptedStages: 0,
      boundedStageChecks: 0,
      boundedStageFailures: 0,
    };
  }

  const sourceFile = ts.createSourceFile(sourcePath, source, ts.ScriptTarget.Latest, true);
  const loginFn = findLoginController(sourceFile);
  if (!loginFn) {
    return {
      exitCode: 2,
      violations: [{
        file: relFile,
        lineNo: 1,
        preview: '',
        reason: 'loginController not found',
      }],
      awaitedStages: 0,
      validatedWrappedStages: 0,
      exemptedStages: 0,
      boundedStageChecks: 0,
      boundedStageFailures: 0,
    };
  }

  const lines = source.split('\n');
  const lineOffsets = buildLineOffsets(source);
  const violations: Violation[] = [];
  let awaitedStages = 0;
  let validatedWrappedStages = 0;
  let exemptedStages = 0;

  const visit = (node: ts.Node): void => {
    if (ts.isAwaitExpression(node)) {
      if (isInsideNestedFunction(node, loginFn)) {
        return;
      }
      awaitedStages++;
      const lineNo = lineNoOfIndex(lineOffsets, node.getStart(sourceFile));
      if (hasInlineExemption(source, lineNo, lineOffsets)) {
        exemptedStages++;
        return;
      }
      if (isWrappedWithTiming(node)) {
        validatedWrappedStages++;
        return;
      }
      violations.push({
        file: relFile,
        lineNo,
        preview: (lines[lineNo - 1] ?? '').trim().slice(0, 180),
        reason: 'direct await in loginController is not wrapped in withTiming(...)',
      });
      return;
    }
    ts.forEachChild(node, visit);
  };

  ts.forEachChild(loginFn, visit);

  // A1a phase-1: bounded-failure semantics for auth-chain middleware and
  // login best-effort stages must remain mechanically enforced.
  const boundedRequirements: Array<{
    filePath: string;
    token: string;
    stage: string;
  }> = [
    {
      filePath: resolve(ROOT, 'apps', 'api', 'src', 'middleware', 'authMiddleware.ts'),
      token: 'withAuthChainStageTimeout',
      stage: 'auth.middleware.revocation_check',
    },
    {
      filePath: resolve(ROOT, 'apps', 'api', 'src', 'middleware', 'sessionIdleMiddleware.ts'),
      token: 'withAuthChainStageTimeout',
      stage: 'auth.session_idle.get',
    },
    {
      filePath: resolve(ROOT, 'apps', 'api', 'src', 'middleware', 'sessionIdleMiddleware.ts'),
      token: 'withAuthChainStageTimeout',
      stage: 'auth.session_idle.expire',
    },
    {
      filePath: resolve(ROOT, 'apps', 'api', 'src', 'features', 'auth', 'authService.ts'),
      token: 'withAuthChainStageTimeout',
      stage: 'auth.login.session_cap.query',
    },
    {
      filePath: resolve(ROOT, 'apps', 'api', 'src', 'features', 'auth', 'authService.ts'),
      token: 'withAuthChainStageTimeout',
      stage: 'auth.login.session_cap.revoke',
    },
  ];

  let boundedStageChecks = 0;
  let boundedStageFailures = 0;
  const boundedSeen = new Set<string>();

  for (const req of boundedRequirements) {
    const key = `${req.filePath}::${req.token}::${req.stage}`;
    if (boundedSeen.has(key)) continue;
    boundedSeen.add(key);
    boundedStageChecks++;

    const relTarget = relative(ROOT, req.filePath);
    let text: string;
    try {
      text = readFileSync(req.filePath, 'utf8');
    } catch {
      boundedStageFailures++;
      violations.push({
        file: relTarget,
        lineNo: 1,
        preview: '',
        reason: 'required auth-chain bounded-stage file is missing or unreadable',
      });
      continue;
    }

    if (!text.includes(req.token) || !text.includes(req.stage)) {
      boundedStageFailures++;
      violations.push({
        file: relTarget,
        lineNo: 1,
        preview: '',
        reason: `missing required bounded auth-chain stage marker: token=${req.token}, stage=${req.stage}`,
      });
    }
  }

  return {
    exitCode: violations.length > 0 ? 1 : 0,
    violations,
    awaitedStages,
    validatedWrappedStages,
    exemptedStages,
    boundedStageChecks,
    boundedStageFailures,
  };
}

function main(): number {
  console.log('→ check-login-path-pino-timing');
  const result = runGuard();
  console.log(`  awaited stages:           ${result.awaitedStages}`);
  console.log(`  wrapped with withTiming:  ${result.validatedWrappedStages}`);
  console.log(`  exempted stages:          ${result.exemptedStages}`);
  console.log(`  bounded-stage checks:     ${result.boundedStageChecks}`);
  console.log(`  bounded-stage failures:   ${result.boundedStageFailures}`);
  console.log(`  violations:               ${result.violations.length}`);

  if (result.violations.length > 0) {
    for (const violation of result.violations) {
      console.log(
        `  - ${violation.file}:${violation.lineNo} — ${violation.reason}\n` +
        `      ${violation.preview}`,
      );
    }
    return 1;
  }

  console.log('✓ Login timing + auth-chain bounded-stage invariants hold.');
  return 0;
}

if (require.main === module) {
  process.exitCode = main();
}
