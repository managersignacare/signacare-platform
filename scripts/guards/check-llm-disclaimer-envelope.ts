#!/usr/bin/env tsx
/**
 * BUG-285 — LLM disclaimer envelope structural guard.
 *
 * Ensures every clinical AI response surface keeps the canonical
 * `disclaimer: CLINICAL_AI_DISCLAIMER` envelope so UI + audit tooling can
 * distinguish model output from clinician-authored text.
 */

import { existsSync, readFileSync } from 'node:fs';
import { resolve, relative } from 'node:path';
import ts from 'typescript';

const REPO_ROOT = resolve(__dirname, '..', '..');

type Violation = {
  file: string;
  line: number;
  snippet: string;
  reason: string;
};

type GuardResult = {
  exitCode: number;
  violations: Violation[];
};

type RouteContract = {
  file: string;
  method: 'post' | 'get' | 'put' | 'patch' | 'delete';
  path: string;
  mode: 'inline' | 'handler_ref';
  handlerName?: string;
};

const ROUTE_CONTRACTS: RouteContract[] = [
  {
    file: 'apps/api/src/features/llm/llmRoutes.ts',
    method: 'post',
    path: '/suggest',
    mode: 'handler_ref',
    handlerName: 'suggest',
  },
  {
    file: 'apps/api/src/features/llm/llmRoutes.ts',
    method: 'post',
    path: '/clinical-ai',
    mode: 'inline',
  },
  {
    file: 'apps/api/src/features/llm/llmRoutes.ts',
    method: 'post',
    path: '/agent',
    mode: 'inline',
  },
  {
    file: 'apps/api/src/features/llm/scribeRoutes.ts',
    method: 'post',
    path: '/patient-summary',
    mode: 'inline',
  },
  {
    file: 'apps/api/src/features/llm/scribeRoutes.ts',
    method: 'post',
    path: '/referral-letter',
    mode: 'inline',
  },
];

const SUGGEST_HANDLER_FILE = 'apps/api/src/features/llm/llmController.ts';
const DISCLAIMER_PAIR_RE = /\bdisclaimer\s*:\s*CLINICAL_AI_DISCLAIMER\b/;
const DISCLAIMER_IMPORT_RE = /CLINICAL_AI_DISCLAIMER/;

function lineNumberAt(source: string, index: number): number {
  return source.slice(0, index).split('\n').length;
}

function lineSnippet(source: string, line: number): string {
  return (source.split('\n')[line - 1] ?? '').trim();
}

function isRouterMethodCall(node: ts.CallExpression, method: string): boolean {
  if (!ts.isPropertyAccessExpression(node.expression)) return false;
  if (node.expression.expression.getText() !== 'router') return false;
  return node.expression.name.text === method;
}

function getStringArg(node: ts.Expression): string | null {
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return node.text;
  return null;
}

