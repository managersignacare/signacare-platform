#!/usr/bin/env tsx
/*
 * scripts/guards/lib/seed-zod-schema-parity-allowlist.ts
 *
 * Phase R1 PR-R1-11 — one-shot seed for the Zod schema parity allowlist.
 * Inlined-helper version (mirrors the runtime guard for consistency).
 */
import * as fs from 'fs';
import * as path from 'path';
import * as ts from 'typescript';
import { findConventionalRule } from '../check-zod-schema-parity';

const REPO_ROOT = path.resolve(__dirname, '..', '..', '..');
const SCAN_ROOT = path.join(REPO_ROOT, 'packages', 'shared', 'src');
const ALLOWLIST_PATH = path.join(__dirname, '..', 'check-zod-schema-parity.allowlist');

function walk(dir: string, acc: string[] = []): string[] {
  let entries: fs.Dirent[];
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); }
  catch { return acc; }
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

interface Entry {
  file: string;
  schemaName: string;
  fieldName: string;
}

function scanFile(filePath: string): Entry[] {
  const source = fs.readFileSync(filePath, 'utf-8');
  // Pre-filter parity with runtime guard (cycle-2 absorb obs #1):
  // a future schema file using ONLY `.extend(...)` (importing base
  // from elsewhere) was latent-uncovered with the cycle-1 z.object-only
  // pre-filter. Match the runtime guard's filter exactly.
  if (!source.includes('z.object') && !source.includes('.extend(')) return [];
  const sourceFile = ts.createSourceFile(filePath, source, ts.ScriptTarget.Latest, true);
  const relPath = path.relative(REPO_ROOT, filePath);
  const out: Entry[] = [];

  function isZodFieldsObjectLiteralCall(node: ts.CallExpression): boolean {
    if (!node.arguments[0] || !ts.isObjectLiteralExpression(node.arguments[0])) return false;
    const callee = node.expression;
    if (
      ts.isPropertyAccessExpression(callee) &&
      callee.name.text === 'object' &&
      ts.isIdentifier(callee.expression) &&
      callee.expression.text === 'z'
    ) return true;
    if (
      ts.isPropertyAccessExpression(callee) &&
      (callee.name.text === 'extend' || callee.name.text === 'merge')
    ) return true;
    return false;
  }

  function visit(node: ts.Node) {
    if (ts.isCallExpression(node) && isZodFieldsObjectLiteralCall(node)) {
      const arg = node.arguments[0]! as ts.ObjectLiteralExpression;
      let parent: ts.Node = node;
      let schemaName = '<anonymous>';
      while (parent) {
        if (ts.isVariableDeclaration(parent) && ts.isIdentifier(parent.name)) {
          schemaName = parent.name.text;
          break;
        }
        if (!parent.parent) break;
        parent = parent.parent;
      }
      for (const prop of arg.properties) {
        if (!ts.isPropertyAssignment(prop)) continue;
        if (!ts.isIdentifier(prop.name)) continue;
        const fieldName = prop.name.text;
        const rule = findConventionalRule(fieldName);
        if (!rule) continue;
        // Cycle-2 absorb: honor inline `@zod-convention-exempt:` annotation
        // (sibling consistency with the runtime guard's behaviour).
        const fullText = sourceFile.getFullText();
        const propStart = prop.getFullStart();
        const leadingTrivia = fullText.substring(propStart, prop.getStart(sourceFile));
        if (/\/\/\s*@zod-convention-exempt:\s*\S/.test(leadingTrivia)) continue;
        const initializerText = prop.initializer.getText(sourceFile);
        const reason = rule.check(initializerText);
        if (reason) {
          out.push({ file: relPath, schemaName, fieldName });
        }
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(sourceFile);
  return out;
}

function main(): void {
  const files = walk(SCAN_ROOT);
  const entries: Entry[] = [];
  for (const f of files) entries.push(...scanFile(f));
  entries.sort((a, b) => a.file.localeCompare(b.file) || a.schemaName.localeCompare(b.schemaName) || a.fieldName.localeCompare(b.fieldName));

  const header = `# scripts/guards/check-zod-schema-parity.allowlist
#
# Phase R1 PR-R1-11 — pre-existing Zod schema fields that violate the
# convention-based parity check. Each entry is a (file, schema, field)
# tuple. Drained as schemas migrate per CLAUDE.md §5.1 / §15
# (BUG-PR-R1-11-CASCADE-DRAIN-CONVENTION).
#
# Format: <file>:<schemaName>:<fieldName>  # reason
#
# IMPORTANT: NEW Zod schema fields should NOT be allowlisted as a
# workaround. Tighten the Zod type to match the convention instead.
# This allowlist is for the pre-existing baseline only.
`;

  const lines = entries.map(
    (e) => `${e.file}:${e.schemaName}:${e.fieldName}  # PR-R1-11 baseline; drain via BUG-PR-R1-11-CASCADE-DRAIN-CONVENTION`,
  );
  const content = header + '\n' + lines.join('\n') + '\n';
  fs.writeFileSync(ALLOWLIST_PATH, content, 'utf-8');
  console.log(`Seeded ${entries.length} entries into ${path.relative(REPO_ROOT, ALLOWLIST_PATH)}`);
}

main();
