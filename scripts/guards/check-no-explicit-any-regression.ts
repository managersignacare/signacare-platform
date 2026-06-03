#!/usr/bin/env tsx
/**
 * Prevents regressions in `@typescript-eslint/no-explicit-any` while the
 * repository is in staged burn-down mode.
 *
 * Policy:
 *   - current count MUST be <= baseline.maxNoExplicitAny
 *   - decreases are allowed (and encouraged)
 *   - increases fail hard
 */

import { execSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

interface BaselineFile {
  maxNoExplicitAny: number;
  recordedAt: string;
  note?: string;
}

interface EslintMessage {
  ruleId: string | null;
  severity: number;
}

interface EslintFileResult {
  filePath: string;
  messages: EslintMessage[];
}

const REPO_ROOT = resolve(__dirname, '..', '..');
const BASELINE_PATH = join(__dirname, 'check-no-explicit-any-regression.baseline.json');

function loadBaseline(): BaselineFile {
  if (!existsSync(BASELINE_PATH)) {
    throw new Error(`Baseline file missing: ${BASELINE_PATH}`);
  }
  const parsed = JSON.parse(readFileSync(BASELINE_PATH, 'utf8')) as BaselineFile;
  if (!Number.isFinite(parsed.maxNoExplicitAny) || parsed.maxNoExplicitAny < 0) {
    throw new Error(`Baseline maxNoExplicitAny is invalid in ${BASELINE_PATH}`);
  }
  return parsed;
}

function runEslintJson(): EslintFileResult[] {
  try {
    const out = execSync('npx eslint . -f json', {
      cwd: REPO_ROOT,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      maxBuffer: 50 * 1024 * 1024,
    });
    return JSON.parse(out) as EslintFileResult[];
  } catch (err) {
    const e = err as { stdout?: Buffer | string; message?: string };
    const stdout = typeof e.stdout === 'string' ? e.stdout : e.stdout?.toString('utf8') ?? '';
    if (!stdout.trim()) {
      throw new Error(`eslint invocation failed without JSON output: ${e.message ?? 'unknown error'}`);
    }
    return JSON.parse(stdout) as EslintFileResult[];
  }
}

function main(): void {
  const baseline = loadBaseline();
  const eslint = runEslintJson();

  let total = 0;
  const byFile = new Map<string, number>();
  for (const file of eslint) {
    let count = 0;
    for (const m of file.messages ?? []) {
      if (m.severity === 2 && m.ruleId === '@typescript-eslint/no-explicit-any') count += 1;
    }
    if (count > 0) {
      total += count;
      byFile.set(file.filePath.replace(`${REPO_ROOT}/`, ''), count);
    }
  }

  const delta = total - baseline.maxNoExplicitAny;
  console.log('→ check-no-explicit-any-regression');
  console.log(`  baseline: ${baseline.maxNoExplicitAny}`);
  console.log(`  current:  ${total}`);
  console.log(`  delta:    ${delta >= 0 ? `+${delta}` : `${delta}`}`);

  if (delta > 0) {
    console.error('');
    console.error('✗ no-explicit-any regression detected.');
    console.error('  Top files:');
    [...byFile.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 15)
      .forEach(([file, count]) => {
        console.error(`    ${String(count).padStart(4)}  ${file}`);
      });
    process.exit(1);
  }

  console.log('✓ no-explicit-any count did not regress.');
  if (delta < 0) {
    console.log('  (Count decreased. Update baseline in a dedicated commit after review.)');
  }
}

main();
