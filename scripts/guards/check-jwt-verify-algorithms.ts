#!/usr/bin/env tsx
/**
 * Guard: require explicit `algorithms` in jwt.verify(...) options.
 *
 * Why:
 * - Prevents algorithm-confusion regressions by making accepted JWT
 *   algorithms explicit at every verification site.
 */

import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';

type Violation = {
  file: string;
  line: number;
  column: number;
  message: string;
};

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const API_SRC_ROOT = path.join(REPO_ROOT, 'apps', 'api', 'src');

function walkTsFiles(dir: string, out: string[] = []): string[] {
  let entries: fs.Dirent[] = [];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
      walkTsFiles(full, out);
      continue;
    }
    if (!entry.isFile()) continue;
    if (!full.endsWith('.ts')) continue;
    out.push(full);
  }
  return out;
}

function isJwtVerifyCall(node: ts.CallExpression): boolean {
  const expr = node.expression;
  if (!ts.isPropertyAccessExpression(expr)) return false;
  if (expr.name.text !== 'verify') return false;
  if (ts.isIdentifier(expr.expression) && expr.expression.text === 'jwt') return true;
  // Covers `jwt.default.verify(...)` style imports.
  if (
    ts.isPropertyAccessExpression(expr.expression) &&
    expr.expression.name.text === 'default' &&
    ts.isIdentifier(expr.expression.expression) &&
    expr.expression.expression.text === 'jwt'
  ) {
    return true;
  }
  return false;
}

function hasExplicitAlgorithmsOption(node: ts.CallExpression): boolean {
  if (node.arguments.length < 3) return false;
  const opts = node.arguments[2];
  if (!ts.isObjectLiteralExpression(opts)) return false;
  for (const prop of opts.properties) {
    if (!ts.isPropertyAssignment(prop)) continue;
    if (!ts.isIdentifier(prop.name) || prop.name.text !== 'algorithms') continue;
    return ts.isArrayLiteralExpression(prop.initializer) && prop.initializer.elements.length > 0;
  }
  return false;
}

function findViolations(file: string): Violation[] {
  const source = fs.readFileSync(file, 'utf8');
  const sf = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const violations: Violation[] = [];

  function visit(node: ts.Node): void {
    if (ts.isCallExpression(node) && isJwtVerifyCall(node) && !hasExplicitAlgorithmsOption(node)) {
      const lc = sf.getLineAndCharacterOfPosition(node.getStart(sf));
      violations.push({
        file,
        line: lc.line + 1,
        column: lc.character + 1,
        message: 'jwt.verify must include explicit options.algorithms array',
      });
    }
    ts.forEachChild(node, visit);
  }

  visit(sf);
  return violations;
}

function main(): number {
  const files = walkTsFiles(API_SRC_ROOT);
  const violations = files.flatMap((f) => findViolations(f));
  if (violations.length === 0) {
    console.log('✓ All jwt.verify calls use explicit algorithms.');
    return 0;
  }

  console.error(`✗ Found ${violations.length} jwt.verify site(s) without explicit algorithms:`);
  for (const v of violations) {
    const rel = path.relative(REPO_ROOT, v.file);
    console.error(`  - ${rel}:${v.line}:${v.column} ${v.message}`);
  }
  return 1;
}

if (require.main === module) {
  process.exit(main());
}

