#!/usr/bin/env tsx
/**
 * A2 caller-consistency guard.
 *
 * Policy:
 * - Shared writeAuditLog timeout/fallback semantics live in utils/audit.ts.
 * - Caller-level wrappers (withTimeout/Promise.race around writeAuditLog)
 *   are disallowed unless explicitly exempted.
 *
 * Exemption format (line above wrapper):
 *   // @write-audit-timeout-exempt: <reason>
 */

import { readdirSync, readFileSync, statSync } from 'fs';
import { join, resolve, relative } from 'path';
import ts from 'typescript';

const ROOT = resolve(__dirname, '..', '..');
const API_SRC = resolve(ROOT, 'apps', 'api', 'src');

const IGNORE_DIRS = new Set([
  'dist',
  'build',
  'coverage',
  '__tests__',
  '__fixtures__',
  'migrations',
]);

const EXEMPT_REGEX = /@write-audit-timeout-exempt:\s*\S/;

export interface Violation {
  file: string;
  lineNo: number;
  reason: string;
  preview: string;
}

export interface RunGuardOpts {
  files?: string[];
}

export interface RunGuardResult {
  exitCode: number;
  scannedFiles: number;
  wrappedSites: number;
  exemptedSites: number;
  violations: Violation[];
}

function collectTsFiles(dir: string): string[] {
  const out: string[] = [];
  for (const ent of readdirSync(dir)) {
    if (ent.startsWith('.')) continue;
    const full = join(dir, ent);
    const st = statSync(full);
    if (st.isDirectory()) {
      if (IGNORE_DIRS.has(ent)) continue;
      out.push(...collectTsFiles(full));
      continue;
    }
    if (!full.endsWith('.ts')) continue;
    if (full.endsWith('.test.ts') || full.endsWith('.int.test.ts')) continue;
    out.push(full);
  }
  return out;
}

function buildLineOffsets(source: string): number[] {
  const offsets = [0];
  for (let i = 0; i < source.length; i += 1) {
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

function hasExemption(source: string, lineNo: number, lineOffsets: number[]): boolean {
  const lookback = 6;
  const firstLine = Math.max(1, lineNo - lookback);
  for (let ln = lineNo - 1; ln >= firstLine; ln -= 1) {
    const start = lineOffsets[ln - 1];
    const end = lineOffsets[ln];
    const line = source.slice(start, end);
    if (EXEMPT_REGEX.test(line)) {
      return true;
    }
  }
  return false;
}

function expressionName(node: ts.Expression): string {
  if (ts.isIdentifier(node)) return node.text;
  if (ts.isPropertyAccessExpression(node)) {
    return `${expressionName(node.expression)}.${node.name.text}`;
  }
  return node.getText();
}

function containsWriteAuditLogCall(node: ts.Node): boolean {
  let found = false;
  const visit = (n: ts.Node) => {
    if (found) return;
    if (ts.isCallExpression(n) && expressionName(n.expression).endsWith('writeAuditLog')) {
      found = true;
      return;
    }
    ts.forEachChild(n, visit);
  };
  visit(node);
  return found;
}

function isWriteAuditWrapper(call: ts.CallExpression): boolean {
  const name = expressionName(call.expression);
  if (name === 'withTimeout') {
    const [firstArg] = call.arguments;
    return !!firstArg && containsWriteAuditLogCall(firstArg);
  }
  if (name === 'Promise.race') {
    const [firstArg] = call.arguments;
    return !!firstArg && containsWriteAuditLogCall(firstArg);
  }
  return false;
}

export function runGuard(opts: RunGuardOpts = {}): RunGuardResult {
  const files = opts.files ?? collectTsFiles(API_SRC);
  const violations: Violation[] = [];
  let wrappedSites = 0;
  let exemptedSites = 0;

  for (const file of files) {
    let source = '';
    try {
      source = readFileSync(file, 'utf8');
    } catch {
      violations.push({
        file: relative(ROOT, file),
        lineNo: 1,
        reason: 'source file missing or unreadable',
        preview: '',
      });
      continue;
    }

    const sourceFile = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
    const lines = source.split('\n');
    const lineOffsets = buildLineOffsets(source);

    const visit = (node: ts.Node): void => {
      if (ts.isCallExpression(node) && isWriteAuditWrapper(node)) {
        wrappedSites += 1;
        const lineNo = lineNoOfIndex(lineOffsets, node.getStart(sourceFile));
        if (hasExemption(source, lineNo, lineOffsets)) {
          exemptedSites += 1;
        } else {
          violations.push({
            file: relative(ROOT, file),
            lineNo,
            reason: 'caller-level timeout/race wrapper around writeAuditLog without exemption rationale',
            preview: (lines[lineNo - 1] ?? '').trim().slice(0, 200),
          });
        }
      }
      ts.forEachChild(node, visit);
    };

    visit(sourceFile);
  }

  return {
    exitCode: violations.length > 0 ? 1 : 0,
    scannedFiles: files.length,
    wrappedSites,
    exemptedSites,
    violations,
  };
}

function main(): number {
  console.log('→ check-write-audit-timeout-policy');
  const result = runGuard();
  console.log(`  scanned files:  ${result.scannedFiles}`);
  console.log(`  wrapped sites:  ${result.wrappedSites}`);
  console.log(`  exempted sites: ${result.exemptedSites}`);
  console.log(`  violations:     ${result.violations.length}`);

  if (result.violations.length > 0) {
    for (const v of result.violations) {
      console.log(`  - ${v.file}:${v.lineNo} — ${v.reason}`);
      if (v.preview) console.log(`      ${v.preview}`);
    }
    return 1;
  }

  console.log('✓ writeAuditLog caller-timeout policy holds.');
  return 0;
}

if (require.main === module) {
  process.exitCode = main();
}
