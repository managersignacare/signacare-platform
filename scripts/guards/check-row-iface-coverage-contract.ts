#!/usr/bin/env tsx
/**
 * BUG-SA-102
 *
 * Enforces coverage-ratchet checkpoints for row-interface drift checking.
 * This turns the "unbound/skipped interface" class into an explicit,
 * measurable burn-down contract rather than a static tolerated metric.
 */

import { existsSync, readFileSync } from 'node:fs';
import { resolve, relative } from 'node:path';
import { runCheck } from './check-row-interface-matches-db';

type Milestone = {
  date: string;
  maxUnbound: number;
  minVerified: number;
  minEffectiveCoveragePct: number;
};

type Contract = {
  version: number;
  finalDeadline: string;
  milestones: Milestone[];
};

const ROOT = resolve(__dirname, '..', '..');
const SNAPSHOT = resolve(ROOT, 'apps', 'api', 'src', 'db', 'schema-snapshot.json');
const ALLOWLIST = resolve(__dirname, 'check-row-interface-matches-db.allowlist');
const CONTRACT_FILE = resolve(ROOT, '.github', 'row-iface-coverage-contract.json');
const EXPECTED_FINAL_DEADLINE = '2026-12-31';
const TODAY = new Date().toISOString().slice(0, 10);

function parseIsoDate(input: string): number {
  const value = Date.parse(`${input}T00:00:00.000Z`);
  if (Number.isNaN(value)) throw new Error(`Invalid ISO date '${input}'`);
  return value;
}

function currentMilestone(milestones: Milestone[], todayMs: number): Milestone {
  const sorted = [...milestones].sort((a, b) => parseIsoDate(a.date) - parseIsoDate(b.date));
  let checkpoint = sorted[0];
  for (const milestone of sorted) {
    if (parseIsoDate(milestone.date) <= todayMs) checkpoint = milestone;
  }
  return checkpoint;
}

function percent(numerator: number, denominator: number): number {
  if (denominator <= 0) return 100;
  return Number(((numerator / denominator) * 100).toFixed(2));
}

function main(): void {
  if (!existsSync(CONTRACT_FILE)) {
    console.error(`✗ missing row-iface coverage contract: ${relative(ROOT, CONTRACT_FILE)}`);
    process.exit(1);
  }

  const contract = JSON.parse(readFileSync(CONTRACT_FILE, 'utf8')) as Contract;
  const failures: string[] = [];
  if (contract.version !== 1) failures.push(`contract version must be 1 (found ${String(contract.version)})`);
  if (contract.finalDeadline !== EXPECTED_FINAL_DEADLINE) {
    failures.push(
      `finalDeadline must be ${EXPECTED_FINAL_DEADLINE} (found ${String(contract.finalDeadline)})`,
    );
  }
  if (!Array.isArray(contract.milestones) || contract.milestones.length === 0) {
    failures.push('contract must include at least one milestone');
  }

  const milestones = [...(contract.milestones ?? [])].sort((a, b) => parseIsoDate(a.date) - parseIsoDate(b.date));
  if (JSON.stringify(milestones) !== JSON.stringify(contract.milestones ?? [])) {
    failures.push('milestones must be sorted ascending by date');
  }
  for (let i = 1; i < milestones.length; i++) {
    if (milestones[i].maxUnbound > milestones[i - 1].maxUnbound) {
      failures.push('maxUnbound must be non-increasing across milestones');
    }
    if (milestones[i].minVerified < milestones[i - 1].minVerified) {
      failures.push('minVerified must be non-decreasing across milestones');
    }
    if (milestones[i].minEffectiveCoveragePct < milestones[i - 1].minEffectiveCoveragePct) {
      failures.push('minEffectiveCoveragePct must be non-decreasing across milestones');
    }
  }
  if (milestones.length > 0 && milestones[milestones.length - 1].maxUnbound !== 0) {
    failures.push('final milestone must drive maxUnbound to 0');
  }
  const finalDeadlineMs = parseIsoDate(contract.finalDeadline);
  if (milestones.length > 0 && parseIsoDate(milestones[milestones.length - 1].date) > finalDeadlineMs) {
    failures.push('last milestone date cannot exceed finalDeadline');
  }

  const rowCheck = runCheck(ROOT, SNAPSHOT, ALLOWLIST);
  if (rowCheck.exitCode !== 0) {
    failures.push(`row-iface drift base guard must pass first (exitCode=${rowCheck.exitCode})`);
  }
  const effectiveDenominator = rowCheck.scanned - rowCheck.exempt;
  const effectiveCoveragePct = percent(rowCheck.verified, effectiveDenominator);
  const checkpoint = currentMilestone(milestones, parseIsoDate(TODAY));

  if (rowCheck.unbound > checkpoint.maxUnbound) {
    failures.push(
      `unbound=${rowCheck.unbound} exceeds checkpoint maxUnbound=${checkpoint.maxUnbound} (as-of ${checkpoint.date})`,
    );
  }
  if (rowCheck.verified < checkpoint.minVerified) {
    failures.push(
      `verified=${rowCheck.verified} below checkpoint minVerified=${checkpoint.minVerified} (as-of ${checkpoint.date})`,
    );
  }
  if (effectiveCoveragePct < checkpoint.minEffectiveCoveragePct) {
    failures.push(
      `effectiveCoveragePct=${effectiveCoveragePct} below checkpoint minEffectiveCoveragePct=${checkpoint.minEffectiveCoveragePct} (as-of ${checkpoint.date})`,
    );
  }

  if (failures.length > 0) {
    console.error('✗ Row-iface coverage contract failed');
    console.error(`  contract: ${relative(ROOT, CONTRACT_FILE)}`);
    for (const failure of failures) console.error(`  - ${failure}`);
    console.error('  current metrics:');
    console.error(`    scanned:               ${rowCheck.scanned}`);
    console.error(`    verified:              ${rowCheck.verified}`);
    console.error(`    exempt:                ${rowCheck.exempt}`);
    console.error(`    unbound:               ${rowCheck.unbound}`);
    console.error(`    effectiveCoveragePct:  ${effectiveCoveragePct}`);
    process.exit(1);
  }

  console.log('✓ Row-iface coverage contract is within checkpoint budget.');
  console.log(`  contract:              ${relative(ROOT, CONTRACT_FILE)}`);
  console.log(`  today:                 ${TODAY}`);
  console.log(`  checkpoint:            ${checkpoint.date}`);
  console.log(`  scanned:               ${rowCheck.scanned}`);
  console.log(`  verified:              ${rowCheck.verified}`);
  console.log(`  exempt:                ${rowCheck.exempt}`);
  console.log(`  unbound:               ${rowCheck.unbound}`);
  console.log(`  effectiveCoveragePct:  ${effectiveCoveragePct}`);
}

main();
