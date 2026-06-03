/*
 * scripts/guards/__tests__/precommit-trigger-shell-parity.test.ts
 *
 * BUG-PRECOMMIT-REVIEW-CHAIN-FOR-S1 (S2) — D2 trigger shell-parity test.
 *
 * The pre-commit hook (.husky/pre-commit) uses a shell grep regex to
 * detect migration-touched commits and fire the elevated mechanical
 * set. The TS module (D1) uses its own regex for the same logic. These
 * two regexes MUST stay in sync — if they drift, the pre-commit hook
 * could fail to escalate when D1's commit-msg verification expects it
 * to (or vice versa, leading to spurious double-runs).
 *
 * This test asserts shell-grep parity by:
 *   1. READING the shell grep regex out of `.husky/pre-commit` directly
 *      at test time (NOT hardcoding the regex inline) — L5 cycle-1 Drift B
 *      absorb 2026-05-06. Pre-fix the test hardcoded the regex inline,
 *      which meant a co-edit error (someone tweaks both the hook AND the
 *      test in the same PR but breaks the regex) was undetected. Reading
 *      directly closes that gap.
 *   2. Running grep with the extracted regex against synthetic file lists.
 *   3. Comparing the result against D1's TS-side `detectTriggerCommit`
 *      verdict on `migrations` kind for the same input.
 *
 * If a future contributor changes the hook's regex without updating
 * the TS module (or vice versa), this test fails.
 */
import { describe, it, expect } from 'vitest';
import { execSync } from 'child_process';
import { readFileSync } from 'fs';
import path from 'path';
import { detectTriggerCommit } from '../lib/detectTriggerCommit';
import { REPO_ROOT } from '../lib/repoRoot';

/**
 * Extract the migration-detection grep regex from `.husky/pre-commit`.
 * Returns the regex pattern string as it appears inside the single quotes
 * after `grep -qE '...'`. If the hook is malformed or doesn't contain a
 * grep pattern, the test fails clearly.
 *
 * L5 cycle-1 Drift B absorb (2026-05-06): this replaces the pre-fix
 * inline-hardcoded regex with a read-from-source-of-truth approach.
 */
function extractHookGrepPattern(): string {
  const hookPath = path.join(REPO_ROOT, '.husky/pre-commit');
  const hookSrc = readFileSync(hookPath, 'utf-8');
  // Match `grep -qE '<pattern>'` — single quotes around the pattern.
  // The hook line shape: `grep -qE '^apps/api/migrations/[^/]+\.ts$'`
  const match = hookSrc.match(/grep -qE '([^']+)'/);
  if (!match) {
    throw new Error(
      `.husky/pre-commit does not contain a 'grep -qE \\'...\\' migration-detection pattern; ` +
      `the trigger-aware elevated mechanical set may have been removed.`,
    );
  }
  return match[1];
}

const HOOK_GREP_PATTERN = extractHookGrepPattern();

/**
 * Run grep with the pattern extracted from `.husky/pre-commit` against a
 * synthetic file-list.
 */
function shellGrepMatchesMigration(files: string[]): boolean {
  const input = files.join('\n');
  try {
    execSync(
      `grep -qE '${HOOK_GREP_PATTERN}'`,
      { input, stdio: ['pipe', 'pipe', 'pipe'] },
    );
    return true;
  } catch {
    // grep exit 1 = no match (not an error condition).
    return false;
  }
}

describe('pre-commit trigger shell parity (D2)', () => {
  const cases: Array<{ name: string; files: string[]; expectMatch: boolean }> = [
    { name: 'single migration file', files: ['apps/api/migrations/20260601000000_x.ts'], expectMatch: true },
    { name: 'no files', files: [], expectMatch: false },
    { name: 'features file (not migration)', files: ['apps/api/src/features/episode/episodeRoutes.ts'], expectMatch: false },
    { name: 'migration sub-directory excluded', files: ['apps/api/migrations/old/20260101000000_archived.ts'], expectMatch: false },
    { name: 'migration mixed with other staged files', files: ['docs/quality/bugs-remaining.md', 'apps/api/migrations/20260601000001_y.ts'], expectMatch: true },
    { name: 'migration with weird name still matches', files: ['apps/api/migrations/20260601000002_BUG_X-S1_closure.ts'], expectMatch: true },
    { name: 'empty line in input', files: ['', 'apps/api/migrations/20260601000003_z.ts', ''], expectMatch: true },
  ];

  for (const { name, files, expectMatch } of cases) {
    it(`${name} — shell grep + TS detector agree`, () => {
      const shellResult = shellGrepMatchesMigration(files);
      const tsResult = detectTriggerCommit({ stagedFiles: files, commitMessage: '' });
      const tsDetectsMigration = tsResult.kinds.includes('migrations');

      expect(shellResult).toBe(expectMatch);
      expect(tsDetectsMigration).toBe(expectMatch);
      // Parity: shell and TS must always agree.
      expect(shellResult).toBe(tsDetectsMigration);
    });
  }
});

describe('pre-commit hook syntax check (D2)', () => {
  it('.husky/pre-commit passes `sh -n` syntax check', () => {
    // sh -n parses the script without executing it. Any syntax error
    // (unbalanced quotes, malformed if, etc.) exits non-zero.
    const result = execSync('sh -n .husky/pre-commit', { stdio: ['pipe', 'pipe', 'pipe'] });
    // sh -n produces no output on success. We just need it to not throw.
    expect(result.toString()).toBe('');
  });
});
