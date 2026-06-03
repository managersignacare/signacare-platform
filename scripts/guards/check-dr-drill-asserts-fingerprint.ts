#!/usr/bin/env tsx
/**
 * V1 runtime-honesty guard for DR restore drill.
 *
 * Enforces:
 * - schema fingerprint is required (fail closed if missing)
 * - source and restored schema fingerprints are checked against expected
 * - sample patient assertion does not silently skip
 */

import { readFileSync } from 'node:fs';
import { resolve, relative } from 'node:path';

const ROOT = resolve(__dirname, '..', '..');
const DEFAULT_DR_SCRIPT = resolve(ROOT, 'scripts', 'dr', 'restore-drill.sh');

export interface Violation {
  file: string;
  reason: string;
}

export interface RunGuardOpts {
  sourcePath?: string;
}

export interface RunGuardResult {
  exitCode: number;
  violations: Violation[];
}

function has(source: string, pattern: RegExp): boolean {
  return pattern.test(source);
}

export function runGuard(opts: RunGuardOpts = {}): RunGuardResult {
  const sourcePath = opts.sourcePath ?? DEFAULT_DR_SCRIPT;
  const rel = relative(ROOT, sourcePath);
  const source = readFileSync(sourcePath, 'utf8');
  const violations: Violation[] = [];

  if (!has(source, /EXPECTED_SCHEMA_FINGERPRINT(_FILE)?=/)) {
    violations.push({
      file: rel,
      reason: 'missing expected schema fingerprint configuration',
    });
  }

  if (!has(source, /Expected DR schema fingerprint missing or invalid/)) {
    violations.push({
      file: rel,
      reason: 'missing fail-closed fingerprint validation message',
    });
  }

  if (!has(source, /SOURCE_SCHEMA_FP=.*schema_fingerprint/)) {
    violations.push({
      file: rel,
      reason: 'missing source schema fingerprint generation',
    });
  }

  if (!has(source, /RESTORED_SCHEMA_FP=.*schema_fingerprint/)) {
    violations.push({
      file: rel,
      reason: 'missing restored schema fingerprint generation',
    });
  }

  if (!has(source, /schema fingerprint mismatch/)) {
    violations.push({
      file: rel,
      reason: 'missing schema mismatch failure path',
    });
  }

  if (has(source, /skipping round-trip assertion/)) {
    violations.push({
      file: rel,
      reason: 'contains skip path for sample-patient round-trip assertion',
    });
  }

  if (!has(source, /source has zero rows/)) {
    violations.push({
      file: rel,
      reason: 'missing source non-zero row-count assertion',
    });
  }

  if (!has(source, /restored has zero rows/)) {
    violations.push({
      file: rel,
      reason: 'missing restored non-zero row-count assertion',
    });
  }

  if (!has(source, /sample patient round-trip missing/)) {
    violations.push({
      file: rel,
      reason: 'missing fail-closed sample patient assertion',
    });
  }

  return {
    exitCode: violations.length > 0 ? 1 : 0,
    violations,
  };
}

function main(): number {
  console.log('→ check-dr-drill-asserts-fingerprint');
  const result = runGuard();
  console.log(`  violations: ${result.violations.length}`);
  if (result.violations.length > 0) {
    for (const v of result.violations) {
      console.log(`  - ${v.file} — ${v.reason}`);
    }
    return 1;
  }
  console.log('✓ DR restore drill asserts schema fingerprint + non-skip critical checks.');
  return 0;
}

if (require.main === module) {
  process.exitCode = main();
}
