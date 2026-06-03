#!/usr/bin/env tsx
/*
 * scripts/guards/check-atomic-catalogue-flip.ts
 *
 * Phase R1 PR-R1-8 — feedback_atomic_catalogue_flip enforcement.
 *
 * ── Why this exists ──────────────────────────────────────────────
 * Per `~/.claude/.../memory/feedback_atomic_catalogue_flip.md`:
 *   "bugs-remaining.md row flip to **fixed** must be in the SAME
 *    atomic commit as code, not a follow-on chore commit. The chore
 *    commit only adds the SHA."
 *
 * Failure mode this prevents:
 *   1. Commit `fix(phase-b-bug-X): code change` lands on main without
 *      flipping the BUG-X row in `bugs-remaining.md` — the catalogue
 *      still shows BUG-X as "open" even though the code fix is shipped.
 *   2. A later commit `chore: flip BUG-X to fixed` adds the catalogue
 *      flip — but for the window between (1) and (2), main is in a
 *      split-state where the catalogue and the code disagree.
 *   3. L3 reviewer running between (1) and (2) sees BUG-X as open and
 *      either re-reviews work that's already shipped, or reports
 *      false drift.
 *
 * The structural answer: each fix-commit MUST include the catalogue
 * flip in the same atomic commit. If a developer forgets, the guard
 * REJECTs the commit before it can land.
 *
 * ── Detection rule ───────────────────────────────────────────────
 * For each commit in the inspection range (default `HEAD~1..HEAD`):
 *
 *   1. Match commit subject against
 *        /^fix\(.*\bbug-[A-Z0-9.-]+\b/i
 *      Subjects mentioning a `bug-NNN` token in the scope.
 *
 *   2. Skip if subject contains any of:
 *        - `cycle2`, `cycle-2`, `absorb`, `cycle3`, `cycle-3` —
 *          these are post-cycle absorb commits; the catalogue was
 *          flipped in cycle-1.
 *        - `sha`, `backfill`, `chore` — chore commits don't fix.
 *      Skip if subject scope is `phase-r[0-9]+-pr[0-9]+` — these
 *      are discipline-enforcement PRs that file cascade BUGs but
 *      don't close any single primary BUG.
 *
 *   3. List files changed in the commit. If any file under
 *        apps/api/src/  apps/web/src/  packages/shared/src/
 *      is modified AND `docs/quality/bugs-remaining.md` is NOT
 *      modified, the commit is in violation.
 *
 *   4. Inline opt-out: if the commit body contains the literal
 *      `@atomic-flip-exempt: <reason>`, the rule is waived.
 *
 * ── Run ──────────────────────────────────────────────────────────
 * `npm run guard:atomic-catalogue-flip [--commits <range>]`
 *   default: `HEAD~1..HEAD`  (inspect the most recent commit)
 *   CI use:  `--commits origin/main..HEAD`
 *
 * Exit codes:
 *   0  every fix-commit in range carries an atomic catalogue flip
 *   1  one or more fix-commits ship without a flip
 */

import * as path from 'path';
import { spawnSync } from 'child_process';

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const CATALOGUE_PATH = 'docs/quality/bugs-remaining.md';
/**
 * Production code prefixes — file changes under any of these paths in
 * a fix-commit require the catalogue flip in the same atomic commit.
 *
 * Cycle-2 absorb of L3 PR-R1-8 advisory A1: cycle-1 covered only the
 * 3 core production surfaces. A future fix-commit touching only Flutter
 * or gateway code would silently bypass the catalogue-flip discipline.
 * Cycle-2 extends to all 5 apps (api / web / shared / mobile /
 * patient-app / emr-gateway), matching `ls apps/` in the repo.
 */
const PRODUCTION_CODE_PREFIXES = [
  'apps/api/src/',
  'apps/web/src/',
  'packages/shared/src/',
  'apps/mobile/lib/',
  'apps/mobile/android/app/src/',
  'apps/mobile/ios/',
  'apps/patient-app/lib/',
  'apps/patient-app/android/app/src/',
  'apps/patient-app/ios/',
  'apps/emr-gateway/src/',
];
/**
 * Tokens that mark a fix-commit as NOT requiring a catalogue flip.
 *
 * Cycle-2 absorb of L3 PR-R1-8 advisory A2: cycle-1 tested the WHOLE
 * subject for these tokens, allowing a description like
 * `fix(phase-b-bug-X): SHA hash regression in auth` to silently bypass
 * the rule. Cycle-2 anchors the patterns INSIDE the scope only —
 * `cycle\d`, `absorb`, `backfill`, `sha` must appear within the
 * `(...)` of the conventional commit subject. Verified inert today
 * (Signacare convention places these in scope) but no longer
 * silently bypassable.
 */
