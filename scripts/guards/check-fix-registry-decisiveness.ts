#!/usr/bin/env tsx
/*
 * scripts/guards/check-fix-registry-decisiveness.ts
 *
 * Phase R1 PR-R1-7 — CLAUDE.md §9.5 enforcement (fix-registry
 * anchor decisiveness).
 *
 * ── Why this exists ──────────────────────────────────────────────
 * `.github/scripts/check-fix-registry.sh` already checks that every
 * `present`-type pattern STILL matches the file (i.e., the fix is
 * still in place). What it does NOT check: how DECISIVE the match is.
 *
 * A pattern like `function` matches every function in the file —
 * if the actual fix is removed, the file still contains many
 * `function` matches and the guard passes. The anchor provides no
 * regression coverage.
 *
 * The structural answer: after the existing presence check passes,
 * count the matches. Patterns that match more than `MAX_DECISIVE_HITS`
 * lines are flagged as overly-loose and must either be tightened
 * (pin the unique fix-shape) or allowlisted with a documented reason
 * (e.g., naming-convention anchors that legitimately match many sites).
 *
 * ── Boundary with `check-fix-registry.sh` (L3 cycle-1 finding #8) ─
 *   - This guard catches OVER-match (>5 hits) on `present`-type rows.
 *   - The existing `check-fix-registry.sh` catches UNDER-match (=0
 *     for present, >0 for absent) — the "fix was silently undone"
 *     class.
 *   - Together they pin both ends: anchors must match a small,
 *     decisive number of lines AND that number must remain stable
 *     (allowlisted IDs are pinned via expected=N).
 *
 * ── Allowlist format (cycle-2 absorb of L3 finding #3) ────────────
 *   <ANCHOR-ID> expected=<N>  # comment
 *
 * Each entry pins the EXACT expected hit count. Drift in either
 * direction (consolidation OR pattern-loosening) fails the guard so
 * silent state-flips can't sneak through. Sibling pattern of
 * PR-R1-6 cycle-2's bugs-remaining-uniqueness allowlist.
 *
 * ── Run ──────────────────────────────────────────────────────────
 * `npm run guard:fix-registry-decisiveness` (CI-only; ~38s)
 *
 * Exit codes:
 *   0  every present-type anchor matches ≤ MAX_DECISIVE_HITS lines
 *      AND every allowlisted anchor matches its expected count
 *   1  one or more anchors are overly-loose, OR allowlisted anchor
 *      count drifted, OR allowlist parse error
 */

import * as fs from 'fs';
import * as path from 'path';
import {
  parseRegistry,
  parseAllowlist,
  countMatches,
  evaluateDecisiveness,
  MAX_DECISIVE_HITS,
} from './lib/fix-registry-decisiveness-core';

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const REGISTRY_PATH = path.join(REPO_ROOT, 'docs', 'quality', 'fix-registry.md');
const ALLOWLIST_PATH = path.join(__dirname, 'check-fix-registry-decisiveness.allowlist');

function main(): number {
  let registrySource: string;
  try {
    registrySource = fs.readFileSync(REGISTRY_PATH, 'utf-8');
  } catch (err) {
    console.error(`✗ could not read ${REGISTRY_PATH}: ${(err as Error).message}`);
    return 1;
  }

  let allowlistSource = '';
  try {
    allowlistSource = fs.readFileSync(ALLOWLIST_PATH, 'utf-8');
  } catch {
    // optional file
  }

  const rows = parseRegistry(registrySource);
  const { entries: allowlist, parseErrors } = parseAllowlist(allowlistSource);
  const { violations, countDrift } = evaluateDecisiveness(rows, allowlist, (p, f) =>
    countMatches(p, f, REPO_ROOT),
  );

  console.error('→ check-fix-registry-decisiveness (PR-R1-7 cycle-2; CLAUDE.md §9.5)');
  console.error(`  registry:        ${path.relative(REPO_ROOT, REGISTRY_PATH)}`);
  console.error(`  rows:            ${rows.length}`);
  console.error(`  threshold:       MAX_DECISIVE_HITS = ${MAX_DECISIVE_HITS}`);
  console.error(`  allowlist:       ${path.relative(REPO_ROOT, ALLOWLIST_PATH)} (${allowlist.length} entries)`);
  console.error(`  count drift:     ${countDrift.length}`);
  console.error(`  new violations:  ${violations.length}`);
  console.error('');

  let exitCode = 0;

  if (parseErrors.length > 0) {
    console.error(`✗ ${parseErrors.length} allowlist parse error(s):`);
    for (const e of parseErrors) console.error(`  ${e}`);
    console.error('');
    console.error(
      'Fix: each allowlist line MUST be `<ANCHOR-ID> expected=<N>  # comment` per the cycle-2 format.',
    );
    console.error('');
    exitCode = 1;
  }

  if (countDrift.length > 0) {
    console.error(`✗ ${countDrift.length} allowlisted anchor(s) have drifted hit counts:\n`);
    countDrift.sort((a, b) => a.id.localeCompare(b.id));
    for (const d of countDrift) {
      console.error(`  ${d.id} (expected=${d.expected}, actual=${d.actual})`);
    }
    console.error('');
    console.error(
      'Allowlist entries are PINNED to an expected hit count. Drift in either direction ' +
        'requires updating the allowlist line so silent pattern-loosening (or post-cleanup ' +
        "consolidation) can't sneak through.",
    );
    console.error('');
    exitCode = 1;
  }

  if (violations.length > 0) {
    console.error(`✗ ${violations.length} fix-registry anchor(s) match too many lines (overly loose):\n`);
    violations.sort((a, b) => b.hits - a.hits);
    for (const v of violations) {
      console.error(`  ${v.id} (${v.hits} hits in ${v.file}):`);
      console.error(`    pattern: /${v.pattern}/`);
      console.error(`    registry line: ${v.registryLine}`);
      console.error('');
    }
    console.error(
      'Fix per CLAUDE.md §9.5: tighten the pattern to pin the SPECIFIC fix-shape ' +
        '(typically 1-3 lines), OR add the anchor ID to ' +
        `${path.relative(REPO_ROOT, ALLOWLIST_PATH)} as \`<ANCHOR-ID> expected=<N>  # reason\` ` +
        '(e.g., naming-convention anchors that legitimately match many sites).',
    );
    exitCode = 1;
  }

  if (exitCode === 0) {
    console.error('✓ Every fix-registry present-anchor matches ≤ MAX_DECISIVE_HITS lines (decisive). Allowlist counts pinned.');
  }
  return exitCode;
}

if (require.main === module) {
  process.exit(main());
}