function findRouteCall(
  sf: ts.SourceFile,
  contract: RouteContract,
): ts.CallExpression | null {
  let found: ts.CallExpression | null = null;
  const visit = (node: ts.Node): void => {
    if (found) return;
    if (ts.isCallExpression(node) && isRouterMethodCall(node, contract.method)) {
      const [pathArg] = node.arguments;
      if (pathArg) {
        const path = getStringArg(pathArg);
        if (path === contract.path) {
          found = node;
          return;
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return found;
}

function findNamedFunction(sf: ts.SourceFile, name: string): ts.FunctionLikeDeclarationBase | null {
  let found: ts.FunctionLikeDeclarationBase | null = null;
  const visit = (node: ts.Node): void => {
    if (found) return;
    if (ts.isFunctionDeclaration(node) && node.name?.text === name) {
      found = node;
      return;
    }
    if (ts.isVariableStatement(node)) {
      for (const decl of node.declarationList.declarations) {
        if (!ts.isIdentifier(decl.name) || decl.name.text !== name) continue;
        if (decl.initializer && (ts.isArrowFunction(decl.initializer) || ts.isFunctionExpression(decl.initializer))) {
          found = decl.initializer;
          return;
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return found;
}

function pushViolation(
  violations: Violation[],
  relFile: string,
  source: string,
  index: number,
  reason: string,
): void {
  const line = lineNumberAt(source, index);
  violations.push({
    file: relFile,
    line,
    snippet: lineSnippet(source, line),
    reason,
  });
}

export function runGuard(repoRoot: string = REPO_ROOT): GuardResult {
  const violations: Violation[] = [];

  const routeFileCache = new Map<string, { source: string; sf: ts.SourceFile; absPath: string }>();
  for (const contract of ROUTE_CONTRACTS) {
    if (routeFileCache.has(contract.file)) continue;
    const absPath = resolve(repoRoot, contract.file);
    if (!existsSync(absPath)) {
      violations.push({
        file: contract.file,
        line: 1,
        snippet: '',
        reason: 'required LLM route file missing',
      });
      continue;
    }
    const source = readFileSync(absPath, 'utf8');
    const sf = ts.createSourceFile(absPath, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
    routeFileCache.set(contract.file, { source, sf, absPath });
  }

  for (const contract of ROUTE_CONTRACTS) {
    const cached = routeFileCache.get(contract.file);
    if (!cached) continue;
    const relFile = relative(repoRoot, cached.absPath).replaceAll('\\', '/');
    const routeCall = findRouteCall(cached.sf, contract);
    if (!routeCall) {
      pushViolation(
        violations,
        relFile,
        cached.source,
        0,
        `required route ${contract.method.toUpperCase()} ${contract.path} missing`,
      );
      continue;
    }
    const lastArg = routeCall.arguments[routeCall.arguments.length - 1];
    if (!lastArg) {
      pushViolation(
        violations,
        relFile,
        cached.source,
        routeCall.getStart(cached.sf),
        `route ${contract.path} has no handler argument`,
      );
      continue;
    }

    if (contract.mode === 'handler_ref') {
      if (!ts.isIdentifier(lastArg) || lastArg.text !== contract.handlerName) {
        pushViolation(
          violations,
          relFile,
          cached.source,
          lastArg.getStart(cached.sf),
          `route ${contract.path} must be wired to handler '${contract.handlerName}'`,
        );
      }
      continue;
    }

    if (!ts.isArrowFunction(lastArg) && !ts.isFunctionExpression(lastArg)) {
      pushViolation(
        violations,
        relFile,
        cached.source,
        lastArg.getStart(cached.sf),
        `route ${contract.path} must use an inline handler containing disclaimer envelope`,
      );
      continue;
    }

    const handlerText = lastArg.getText(cached.sf);
    if (!DISCLAIMER_PAIR_RE.test(handlerText)) {
      pushViolation(
        violations,
        relFile,
        cached.source,
        lastArg.getStart(cached.sf),
        `route ${contract.path} is missing 'disclaimer: CLINICAL_AI_DISCLAIMER' in response envelope`,
      );
    }
  }

  const suggestHandlerAbs = resolve(repoRoot, SUGGEST_HANDLER_FILE);
  if (!existsSync(suggestHandlerAbs)) {
    violations.push({
      file: SUGGEST_HANDLER_FILE,
      line: 1,
      snippet: '',
      reason: 'suggest handler file missing',
    });
  } else {
    const source = readFileSync(suggestHandlerAbs, 'utf8');
    const sf = ts.createSourceFile(suggestHandlerAbs, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
    const relFile = relative(repoRoot, suggestHandlerAbs).replaceAll('\\', '/');

    if (!DISCLAIMER_IMPORT_RE.test(source)) {
      pushViolation(
        violations,
        relFile,
        source,
        0,
        "suggest handler file missing CLINICAL_AI_DISCLAIMER import/reference",
      );
    }

    const suggestFn = findNamedFunction(sf, 'suggest');
    if (!suggestFn || !suggestFn.body) {
      pushViolation(
        violations,
        relFile,
        source,
        0,
        "exported suggest handler not found",
      );
    } else {
      const suggestText = suggestFn.getText(sf);
      if (!DISCLAIMER_PAIR_RE.test(suggestText)) {
        pushViolation(
          violations,
          relFile,
          source,
          suggestFn.getStart(sf),
          "suggest handler is missing 'disclaimer: CLINICAL_AI_DISCLAIMER' in response envelope",
        );
      }
    }
  }

  return {
    exitCode: violations.length > 0 ? 1 : 0,
    violations,
  };
}

function main(): number {
  const result = runGuard();
  if (result.exitCode !== 0) {
    // eslint-disable-next-line no-console
    console.error('check-llm-disclaimer-envelope: FAIL');
    // eslint-disable-next-line no-console
    console.error('  BUG-285 violations:');
    for (const violation of result.violations) {
      // eslint-disable-next-line no-console
      console.error(`  - ${violation.file}:${violation.line}`);
      if (violation.snippet) {
        // eslint-disable-next-line no-console
        console.error(`    ${violation.snippet}`);
      }
      // eslint-disable-next-line no-console
      console.error(`    reason: ${violation.reason}`);
    }
    return 1;
  }
  // eslint-disable-next-line no-console
  console.error('check-llm-disclaimer-envelope: PASS');
  return 0;
}

if (require.main === module) {
  process.exit(main());
}
