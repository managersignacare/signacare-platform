#!/usr/bin/env tsx
/**
 * V1 runtime-honesty guard:
 * - Every k6 scenario must define `thresholds:`
 * - Patient-backed scenarios must use discoverPatientIdOrFail(...)
 * - Patient-backed scenarios must not silently skip workload on missing patientId
 */

import { readFileSync, readdirSync } from 'node:fs';
import { resolve, relative } from 'node:path';

const ROOT = resolve(__dirname, '..', '..');
const DEFAULT_K6_DIR = resolve(ROOT, 'scripts', 'k6');

const PATIENT_SCENARIOS = new Set([
  'baseline.js',
  'load.js',
  'stress.js',
  'spike.js',
  'soak.js',
]);

export interface Violation {
  file: string;
  reason: string;
}

export interface RunGuardOpts {
  k6Dir?: string;
}

export interface RunGuardResult {
  exitCode: number;
  scannedFiles: number;
  violations: Violation[];
}

function isScenarioFile(file: string): boolean {
  if (!file.endsWith('.js')) return false;
  if (file === 'README.md' || file === 'db-explain.sql') return false;
  if (file.startsWith('lib/')) return false;
  return true;
}

export function runGuard(opts: RunGuardOpts = {}): RunGuardResult {
  const k6Dir = opts.k6Dir ?? DEFAULT_K6_DIR;
  const files = readdirSync(k6Dir)
    .filter(isScenarioFile)
    .map((name) => resolve(k6Dir, name));

  const violations: Violation[] = [];

  for (const file of files) {
    const rel = relative(ROOT, file);
    const source = readFileSync(file, 'utf8');

    if (!/\bthresholds\s*:/.test(source)) {
      violations.push({ file: rel, reason: 'missing thresholds block in k6 options' });
    }

    if (PATIENT_SCENARIOS.has(file.split('/').at(-1) ?? '')) {
      if (!/discoverPatientIdOrFail/.test(source)) {
        violations.push({
          file: rel,
          reason: 'patient scenario must use discoverPatientIdOrFail(...) in setup',
        });
      }
      if (/\bif\s*\(\s*!data\.patientId\s*\)\s*\{[\s\S]*?\breturn\s*;/.test(source)) {
        violations.push({
          file: rel,
          reason: 'patient scenario contains fail-open early return on missing patientId',
        });
      }
    }
  }

  return {
    exitCode: violations.length > 0 ? 1 : 0,
    scannedFiles: files.length,
    violations,
  };
}

function main(): number {
  console.log('→ check-k6-thresholds');
  const result = runGuard();
  console.log(`  scanned files: ${result.scannedFiles}`);
  console.log(`  violations:   ${result.violations.length}`);
  if (result.violations.length > 0) {
    for (const violation of result.violations) {
      console.log(`  - ${violation.file} — ${violation.reason}`);
    }
    return 1;
  }
  console.log('✓ k6 scenario thresholds and fail-closed patient probes are enforced.');
  return 0;
}

if (require.main === module) {
  process.exitCode = main();
}
