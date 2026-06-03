#!/usr/bin/env tsx
/**
 * BUG-SA-101
 *
 * Enforces a measured convergence contract for API response envelopes in
 * apps/api/src/features. This is a structural guardrail that blocks drift
 * while we converge legacy `items`/`success` envelopes to canonical
 * `data` (list/detail) or `ok` (action) envelopes.
 */

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { resolve, relative } from 'node:path';

type Milestone = {
  date: string;
  maxNonCanonical: number;
  minCanonical: number;
  maxLegacyItems: number;
  maxLegacySuccess: number;
};

type Contract = {
  version: number;
  finalDeadline: string;
  milestones: Milestone[];
};

type EnvelopeStats = {
  filesScanned: number;
  totalJsonCalls: number;
  objectLiteralCalls: number;
  canonical: number;
  nonCanonical: number;
  legacyItems: number;
  legacySuccess: number;
  driftOther: number;
};

const ROOT = resolve(__dirname, '..', '..');
const SCAN_ROOT = resolve(ROOT, 'apps', 'api', 'src', 'features');
const CONTRACT_FILE = resolve(ROOT, '.github', 'api-envelope-contract.json');
const EXPECTED_FINAL_DEADLINE = '2026-12-31';
const TODAY = new Date().toISOString().slice(0, 10);

function walkTs(dir: string, out: string[] = []): string[] {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return out;
  }
  for (const entry of entries) {
    const full = resolve(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) {
      if (entry === 'node_modules' || entry === 'dist' || entry === '__tests__') continue;
      walkTs(full, out);
    } else if (entry.endsWith('.ts') && !entry.endsWith('.d.ts') && !entry.endsWith('.test.ts')) {
      out.push(full);
    }
  }
  return out;
}

function parseIsoDate(input: string): number {
  const value = Date.parse(`${input}T00:00:00.000Z`);
  if (Number.isNaN(value)) {
    throw new Error(`Invalid ISO date '${input}'`);
  }
  return value;
}

function extractJsonArg(source: string, openParenIdx: number): { arg: string; endIdx: number } | null {
  let depth = 1;
  let i = openParenIdx + 1;
  let inString: '"' | "'" | '`' | null = null;
  let escape = false;
  while (i < source.length) {
    const ch = source[i];
    if (escape) {
      escape = false;
      i++;
      continue;
    }
    if (ch === '\\') {
      escape = true;
      i++;
      continue;
    }
    if (inString) {
      if (ch === inString) inString = null;
      i++;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === '`') {
      inString = ch;
      i++;
      continue;
    }
    if (ch === '(' || ch === '{' || ch === '[') depth++;
    if (ch === ')' || ch === '}' || ch === ']') {
      if (ch === ')' && depth === 1) {
        return { arg: source.slice(openParenIdx + 1, i), endIdx: i };
      }
      depth--;
    }
    i++;
  }
  return null;
}