const SKIP_SCOPE_RE = /^\w+\s*\([^)]*\b(?:cycle[ -]?\d|absorb|backfill|sha)\b/i;
/** Scopes that file cascade BUGs but don't close a primary one. */
const DISCIPLINE_SCOPE_RE = /^\s*\w+\s*\(\s*phase-r\d+-pr[\d.-]+/i;

interface Commit {
  sha: string;
  subject: string;
  body: string;
  files: string[];
}

function git(args: string[]): string {
  const r = spawnSync('git', args, { cwd: REPO_ROOT, encoding: 'utf-8' });
  if (r.status !== 0) {
    throw new Error(`git ${args.join(' ')} failed: ${r.stderr}`);
  }
  return r.stdout ?? '';
}

function listCommits(range: string): Commit[] {
  // %x00 separator, %x1e between fields
  const fmt = '%H%x1e%s%x1e%b%x00';
  const out = git(['log', '--reverse', `--format=${fmt}`, range]);
  const records = out.split('\x00').filter((s) => s.trim().length > 0);
  const commits: Commit[] = [];
  for (const rec of records) {
    const [sha, subject, body] = rec.split('\x1e');
    if (!sha) continue;
    const filesOut = git(['show', '--name-only', '--format=', sha.trim()]);
    const files = filesOut.split('\n').map((f) => f.trim()).filter((f) => f.length > 0);
    commits.push({
      sha: sha.trim(),
      subject: (subject ?? '').trim(),
      body: (body ?? '').trim(),
      files,
    });
  }
  return commits;
}

interface Violation {
  sha: string;
  subject: string;
  reason: string;
}

export function evaluateCommit(commit: Commit): Violation | null {
  const fullMessage = commit.subject + '\n' + commit.body;

  // 1. Must be a fix-commit referencing a BUG-NNN
  if (!/^fix\(.*\bbug-[A-Z0-9.-]+\b/i.test(commit.subject)) return null;

  // 2. Skip absorb/backfill/chore-style commits — token must appear
  //    INSIDE the scope (cycle-2 absorb of L3 finding A2). Cycle-1
  //    tested the whole subject and was theoretically false-skippable
  //    by descriptions containing `SHA`, `backfill`, etc.
  if (SKIP_SCOPE_RE.test(commit.subject)) return null;
  // Discipline-enforcement scope (phase-r*-pr*) — files cascades, no primary close
  if (DISCIPLINE_SCOPE_RE.test(commit.subject)) return null;

  // 3. Inline opt-out
  if (/@atomic-flip-exempt:\s*\S/.test(fullMessage)) return null;

  // 4. Production code changed?
  const productionTouched = commit.files.some((f) =>
    PRODUCTION_CODE_PREFIXES.some((p) => f.startsWith(p)),
  );
  if (!productionTouched) return null;

  // 5. Catalogue flipped?
  const catalogueTouched = commit.files.includes(CATALOGUE_PATH);
  if (catalogueTouched) return null;

  return {
    sha: commit.sha,
    subject: commit.subject,
    reason: `fix-commit changed production code under ${PRODUCTION_CODE_PREFIXES.join(' / ')} but did NOT include ${CATALOGUE_PATH} in the same commit. Per feedback_atomic_catalogue_flip.md, the BUG row flip MUST be in the same atomic commit as the code change.`,
  };
}

function parseRange(args: string[]): string {
  const idx = args.indexOf('--commits');
  if (idx !== -1 && args[idx + 1]) return args[idx + 1]!;
  return 'HEAD~1..HEAD';
}

function main(): number {
  const range = parseRange(process.argv.slice(2));
  let commits: Commit[];
  try {
    commits = listCommits(range);
  } catch (err) {
    console.error(`✗ could not list commits in range ${range}: ${(err as Error).message}`);
    return 1;
  }

  const violations: Violation[] = [];
  for (const c of commits) {
    const v = evaluateCommit(c);
    if (v) violations.push(v);
  }

  console.error('→ check-atomic-catalogue-flip (PR-R1-8; feedback_atomic_catalogue_flip)');
  console.error(`  range:        ${range}`);
  console.error(`  commits:      ${commits.length}`);
  console.error(`  violations:   ${violations.length}`);
  console.error('');

  if (violations.length === 0) {
    console.error('✓ Every fix-commit in range carries an atomic catalogue flip.');
    return 0;
  }

  console.error(`✗ ${violations.length} fix-commit(s) shipped without an atomic catalogue flip:\n`);
  for (const v of violations) {
    console.error(`  ${v.sha.substring(0, 8)}  ${v.subject}`);
    console.error(`    ${v.reason}`);
    console.error('');
  }
  console.error(
    'Fix per feedback_atomic_catalogue_flip.md: the bugs-remaining.md row flip ' +
      "MUST be in the SAME atomic commit as the code change. Don't ship the code " +
      'commit alone and add the catalogue flip in a follow-up chore. If the ' +
      'commit genuinely closes no specific BUG (e.g. a cross-cutting refactor), ' +
      'add `@atomic-flip-exempt: <reason>` to the commit body.',
  );
  return 1;
}

if (require.main === module) {
  process.exit(main());
}
