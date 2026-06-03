#!/usr/bin/env tsx
/**
 * V2 substrate guard:
 * - canonical persona fixture must exist in one place
 * - integration helper must source admin credentials from canonical fixture
 */

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { resolve, relative, join } from 'node:path';

const ROOT = resolve(__dirname, '..', '..');
const DEFAULT_FIXTURE = resolve(ROOT, 'apps', 'api', 'tests', 'fixtures', 'canonical-personas.ts');
const DEFAULT_HELPERS = resolve(ROOT, 'apps', 'api', 'tests', 'integration', '_helpers.ts');
const DEFAULT_TESTS_ROOT = resolve(ROOT, 'apps', 'api', 'tests');

export interface Violation {
  file: string;
  reason: string;
}

export interface RunGuardOpts {
  fixturePath?: string;
  helpersPath?: string;
  testsRoot?: string;
}

export interface RunGuardResult {
  exitCode: number;
  violations: Violation[];
}

function walkFiles(root: string): string[] {
  const out: string[] = [];
  const entries = readdirSync(root, { withFileTypes: true });
  for (const entry of entries) {
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

export function runGuard(opts: RunGuardOpts = {}): RunGuardResult {
  const fixturePath = opts.fixturePath ?? DEFAULT_FIXTURE;
  const helpersPath = opts.helpersPath ?? DEFAULT_HELPERS;
  const testsRoot = opts.testsRoot ?? DEFAULT_TESTS_ROOT;
  const violations: Violation[] = [];

  if (!existsSync(fixturePath)) {
    violations.push({
      file: relative(ROOT, fixturePath),
      reason: 'canonical persona fixture file is missing',
    });
    return { exitCode: 1, violations };
  }

  if (!existsSync(helpersPath)) {
    violations.push({
      file: relative(ROOT, helpersPath),
      reason: 'integration helper file is missing',
    });
    return { exitCode: 1, violations };
  }

  const fixtureSource = readFileSync(fixturePath, 'utf8');
  const helpersSource = readFileSync(helpersPath, 'utf8');

  if (!/export const CANONICAL_PERSONAS\b/.test(fixtureSource)) {
    violations.push({
      file: relative(ROOT, fixturePath),
      reason: 'fixture must export CANONICAL_PERSONAS',
    });
  }

  if (!/export const CANONICAL_PASSWORD\b/.test(fixtureSource)) {
    violations.push({
      file: relative(ROOT, fixturePath),
      reason: 'fixture must export CANONICAL_PASSWORD',
    });
  }

  if (!/from ['"]\.\.\/fixtures\/canonical-personas['"]/.test(helpersSource)) {
    violations.push({
      file: relative(ROOT, helpersPath),
      reason: 'integration helper must import canonical personas fixture',
    });
  }

  if (/export const TEST_ADMIN_EMAIL\s*=\s*['"]admin@signacare\.local['"]/.test(helpersSource)) {
    violations.push({
      file: relative(ROOT, helpersPath),
      reason: 'TEST_ADMIN_EMAIL must reference CANONICAL_PERSONAS, not a string literal',
    });
  }

  if (/export const TEST_ADMIN_PASSWORD\s*=\s*['"]Password1!['"]/.test(helpersSource)) {
    violations.push({
      file: relative(ROOT, helpersPath),
      reason: 'TEST_ADMIN_PASSWORD must reference CANONICAL_PASSWORD, not a string literal',
    });
  }

  const files = walkFiles(testsRoot);
  const exportsFound = files
    .map((file) => ({ file, source: readFileSync(file, 'utf8') }))
    .filter(({ source }) => /\bexport const CANONICAL_PERSONAS\b/.test(source));

  if (exportsFound.length !== 1 || exportsFound[0]?.file !== fixturePath) {
    const locations = exportsFound.map(({ file }) => relative(ROOT, file)).join(', ') || 'none';
    violations.push({
      file: relative(ROOT, fixturePath),
      reason:
        `expected exactly one CANONICAL_PERSONAS export at fixture path; found ${exportsFound.length} ` +
        `(locations: ${locations})`,
    });
  }

  return {
    exitCode: violations.length > 0 ? 1 : 0,
    violations,
  };
}

function main(): number {
  console.log('→ check-canonical-persona-seed-singleton');
  const result = runGuard();
  console.log(`  violations: ${result.violations.length}`);
  if (result.violations.length > 0) {
    for (const violation of result.violations) {
      console.log(`  - ${violation.file} — ${violation.reason}`);
    }
    return 1;
  }
  console.log('✓ Canonical persona seed singleton invariants hold.');
  return 0;
}

if (require.main === module) {
  process.exitCode = main();
}