function findResJsonCalls(source: string): Array<{ openIdx: number; endIdx: number; arg: string }> {
  const out: Array<{ openIdx: number; endIdx: number; arg: string }> = [];
  const openerRe = /\bres(?:\s*\.\s*status\s*\(\s*\d+\s*\))?\s*\.\s*json\s*\(/g;
  let match: RegExpExecArray | null;
  while ((match = openerRe.exec(source)) !== null) {
    const openIdx = match.index + match[0].length - 1;
    const extracted = extractJsonArg(source, openIdx);
    if (extracted) out.push({ openIdx: match.index, endIdx: extracted.endIdx, arg: extracted.arg });
  }
  return out;
}

function buildLineOffsets(source: string): number[] {
  const lines = source.split('\n');
  const offsets: number[] = [0];
  for (const line of lines) offsets.push(offsets[offsets.length - 1] + line.length + 1);
  return offsets;
}

function lineNoOfIndex(offsets: number[], index: number): number {
  for (let i = 0; i < offsets.length - 1; i++) {
    if (index >= offsets[i] && index < offsets[i + 1]) return i + 1;
  }
  return offsets.length;
}

function parseTopLevelKeys(arg: string): string[] | null {
  const trimmed = arg.trim();
  if (!trimmed.startsWith('{') || !trimmed.endsWith('}')) return null;
  const inner = trimmed.slice(1, -1).trim();
  if (inner.length === 0) return [];

  const keys: string[] = [];
  let depth = 0;
  let inString: '"' | "'" | '`' | null = null;
  let escape = false;
  let segStart = 0;

  function pushSegment(segment: string): void {
    const value = segment.trim();
    if (!value) return;
    const kv = /^(\w+)\s*:/.exec(value);
    if (kv) {
      keys.push(kv[1]);
      return;
    }
    const shorthand = /^(\w+)$/.exec(value);
    if (shorthand) keys.push(shorthand[1]);
  }

  for (let i = 0; i < inner.length; i++) {
    const ch = inner[i];
    if (escape) {
      escape = false;
      continue;
    }
    if (ch === '\\') {
      escape = true;
      continue;
    }
    if (inString) {
      if (ch === inString) inString = null;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === '`') {
      inString = ch;
      continue;
    }
    if (ch === '{' || ch === '(' || ch === '[') {
      depth++;
      continue;
    }
    if (ch === '}' || ch === ')' || ch === ']') {
      depth--;
      continue;
    }
    if (ch === ',' && depth === 0) {
      pushSegment(inner.slice(segStart, i));
      segStart = i + 1;
    }
  }
  pushSegment(inner.slice(segStart));
  return keys;
}

function isExempt(lines: string[], lineNo: number): boolean {
  if (lineNo <= 1) return false;
  const previous = (lines[lineNo - 2] || '').trim();
  return previous.includes('@api-envelope-exempt') || previous.includes('@response-shape-exempt');
}

function classify(keys: string[]): 'canonical' | 'legacy-items' | 'legacy-success' | 'drift-other' {
  if (keys.includes('data') || keys.includes('ok')) return 'canonical';
  if (keys.includes('items')) return 'legacy-items';
  if (keys.includes('success')) return 'legacy-success';
  return 'drift-other';
}

function collectStats(): EnvelopeStats {
  const files = walkTs(SCAN_ROOT);
  const stats: EnvelopeStats = {
    filesScanned: files.length,
    totalJsonCalls: 0,
    objectLiteralCalls: 0,
    canonical: 0,
    nonCanonical: 0,
    legacyItems: 0,
    legacySuccess: 0,
    driftOther: 0,
  };

  for (const file of files) {
    const source = readFileSync(file, 'utf8');
    const lines = source.split('\n');
    const offsets = buildLineOffsets(source);
    const calls = findResJsonCalls(source);
    stats.totalJsonCalls += calls.length;
    for (const call of calls) {
      const lineNo = lineNoOfIndex(offsets, call.openIdx);
      if (isExempt(lines, lineNo)) continue;
      const keys = parseTopLevelKeys(call.arg);
      if (!keys) continue;
      stats.objectLiteralCalls++;
      const category = classify(keys);
      if (category === 'canonical') {
        stats.canonical++;
      } else {
        stats.nonCanonical++;
        if (category === 'legacy-items') stats.legacyItems++;
        else if (category === 'legacy-success') stats.legacySuccess++;
        else stats.driftOther++;
      }
    }
  }

  return stats;
}

function currentMilestone(milestones: Milestone[], todayMs: number): Milestone {
  const sorted = [...milestones].sort((a, b) => parseIsoDate(a.date) - parseIsoDate(b.date));
  let checkpoint = sorted[0];
  for (const milestone of sorted) {
    if (parseIsoDate(milestone.date) <= todayMs) checkpoint = milestone;
  }
  return checkpoint;
}

function main(): void {
  if (!existsSync(CONTRACT_FILE)) {
    console.error(`✗ missing contract file: ${relative(ROOT, CONTRACT_FILE)}`);
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
  if (!Array.isArray(contract.milestones) || contract.milestones.length === 0) {
    failures.push('contract must include at least one milestone');
  }

  const milestones = [...(contract.milestones ?? [])].sort((a, b) => parseIsoDate(a.date) - parseIsoDate(b.date));
  if (JSON.stringify(milestones) !== JSON.stringify(contract.milestones ?? [])) {
    failures.push('milestones must be sorted ascending by date');
  }
  for (let i = 1; i < milestones.length; i++) {
    if (milestones[i].maxNonCanonical > milestones[i - 1].maxNonCanonical) {
      failures.push('maxNonCanonical must be non-increasing across milestones');
    }
    if (milestones[i].minCanonical < milestones[i - 1].minCanonical) {
      failures.push('minCanonical must be non-decreasing across milestones');
    }
    if (milestones[i].maxLegacyItems > milestones[i - 1].maxLegacyItems) {
      failures.push('maxLegacyItems must be non-increasing across milestones');
    }
    if (milestones[i].maxLegacySuccess > milestones[i - 1].maxLegacySuccess) {
      failures.push('maxLegacySuccess must be non-increasing across milestones');
    }
  }
  if (milestones.length > 0 && milestones[milestones.length - 1].maxNonCanonical !== 0) {
    failures.push('final milestone must drive maxNonCanonical to 0');
  }
  const finalDeadlineMs = parseIsoDate(contract.finalDeadline);
  if (milestones.length > 0 && parseIsoDate(milestones[milestones.length - 1].date) > finalDeadlineMs) {
    failures.push('last milestone date cannot exceed finalDeadline');
  }

  const stats = collectStats();
  const checkpoint = currentMilestone(milestones, parseIsoDate(TODAY));
  if (stats.nonCanonical > checkpoint.maxNonCanonical) {
    failures.push(
      `nonCanonical=${stats.nonCanonical} exceeds checkpoint maxNonCanonical=${checkpoint.maxNonCanonical} (as-of ${checkpoint.date})`,
    );
  }
  if (stats.canonical < checkpoint.minCanonical) {
    failures.push(
      `canonical=${stats.canonical} is below checkpoint minCanonical=${checkpoint.minCanonical} (as-of ${checkpoint.date})`,
    );
  }
  if (stats.legacyItems > checkpoint.maxLegacyItems) {
    failures.push(
      `legacyItems=${stats.legacyItems} exceeds checkpoint maxLegacyItems=${checkpoint.maxLegacyItems} (as-of ${checkpoint.date})`,
    );
  }
  if (stats.legacySuccess > checkpoint.maxLegacySuccess) {
    failures.push(
      `legacySuccess=${stats.legacySuccess} exceeds checkpoint maxLegacySuccess=${checkpoint.maxLegacySuccess} (as-of ${checkpoint.date})`,
    );
  }

  if (failures.length > 0) {
    console.error('✗ API envelope convergence contract failed');
    console.error(`  contract: ${relative(ROOT, CONTRACT_FILE)}`);
    for (const failure of failures) console.error(`  - ${failure}`);
    console.error('  stats:');
    console.error(`    filesScanned:      ${stats.filesScanned}`);
    console.error(`    totalJsonCalls:    ${stats.totalJsonCalls}`);
    console.error(`    objectLiteral:     ${stats.objectLiteralCalls}`);
    console.error(`    canonical:         ${stats.canonical}`);
    console.error(`    nonCanonical:      ${stats.nonCanonical}`);
    console.error(`    legacyItems:       ${stats.legacyItems}`);
    console.error(`    legacySuccess:     ${stats.legacySuccess}`);
    console.error(`    driftOther:        ${stats.driftOther}`);
    process.exit(1);
  }

  console.log('✓ API envelope convergence contract is within checkpoint budget.');
  console.log(`  contract:           ${relative(ROOT, CONTRACT_FILE)}`);
  console.log(`  today:              ${TODAY}`);
  console.log(`  checkpoint:         ${checkpoint.date}`);
  console.log(`  filesScanned:       ${stats.filesScanned}`);
  console.log(`  totalJsonCalls:     ${stats.totalJsonCalls}`);
  console.log(`  objectLiteralCalls: ${stats.objectLiteralCalls}`);
  console.log(`  canonical:          ${stats.canonical}`);
  console.log(`  nonCanonical:       ${stats.nonCanonical}`);
  console.log(`  legacyItems:        ${stats.legacyItems}`);
  console.log(`  legacySuccess:      ${stats.legacySuccess}`);
  console.log(`  driftOther:         ${stats.driftOther}`);
}

main();
