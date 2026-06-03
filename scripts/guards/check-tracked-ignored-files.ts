#!/usr/bin/env tsx
/**
 * check-tracked-ignored-files — BUG-D10-GUARD-TRACKED-IGNORED (S1)
 *
 * ── Why this exists ─────────────────────────────────────────────
 * Files in the working tree that are simultaneously (a) tracked by
 * git and (b) matched by a .gitignore rule are an indicator of one
 * of three structural problems:
 *
 *   1. The file was accidentally `git add`ed BEFORE its ignore rule
 *      existed; the rule was added later but the file stayed tracked.
 *      Example seen in this repo on 2026-05-27:
 *        - apps/api/test-results/.last-run.json
 *        - apps/mobile/android/.gradle/**
 *        - apps/mobile/android/local.properties
 *        - test-results/.last-run.json
 *      All are build artifacts that should never be in git.
 *
 *   2. Two contributors disagree about whether the file should be
 *      tracked. The .gitignore says "no", the index says "yes".
 *
 *   3. A vendor / generated file pattern was added to .gitignore but
 *      the generation was checked in, so future regens diff against
 *      git rather than against the generator.
 *
 * Mechanism: `git ls-files -ci --exclude-standard` lists tracked
 * files that match standard ignore rules (.gitignore + .git/info/exclude
 * + core.excludesFile). An empty result means tracked-set ↔ gitignore
 * are in sync; any non-empty result is a structural drift.
 *
 * ── Scope ───────────────────────────────────────────────────────
 * Repo-wide.
 *
 * ── Out of scope ────────────────────────────────────────────────
 *   - .gitignore correctness (i.e., should X be ignored at all) —
 *     this guard takes the .gitignore as the SSoT and asks "is the
 *     tracked set consistent with it?".
 *   - Files in git that AREN'T in .gitignore but probably should be
 *     (e.g. a stray `.DS_Store` that nobody added to .gitignore yet) —
 *     that's a separate hygiene concern.
 *
 * ── Exit codes ──────────────────────────────────────────────────
 *   0 — no tracked-ignored files
 *   1 — one or more tracked-ignored files surfaced
 *   2 — guard malfunction (not a git repo, git missing, etc.)
 *
 * ── Fix recipe (when this fails) ────────────────────────────────
 * For each file listed:
 *   git rm --cached <path>     # untrack but keep on disk
 *   # commit the cleanup atomically with whatever .gitignore change
 *   # made the discrepancy visible (or as a hygiene commit on its own).
 *
 * ── References ──────────────────────────────────────────────────
 *   - PART 11 §11.6 (repo declutter) flagged some of these by hand.
 *   - PART 12 §12.1 noted `test-results/.last-run.json` as tracked-
 *     but-gitignored ("untrack the gitignored file").
 *   - d10 plan §5 #1 ("Implement guard:tracked-ignored-files").
 */

import { execSync } from 'node:child_process';

function listTrackedIgnored(): string[] {
  let out: string;
  try {
    out = execSync('git ls-files -ci --exclude-standard', {
      encoding: 'utf8',
      // Don't inherit stdin so this is safe in CI without a TTY.
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`  GUARD MALFUNCTION: 'git ls-files' failed — ${message}`);
    console.error(`  (is this a git checkout? is git installed?)`);
    process.exit(2);
  }
  return out.split('\n').filter(line => line.length > 0);
}

function main(): void {
  console.log('→ check-tracked-ignored-files');
  console.log('  source: `git ls-files -ci --exclude-standard`');
  console.log('  target: repo-wide consistency between tracked set + .gitignore\n');

  const offenders = listTrackedIgnored();

  if (offenders.length === 0) {
    console.log('✓ Tracked set is consistent with .gitignore (no tracked-ignored files).');
    process.exit(0);
  }

  console.error(`✗ ${offenders.length} tracked-ignored file(s) — structural drift between\n` +
                `  the tracked set and .gitignore:\n`);
  for (const path of offenders) {
    console.error(`    ${path}`);
  }
  console.error(`\n  Fix recipe:`);
  console.error(`    git rm --cached <path>     # untrack but keep on disk`);
  console.error(`    git commit -m "chore(repo): untrack gitignored files"`);
  console.error(`\n  (See header of scripts/guards/check-tracked-ignored-files.ts for full context.)`);
  process.exit(1);
}

main();
