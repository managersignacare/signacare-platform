#!/usr/bin/env tsx
/*
 * scripts/guards/check-mapper-naming.ts
 *
 * Phase R1 PR-R1-10 — CLAUDE.md §5.2 enforcement (mapper naming
 * canonicalisation).
 *
 * ── Why this exists ──────────────────────────────────────────────
 * The codebase ships two mapper-naming shapes:
 *   1. `mapXxxRowToResponse(row)` — canonical (BUG-613/618/622
 *      sibling pattern; references the row source explicitly)
 *   2. `mapXxxResponse(row)` — non-canonical; doesn't say "from what"
 *
 * Cycle-1 BUG-638 cycle-2 introduced `map*Response` recognition in
 * the response-shape guard so existing non-canonical mappers wouldn't
 * fail — but the long-term contract per CLAUDE.md §5.2 is the
 * canonical form. Without enforcement the two shapes drift; new
 * contributors copy from whichever sibling they find first.
 *
 * The structural answer: walk every TS file, find any `function`/
 * `const` declaration whose name ends in `Response` but NOT in
 * `ToResponse`. REJECT.
 *
 * ── Scope ────────────────────────────────────────────────────────
 * Files: apps/api/src/(* /)*.ts (production handlers; mappers in
 * features/ + roles/).
 *
 * Detection:
 *   - Match `function map\w*Response\b` declarations
 *   - Match `const map\w*Response =` arrow / function expressions
 *   - REJECT if the name does NOT contain `ToResponse` (case-sensitive)
 *
 * False-positive defence:
 *   - The canonical form `mapXxxRowToResponse` / `mapXxxToResponse`
 *     contains `ToResponse` and passes.
 *   - A non-mapper function ending in `Response` (e.g.,
 *     `validateResponse`, `parseResponse`) — these don't match the
 *     `map\w+Response` pattern unless they start with `map`.
 *
 * ── Run ──────────────────────────────────────────────────────────
 * `npm run guard:mapper-naming`
 *
 * Exit codes:
 *   0  every map* function uses the canonical *ToResponse form
 *   1  one or more non-canonical mapper names found
 */

import * as fs from 'fs';
import * as path from 'path';
import * as ts from 'typescript';

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const SCAN_ROOTS = [
  path.join(REPO_ROOT, 'apps', 'api', 'src'),
  path.join(REPO_ROOT, 'apps', 'web', 'src'),
];

interface Violation {
  file: string;
  line: number;
  name: string;
  suggestion: string;
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
    } else if (e.isFile() && (p.endsWith('.ts') || p.endsWith('.tsx'))) {
      if (p.includes('.test.') || p.includes('.spec.')) continue;
      acc.push(p);
    }
  }
  return acc;
}

/**
 * A name is a "non-canonical mapper" if it:
 *   - starts with `map` (lowercase, conventional prefix)
 *   - ends in `Response`
 *   - does NOT contain `ToResponse` (the canonical marker)
 */
export function isNonCanonicalMapperName(name: string): boolean {
  if (!/^map[A-Z]\w*Response$/.test(name)) return false;
  return !name.includes('ToResponse');
}

/**
 * Suggest a canonical name. Convention: insert `RowTo` before the final
 * `Response` token. `mapNoteResponse` → `mapNoteRowToResponse`.
 *
 * Already-canonical names (containing `ToResponse`) and non-mapper names
 * are returned unchanged.
 */
export function suggestCanonicalName(name: string): string {
  if (!name.endsWith('Response')) return name;
  if (name.includes('ToResponse')) return name; // already canonical
  const stem = name.slice(0, -'Response'.length); // mapNote
  return `${stem}RowToResponse`;
}

function scanFile(filePath: string): Violation[] {
  const source = fs.readFileSync(filePath, 'utf-8');
  const sourceFile = ts.createSourceFile(filePath, source, ts.ScriptTarget.Latest, true);
  const relPath = path.relative(REPO_ROOT, filePath);
  const findings: Violation[] = [];

  /** Helper: report a finding for a node with a known identifier name. */
  function report(node: ts.Node, name: string) {
    if (!isNonCanonicalMapperName(name)) return;
    const { line } = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
    findings.push({
      file: relPath,
      line: line + 1,
      name,
      suggestion: suggestCanonicalName(name),
    });
  }

  function visit(node: ts.Node) {
    // Pattern A: `function map<X>Response(...)` or
    // `export function map<X>Response(...)`
    if (ts.isFunctionDeclaration(node) && node.name) {
      report(node, node.name.text);
    }
    // Pattern C (cycle-2 absorb of L3 PR-R1-10 advisory A1): class methods
    // `class X { mapXxxResponse(row) {...} }`. Both regular methods AND
    // method declarations with the `static` modifier are visited.
    if (ts.isMethodDeclaration(node) && ts.isIdentifier(node.name)) {
      report(node, node.name.text);
    }
    // Pattern D (cycle-2 absorb of L3 PR-R1-10 advisory A1): object-literal
    // method shorthand `const o = { mapXxxResponse(row) {...} }`. The
    // MethodDeclaration check above covers both ClassDeclaration and
    // ObjectLiteralExpression containers (TS represents both as
    // `ts.MethodDeclaration` nodes).
    // Pattern E (cycle-2 absorb of L3 PR-R1-10 advisory A1): object-literal
    // arrow / function-expression properties `const o = { mapXxxResponse: (row) => row }`.
    if (
      ts.isPropertyAssignment(node) &&
      ts.isIdentifier(node.name) &&
      (ts.isArrowFunction(node.initializer) || ts.isFunctionExpression(node.initializer))
    ) {
      report(node, node.name.text);
    }
    // Pattern B: `const map<X>Response = (...) => ...` (arrow / function expression)
    if (ts.isVariableStatement(node)) {
      for (const decl of node.declarationList.declarations) {
        if (!ts.isIdentifier(decl.name)) continue;
        if (!decl.initializer) continue;
        if (
          !ts.isArrowFunction(decl.initializer) &&
          !ts.isFunctionExpression(decl.initializer)
        ) continue;
        if (isNonCanonicalMapperName(decl.name.text)) {
          const { line } = sourceFile.getLineAndCharacterOfPosition(decl.getStart(sourceFile));
          findings.push({
            file: relPath,
            line: line + 1,
            name: decl.name.text,
            suggestion: suggestCanonicalName(decl.name.text),
          });
        }
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(sourceFile);
  return findings;
}

function main(): number {
  const files: string[] = [];
  for (const root of SCAN_ROOTS) walk(root, files);
  const violations: Violation[] = [];
  for (const f of files) violations.push(...scanFile(f));

  console.error('→ check-mapper-naming (PR-R1-10; CLAUDE.md §5.2)');
  console.error(`  scanned:    ${files.length} TS file(s)`);
  console.error(`  violations: ${violations.length}`);
  console.error('');

  if (violations.length === 0) {
    console.error('✓ Every map* function uses the canonical *ToResponse form.');
    return 0;
  }

  console.error(`✗ ${violations.length} non-canonical mapper name(s):\n`);
  for (const v of violations) {
    console.error(`  ${v.file}:${v.line}  ${v.name}`);
    console.error(`    suggestion: ${v.suggestion}`);
    console.error('');
  }
  console.error(
    'Fix per CLAUDE.md §5.2: rename to the canonical `*ToResponse` form ' +
      '(typically `map<X>RowToResponse(row)`). Sibling pattern: ' +
      'mapMedicationAdministrationRowToResponse, mapClozapineRegistrationRowToResponse, etc.',
  );
  return 1;
}

if (require.main === module) {
  process.exit(main());
}
