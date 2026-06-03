#!/usr/bin/env tsx
/**
 * Guard: block template-string interpolation inside raw SQL call sites
 * on runtime API surfaces.
 *
 * Why:
 * - Knex supports parameter bindings for both values and identifiers.
 * - Interpolating `${...}` inside raw SQL makes SQL construction fragile
 *   and can reintroduce injection bugs when a value source changes later.
 *
 * Scope:
 * - Runtime API paths only (features/jobs/integrations/shared/routes/mcp).
 * - Excludes migration helpers and seed/reset scripts by design.
 */

import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';

type Violation = {
  file: string;
  line: number;
  column: number;
  callee: string;
  snippet: string;
};

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const RUNTIME_ROOTS = [
  path.join(REPO_ROOT, 'apps', 'api', 'src', 'features'),
  path.join(REPO_ROOT, 'apps', 'api', 'src', 'jobs'),
  path.join(REPO_ROOT, 'apps', 'api', 'src', 'integrations'),
  path.join(REPO_ROOT, 'apps', 'api', 'src', 'shared'),
  path.join(REPO_ROOT, 'apps', 'api', 'src', 'routes'),
  path.join(REPO_ROOT, 'apps', 'api', 'src', 'mcp'),
];

const RAW_METHODS = new Set([
  'raw',
  'whereRaw',
  'orWhereRaw',
  'andWhereRaw',
  'havingRaw',
  'orHavingRaw',
  'orderByRaw',
  'joinRaw',
  'fromRaw',
]);

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

function calleeName(node: ts.CallExpression): string | null {
  const expr = node.expression;
  if (ts.isPropertyAccessExpression(expr)) return expr.name.text;
  if (ts.isIdentifier(expr)) return expr.text;
  return null;
}

function findViolations(file: string): Violation[] {
  const source = fs.readFileSync(file, 'utf8');
  const sf = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const violations: Violation[] = [];

  function visit(node: ts.Node): void {
    if (ts.isCallExpression(node)) {
      const callee = calleeName(node);
      if (callee && RAW_METHODS.has(callee)) {
        const firstArg = node.arguments[0];
        if (firstArg && ts.isTemplateExpression(firstArg) && firstArg.templateSpans.length > 0) {
          const lc = sf.getLineAndCharacterOfPosition(firstArg.getStart(sf));
          violations.push({
            file,
            line: lc.line + 1,
            column: lc.character + 1,
            callee,
            snippet: firstArg.getText(sf).slice(0, 140).replace(/\s+/g, ' '),
          });
        }
      }
    }
    ts.forEachChild(node, visit);
  }

  visit(sf);
  return violations;
}

function main(): number {
  const files = RUNTIME_ROOTS.flatMap((dir) => walkTsFiles(dir));
  const violations = files.flatMap((file) => findViolations(file));

  if (violations.length === 0) {
    console.log('✓ No raw SQL template interpolation found on runtime API surfaces.');
    return 0;
  }

  console.error(`✗ Found ${violations.length} raw SQL interpolation site(s):`);
  for (const v of violations) {
    const rel = path.relative(REPO_ROOT, v.file);
    console.error(`  - ${rel}:${v.line}:${v.column} [${v.callee}] ${v.snippet}`);
  }
  console.error('\nUse bindings instead (e.g. db.raw("... ?? ...", [identifier]) / db.raw("... ?", [value])).');
  return 1;
}

if (require.main === module) {
  process.exit(main());
}

