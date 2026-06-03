#!/usr/bin/env tsx
/**
 * V2 contract-drift guard:
 * Reject ambiguous integration-test validation assertions (`400/422`).
 *
 * Rationale:
 * - `400` and `422` represent different API contracts in this repo.
 * - Allowing combined assertions hides route-level drift and lets
 *   regressions pass without surfacing the contract mismatch.
 */

import { readdirSync, readFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

const ROOT = resolve(__dirname, '..', '..');
const DEFAULT_TEST_ROOT = resolve(ROOT, 'apps', 'api', 'tests', 'integration');
const EXEMPT_TAG = '@validation-status-ambiguous-exempt:';

const AMBIGUOUS_PATTERNS = [
  /\[\s*400\s*,\s*422\s*\]/,
  /\b400\/422\b/,
];

export interface Violation {
  file: string;
  line: number;
  reason: string;
  excerpt: string;
}

export interface RunGuardResult {
  exitCode: number;
  violations: Violation[];
}

export interface RunGuardOpts {
  rootDir?: string;
}

function walkFiles(root: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    if (entry.name.startsWith('.')) continue;
    const full = join(root, entry.name);
    if (entry.isDirectory()) {
      out.push(...walkFiles(full));
      continue;
    }
    if (entry.isFile() && entry.name.endsWith('.ts')) {
      out.push(full);
    }
  }
  return out;
}

function hasExemption(lines: string[], idx: number): { ok: boolean; badTag: boolean } {
  const current = lines[idx] ?? '';
  const prev = lines[idx - 1] ?? '';
  const prev2 = lines[idx - 2] ?? '';
  const tagPresent = [current, prev, prev2].some((line) => line.includes(EXEMPT_TAG));
  if (!tagPresent) return { ok: false, badTag: false };

  const withReason = [current, prev, prev2].some((line) =>
    new RegExp(`${EXEMPT_TAG}\\s*\\S+`).test(line),
  );
  if (withReason) return { ok: true, badTag: false };
  return { ok: false, badTag: true };
}

function scanFile(file: string): Violation[] {
  const source = readFileSync(file, 'utf8');
  const lines = source.split('\n');
  const violations: Violation[] = [];

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i] ?? '';
    if (!AMBIGUOUS_PATTERNS.some((pattern) => pattern.test(line))) continue;
    const exemption = hasExemption(lines, i);
    if (exemption.ok) continue;

    violations.push({
      file: relative(ROOT, file),
      line: i + 1,
      reason: exemption.badTag
        ? `${EXEMPT_TAG} is present but missing a non-empty reason`
        : 'ambiguous validation-status contract (`400/422`)',
      excerpt: line.trim().slice(0, 180),
    });
  }

  return violations;
}

export function runGuard(opts: RunGuardOpts = {}): RunGuardResult {
  const testRoot = opts.rootDir ? resolve(opts.rootDir) : DEFAULT_TEST_ROOT;
  const files = walkFiles(testRoot);
  const violations = files.flatMap(scanFile);
  return {
    exitCode: violations.length > 0 ? 1 : 0,
    violations,
  };
}

function main(): number {
  console.log('→ check-no-ambiguous-validation-status');
  const result = runGuard();
  console.log(`  scanned: ${DEFAULT_TEST_ROOT}`);
  console.log(`  violations: ${result.violations.length}`);
  if (result.violations.length === 0) {
    console.log('✓ No ambiguous 400/422 validation assertions found.');
    return 0;
  }

  for (const violation of result.violations) {
    console.log(`  - ${violation.file}:${violation.line} — ${violation.reason}`);
    console.log(`      ${violation.excerpt}`);
  }

  console.log('');
  console.log(
    'Fix shape: assert one canonical status per route (e.g., `expect(res.status).toBe(422)`), ' +
      `or add \`${EXEMPT_TAG} BUG-XXX <reason>\` directly above the line for an explicit migration window.`,
  );
  return 1;
}

if (require.main === module) {
  process.exitCode = main();
}
