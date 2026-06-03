#!/usr/bin/env tsx
/**
 * C3-1 guard: baseline suppressions must remain explicit, expiring, and BUG-mapped.
 */

import { readFileSync } from 'node:fs';
import { resolve, relative } from 'node:path';

const ROOT = resolve(__dirname, '..', '..');
const DEFAULT_BASELINE_PATH = resolve(ROOT, 'e2e', 'accessibility', 'a11y-baseline-allowlist.json');
const DEFAULT_BUG_LEDGER_PATH = resolve(ROOT, 'docs', 'quality', 'bugs-remaining.md');

interface BaselineEntry {
  surface: string;
  impact: string;
  ruleId: string;
  bugId: string;
  expiresOn: string;
  reason: string;
}

interface BaselineFile {
  version: number;
  generatedAt: string;
  sourceCommand: string;
  entries: BaselineEntry[];
}

export interface Violation {
  reason: string;
}

export interface RunGuardOpts {
  baselinePath?: string;
  bugLedgerPath?: string;
}

export interface RunGuardResult {
  exitCode: 0 | 1;
  violations: Violation[];
}

function isValidIsoDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const dt = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(dt.getTime()) && dt.toISOString().slice(0, 10) === value;
}

function isExpired(value: string): boolean {
  const expiry = new Date(`${value}T00:00:00.000Z`);
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);
  return expiry < today;
}

function collectBugIds(ledgerSource: string): Set<string> {
  const set = new Set<string>();
  for (const match of ledgerSource.matchAll(/\bBUG-[A-Z0-9.-]+\b/g)) {
    set.add(match[0]);
  }
  return set;
}

export function runGuard(opts: RunGuardOpts = {}): RunGuardResult {
  const baselinePath = opts.baselinePath ?? DEFAULT_BASELINE_PATH;
  const bugLedgerPath = opts.bugLedgerPath ?? DEFAULT_BUG_LEDGER_PATH;
  const baselineRel = relative(ROOT, baselinePath);
  const ledgerRel = relative(ROOT, bugLedgerPath);
  const violations: Violation[] = [];

  let baseline: BaselineFile | null = null;
  try {
    baseline = JSON.parse(readFileSync(baselinePath, 'utf8')) as BaselineFile;
  } catch (error) {
    violations.push({
      reason: `${baselineRel}: invalid/missing baseline JSON (${error instanceof Error ? error.message : String(error)})`,
    });
    return { exitCode: 1, violations };
  }

  let bugIds: Set<string> = new Set();
  try {
    bugIds = collectBugIds(readFileSync(bugLedgerPath, 'utf8'));
  } catch (error) {
    violations.push({
      reason: `${ledgerRel}: could not read bug ledger (${error instanceof Error ? error.message : String(error)})`,
    });
    return { exitCode: 1, violations };
  }

  if (!Array.isArray(baseline.entries) || baseline.entries.length === 0) {
    violations.push({
      reason: `${baselineRel}: entries must contain at least one mapped suppression`,
    });
    return { exitCode: 1, violations };
  }

  const uniqueKeys = new Set<string>();
  baseline.entries.forEach((entry, idx) => {
    const prefix = `${baselineRel}:entries[${idx}]`;
    if (!entry.surface || typeof entry.surface !== 'string') {
      violations.push({ reason: `${prefix}: surface is required` });
    }
    if (!entry.ruleId || typeof entry.ruleId !== 'string') {
      violations.push({ reason: `${prefix}: ruleId is required` });
    }
    if (entry.impact !== 'critical' && entry.impact !== 'serious') {
      violations.push({ reason: `${prefix}: impact must be 'critical' or 'serious'` });
    }
    if (!/^BUG-[A-Z0-9.-]+$/.test(entry.bugId ?? '')) {
      violations.push({ reason: `${prefix}: bugId must match BUG-* format` });
    } else if (!bugIds.has(entry.bugId)) {
      violations.push({ reason: `${prefix}: bugId ${entry.bugId} not found in ${ledgerRel}` });
    }
    if (!isValidIsoDate(entry.expiresOn ?? '')) {
      violations.push({ reason: `${prefix}: expiresOn must be YYYY-MM-DD` });
    } else if (isExpired(entry.expiresOn)) {
      violations.push({ reason: `${prefix}: expiresOn ${entry.expiresOn} is in the past` });
    }
    if (!entry.reason || typeof entry.reason !== 'string') {
      violations.push({ reason: `${prefix}: reason is required` });
    }

    const key = `${entry.surface}|${entry.impact}|${entry.ruleId}`;
    if (uniqueKeys.has(key)) {
      violations.push({ reason: `${prefix}: duplicate suppression key ${key}` });
    } else {
      uniqueKeys.add(key);
    }
  });

  return {
    exitCode: violations.length > 0 ? 1 : 0,
    violations,
  };
}

function main(): number {
  console.log('→ check-a11y-baseline-allowlist');
  const result = runGuard();
  console.log(`  violations: ${result.violations.length}`);
  if (result.violations.length > 0) {
    for (const violation of result.violations) {
      console.log(`  - ${violation.reason}`);
    }
    return 1;
  }
  console.log('✓ A11y baseline suppressions are BUG-mapped, expiring, and structurally valid.');
  return 0;
}

if (require.main === module) {
  process.exitCode = main();
}
