#!/usr/bin/env tsx
/**
 * BUG-ARCH-ALLOWLIST-TIMEBOMB-2026-12-31
 *
 * Enforces an executable burn-down contract for high-volume allowlist lanes so
 * debt cannot silently drift toward the expiry cliff.
 */

import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

type Milestone = {
  date: string;
  maxOpen: number;
};

type Lane = {
  id: string;
  file: string;
  milestones: Milestone[];
};

type Contract = {
  version: number;
  finalDeadline: string;
  lanes: Lane[];
};

const ROOT = resolve(__dirname, '..', '..');
const CONTRACT_FILE = resolve(ROOT, '.github/allowlist-burndown-contract.json');
const EXPECTED_FINAL_DEADLINE = '2026-12-31';
const TODAY = new Date().toISOString().slice(0, 10);

function parseIsoDate(input: string): number {
  const value = Date.parse(`${input}T00:00:00.000Z`);
  if (Number.isNaN(value)) {
    throw new Error(`Invalid ISO date '${input}'`);
  }
  return value;
}

function countAllowlistEntries(filePath: string): number {
  const raw = readFileSync(filePath, 'utf8');
  return raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith('#')).length;
}

function currentBudgetForDate(milestones: Milestone[], todayMs: number): Milestone {
  const sorted = [...milestones].sort((a, b) => parseIsoDate(a.date) - parseIsoDate(b.date));
  let checkpoint = sorted[0];
  for (const milestone of sorted) {
    if (parseIsoDate(milestone.date) <= todayMs) checkpoint = milestone;
  }
  return checkpoint ?? sorted[0];
}

function validateLane(lane: Lane, todayMs: number, failures: string[]): string {
  if (!lane.id.trim()) failures.push(`lane has empty id for file ${lane.file}`);
  const absoluteFile = resolve(ROOT, lane.file);
  if (!existsSync(absoluteFile)) {
    failures.push(`[${lane.id}] missing allowlist file: ${lane.file}`);
    return '';
  }
  if (lane.milestones.length === 0) {
    failures.push(`[${lane.id}] has no milestones`);
    return '';
  }

  const sorted = [...lane.milestones].sort((a, b) => parseIsoDate(a.date) - parseIsoDate(b.date));
  if (JSON.stringify(sorted) !== JSON.stringify(lane.milestones)) {
    failures.push(`[${lane.id}] milestones must be sorted by date ascending`);
  }

  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i].maxOpen > sorted[i - 1].maxOpen) {
      failures.push(
        `[${lane.id}] milestones must be non-increasing maxOpen (${sorted[i - 1].maxOpen} -> ${sorted[i].maxOpen})`,
      );
    }
  }

  const finalMilestone = sorted[sorted.length - 1];
  if (finalMilestone.maxOpen !== 0) {
    failures.push(`[${lane.id}] final milestone must reach 0 open entries`);
  }

  const currentCount = countAllowlistEntries(absoluteFile);
  const checkpoint = currentBudgetForDate(sorted, todayMs);
  if (currentCount > checkpoint.maxOpen) {
    failures.push(
      `[${lane.id}] current ${currentCount} exceeds checkpoint max ${checkpoint.maxOpen} (as-of ${checkpoint.date})`,
    );
  }

  return `${lane.id.padEnd(28)} current=${String(currentCount).padStart(4)}  checkpoint=${String(
    checkpoint.maxOpen,
  ).padStart(4)}  as-of=${checkpoint.date}`;
}

function main(): void {
  if (!existsSync(CONTRACT_FILE)) {
    console.error(`✗ missing allowlist burndown contract: ${CONTRACT_FILE}`);
    process.exit(1);
  }

  const contract = JSON.parse(readFileSync(CONTRACT_FILE, 'utf8')) as Contract;
  const failures: string[] = [];

  if (contract.version !== 1) {
    failures.push(`contract version must be 1 (found ${String(contract.version)})`);
  }
  if (contract.finalDeadline !== EXPECTED_FINAL_DEADLINE) {
    failures.push(
      `finalDeadline must be ${EXPECTED_FINAL_DEADLINE} (found ${String(contract.finalDeadline)})`,
    );
  }
  if (!Array.isArray(contract.lanes) || contract.lanes.length === 0) {
    failures.push('contract must define at least one lane');
  }

  const seen = new Set<string>();
  for (const lane of contract.lanes ?? []) {
    if (seen.has(lane.id)) failures.push(`duplicate lane id '${lane.id}'`);
    seen.add(lane.id);
  }

  const finalDeadlineMs = parseIsoDate(contract.finalDeadline);
  for (const lane of contract.lanes ?? []) {
    const sorted = [...lane.milestones].sort((a, b) => parseIsoDate(a.date) - parseIsoDate(b.date));
    const last = sorted[sorted.length - 1];
    if (last && parseIsoDate(last.date) > finalDeadlineMs) {
      failures.push(
        `[${lane.id}] final milestone date ${last.date} exceeds finalDeadline ${contract.finalDeadline}`,
      );
    }
  }

  const todayMs = parseIsoDate(TODAY);
  const summaries: string[] = [];
  for (const lane of contract.lanes ?? []) {
    const summary = validateLane(lane, todayMs, failures);
    if (summary) summaries.push(summary);
  }

  if (failures.length > 0) {
    console.error('✗ allowlist burndown contract guard failed');
    for (const failure of failures) console.error(`  - ${failure}`);
    process.exit(1);
  }

  console.log('✓ Allowlist burndown contract is valid and within checkpoint budgets.');
  console.log(`  contract: .github/allowlist-burndown-contract.json`);
  console.log(`  today:    ${TODAY}`);
  for (const summary of summaries) console.log(`  ${summary}`);
}

main();
