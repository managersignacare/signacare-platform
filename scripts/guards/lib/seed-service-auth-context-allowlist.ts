#!/usr/bin/env tsx
/*
 * scripts/guards/lib/seed-service-auth-context-allowlist.ts
 *
 * Phase R1 PR-R1-2 — one-shot seed for the service AuthContext allowlist.
 *
 * Reads the current state of `apps/api/src/features/(* /)*Service.ts`,
 * runs the same AST analysis as `check-service-auth-context.ts`, and
 * emits fingerprint-format allowlist entries for every method whose
 * first parameter is NOT `auth: AuthContext`. Per CLAUDE.md §13
 * incremental adoption — services migrate when next touched.
 *
 * Each violation may produce a duplicate entry (multiplicity-aware) when
 * the same line-content appears multiple times in the file.
 *
 * Run: `npx tsx scripts/guards/lib/seed-service-auth-context-allowlist.ts`
 *
 * Output is appended to scripts/guards/check-service-auth-context.allowlist.
 */

import * as fs from 'fs';
import * as path from 'path';
import * as ts from 'typescript';
import { fingerprint } from './allowlist-fingerprint';

const REPO_ROOT = path.resolve(__dirname, '..', '..', '..');
const SCAN_ROOT = path.join(REPO_ROOT, 'apps', 'api', 'src', 'features');
const ALLOWLIST_PATH = path.join(__dirname, '..', 'check-service-auth-context.allowlist');

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
  if (params.length === 0) return { kind: 'pass-empty', firstParam: '<empty>' };
  const first = params[0]!;
  const name = first.name.getText();
  const typeText = first.type ? first.type.getText() : '<no-type>';
  const display = `${name}: ${typeText}`;
  if (name === 'auth' && typeText.includes('AuthContext')) return { kind: 'pass-auth', firstParam: display };
  if (
    typeText === 'Knex' ||
    typeText === 'Knex.Transaction' ||
    typeText.endsWith('.Knex') ||
    typeText.endsWith('.Transaction') ||
    /^Knex(<|\.)/.test(typeText)
  ) return { kind: 'pass-knex', firstParam: display };
  return { kind: 'fail', firstParam: display };
}

function findServiceConstantInitializer(sourceFile: ts.SourceFile): ts.ObjectLiteralExpression | null {
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

interface SeedEntry {
  file: string;
  fingerprint: string;
  method: string;
  line: number;
}

function scanServiceFile(filePath: string): SeedEntry[] {
  const source = fs.readFileSync(filePath, 'utf-8');
  const lines = source.split('\n');
  const sourceFile = ts.createSourceFile(filePath, source, ts.ScriptTarget.Latest, true);
  const out: SeedEntry[] = [];
  const relPath = path.relative(REPO_ROOT, filePath);

  function record(node: ts.Node, methodName: string) {
    const { line } = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
    const lineno = line + 1;
    const lineContent = lines[line] ?? '';
    const fp = fingerprint(lineContent);
    if (!fp) return; // skip empty lines
    out.push({ file: relPath, fingerprint: fp, method: methodName, line: lineno });
  }

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
        record(prop, methodName);
      }
    }
  }

  for (const stmt of sourceFile.statements) {
    if (!ts.isFunctionDeclaration(stmt)) continue;
    const exported = stmt.modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword);
    if (!exported) continue;
    if (!stmt.name) continue;
    const methodName = stmt.name.text;
    const shape = getFirstParamShape(stmt.parameters);
    if (shape.kind === 'fail') {
      record(stmt, methodName);
    }
  }
  return out;
}

function main(): void {
  const files = walk(SCAN_ROOT);
  const entries: SeedEntry[] = [];
  for (const f of files) {
    entries.push(...scanServiceFile(f));
  }

  // Group by file for tidier output
  entries.sort((a, b) => (a.file === b.file ? a.line - b.line : a.file.localeCompare(b.file)));

  const lines = entries.map(
    (e) =>
      `${e.file} ${e.fingerprint}  # PR-R1-2 baseline original-lineno:${e.line} method=${e.method} | BUG-AUTHCONTEXT-MIGRATE-SERVICE-CONSUMERS — pre-existing service method not yet migrated to AuthContext per CLAUDE.md §13`,
  );

  const existing = fs.readFileSync(ALLOWLIST_PATH, 'utf-8');
  const next = existing + (existing.endsWith('\n') ? '' : '\n') + lines.join('\n') + '\n';
  fs.writeFileSync(ALLOWLIST_PATH, next, 'utf-8');
  console.log(`Seeded ${entries.length} entries into ${path.relative(REPO_ROOT, ALLOWLIST_PATH)}`);
}

main();
