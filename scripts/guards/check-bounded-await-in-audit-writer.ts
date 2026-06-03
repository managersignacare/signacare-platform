#!/usr/bin/env tsx
/**
 * A2 runtime guard — bounded wait semantics in writeAuditLog.
 *
 * Enforces two narrow invariants in apps/api/src/utils/audit.ts:
 *  1. primary DB insert path is wrapped by withTimeout(..., 'audit.write.primaryInsert')
 *  2. outbox enqueue helper is wrapped by withTimeout(..., 'audit.write.enqueueOutbox.*')
 */

import { readFileSync } from 'fs';
import { resolve, relative } from 'path';

const ROOT = resolve(__dirname, '..', '..');
const DEFAULT_SOURCE_PATH = resolve(
  ROOT,
  'apps',
  'api',
  'src',
  'utils',
  'audit.ts',
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

  const violations: Violation[] = [];

  const hasPrimaryInsertTimeout =
    /withTimeout\s*\(\s*insertAuditRowIdempotent\(row\)\s*,[\s\S]*?['"]audit\.write\.primaryInsert['"]/.test(source);
  if (!hasPrimaryInsertTimeout) {
    violations.push({
      file: relFile,
      lineNo: findLineNo(source, 'audit.write.primaryInsert'),
      reason: "primary insert is not bounded with withTimeout(..., 'audit.write.primaryInsert')",
    });
  }

  const hasOutboxHelper = /function\s+enqueueAuditOutboxBounded\s*\(/.test(source);
  if (!hasOutboxHelper) {
    violations.push({
      file: relFile,
      lineNo: findLineNo(source, 'enqueueAuditOutboxBounded'),
      reason: 'enqueueAuditOutboxBounded helper is missing',
    });
  }

  const hasOutboxTimeout =
    /withTimeout\s*\(\s*enqueueAuditOutbox\(row\)\s*,[\s\S]*?(?:['"]audit\.write\.enqueueOutbox\.|`audit\.write\.enqueueOutbox\.\$\{)/.test(source);
  if (!hasOutboxTimeout) {
    violations.push({
      file: relFile,
      lineNo: findLineNo(source, 'audit.write.enqueueOutbox.'),
      reason: "outbox enqueue is not bounded with withTimeout(..., 'audit.write.enqueueOutbox.*')",
    });
  }

  const hasWriterUsage = /enqueueAuditOutboxBounded\s*\(\s*row\s*,/.test(source);
  if (!hasWriterUsage) {
    violations.push({
      file: relFile,
      lineNo: findLineNo(source, 'enqueueAuditOutboxBounded(row'),
      reason: 'writeAuditLog does not route failure path through enqueueAuditOutboxBounded(row, ...)',
    });
  }

  return {
    exitCode: violations.length > 0 ? 1 : 0,
    violations,
  };
}

function main(): number {
  console.log('→ check-bounded-await-in-audit-writer');
  const result = runGuard();
  console.log(`  violations: ${result.violations.length}`);
  if (result.violations.length > 0) {
    for (const violation of result.violations) {
      console.log(`  - ${violation.file}:${violation.lineNo} — ${violation.reason}`);
    }
    return 1;
  }
  console.log('✓ writeAuditLog bounded-wait invariants hold.');
  return 0;
}

if (require.main === module) {
  process.exitCode = main();
}
