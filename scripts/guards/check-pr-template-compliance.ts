#!/usr/bin/env tsx
/**
 * scripts/guards/check-pr-template-compliance.ts
 *
 * Phase 0a.13 — PR template compliance guard.
 *
 * Operator's second-monitor improvement #4 (2026-05-03): tighten the PR
 * checklist so DoD status + confidence labeling + gold-standard compliance
 * are explicitly called out. Pairs with the Phase 0a.13 PR template at
 * `.github/pull_request_template.md`.
 *
 * What this guard does:
 *
 *   1. Reads PR body from one of two sources:
 *      - CI merge-gate: `gh pr view <pr-number> --json body --jq .body`
 *      - Local pre-check: `--body-file <path>` (operator can dry-run
 *        before opening the PR).
 *
 *   2. Verifies the body contains all 5 mandatory section headings:
 *      a. `## DoD Status`
 *      b. `## Confidence Labels`
 *      c. `## Gold-Standard Compliance`
 *      d. `## L3 / L4 / L5 References`
 *      e. `## Atomic Commit List`
 *
 *   3. Verifies each section has substantive content (not just the
 *      placeholder text from the template).
 *
 *   4. Inline opt-out: `<!-- @pr-template-exempt: <reason> -->` (REQUIRES
 *      non-empty reason). Use sparingly for trivial PRs (typo fixes,
 *      single-line doc updates).
 *
 *   5. Allowlist (`scripts/guards/check-pr-template-compliance.allowlist`)
 *      for PR-author + PR-number combos that legitimately don't need all
 *      5 sections (e.g., dependency bumps from automated tools).
 *
 * Exit codes:
 *   0 — all 5 sections present with substantive content OR explicitly exempt
 *   1 — one or more sections missing or placeholder-only
 *   2 — usage error OR allowlist malformed
 *
 * Usage:
 *   tsx scripts/guards/check-pr-template-compliance.ts --pr <pr-number>     # CI mode
 *   tsx scripts/guards/check-pr-template-compliance.ts --body-file <path>   # local pre-check
 */

import { readFileSync } from 'fs';
import { execSync } from 'child_process';
import { join } from 'path';
import { REPO_ROOT } from './lib/repoRoot';

const ALLOWLIST_PATH = join(REPO_ROOT, 'scripts/guards/check-pr-template-compliance.allowlist');

const REQUIRED_SECTIONS: readonly { heading: string; placeholder: string }[] = [
  { heading: '## DoD Status', placeholder: '(per-DoD-line status here)' },
  { heading: '## Confidence Labels', placeholder: '(per-claim confidence labels here)' },
  { heading: '## Gold-Standard Compliance', placeholder: '(gold-standard compliance statement here)' },
  { heading: '## L3 / L4 / L5 References', placeholder: '(reviewer agent verdict references here)' },
  { heading: '## Atomic Commit List', placeholder: '(atomic commit list here)' },
];

// Phase 0a.13 cycle-2 absorb of L3 finding #1: prior pattern `[^->]*` excluded
// hyphens, breaking documented exemption examples (`dependabot-bump-pr`,
// `typo-only-pr`). Use a non-greedy match terminated by `-->` so reasons
// containing hyphens, slashes, dots, etc. are accepted.
const INLINE_EXEMPT_REGEX = /<!--\s*@pr-template-exempt:\s*([^\s].*?)\s*-->/;

interface MissingSection {
  heading: string;
  reason: 'absent' | 'placeholder-only';
}

interface AllowlistEntry {
  raw: string;
  fingerprint: string;
  annotation: string;
}

function loadAllowlist(): { entries: Map<string, AllowlistEntry>; malformed: string[] } {
  const entries = new Map<string, AllowlistEntry>();
  const malformed: string[] = [];
  let raw: string;
  try {
    raw = readFileSync(ALLOWLIST_PATH, 'utf8');
  } catch {
    return { entries, malformed };
  }
  for (const line of raw.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const sepIdx = trimmed.indexOf('  # ');
    if (sepIdx < 0) {
      malformed.push(`missing "  # " separator: ${trimmed.slice(0, 80)}`);
      continue;
    }
    const fingerprint = trimmed.slice(0, sepIdx).trim();
    const annotation = trimmed.slice(sepIdx + 4).trim();
    if (!/(?:BUG-[A-Z0-9_-]+|permanent:)/i.test(annotation)) {
      malformed.push(`annotation lacks BUG-XXX or permanent: rationale — ${trimmed}`);
      continue;
    }
    if (!/expires:\s*\d{4}-\d{2}-\d{2}/i.test(annotation) && !/permanent:/i.test(annotation)) {
      malformed.push(`annotation lacks expires:date or permanent: rationale — ${trimmed}`);
      continue;
    }
    entries.set(fingerprint, { raw: trimmed, fingerprint, annotation });
  }
  return { entries, malformed };
}

function loadBody(args: string[]): { text: string; source: string } {
  const prMode = args.indexOf('--pr');
  if (prMode >= 0 && args[prMode + 1]) {
    const prNum = args[prMode + 1];
    try {
      const body = execSync(`gh pr view ${prNum} --json body --jq .body`, { encoding: 'utf8' });
      return { text: body, source: `PR #${prNum} body via gh` };
    } catch (err) {
      console.error(`Failed to read PR #${prNum} body via gh: ${(err as Error).message}`);
      process.exit(2);
    }
  }
  const bodyFile = args.indexOf('--body-file');
  if (bodyFile >= 0 && args[bodyFile + 1]) {
    const path = args[bodyFile + 1];
    return { text: readFileSync(path, 'utf8'), source: path };
  }
  console.error('Usage: check-pr-template-compliance.ts --pr <pr-number> | --body-file <path>');
  process.exit(2);
}

function checkSection(text: string, heading: string, placeholder: string): MissingSection | null {
  const headingIdx = text.indexOf(heading);
  if (headingIdx < 0) {
    return { heading, reason: 'absent' };
  }
  // Find the next section heading or end of file
  const nextHeadingMatch = /\n##\s+/.exec(text.slice(headingIdx + heading.length));
  const sectionEnd = nextHeadingMatch
    ? headingIdx + heading.length + nextHeadingMatch.index
    : text.length;
  const sectionContent = text.slice(headingIdx + heading.length, sectionEnd).trim();
  // Strip HTML comments (template's instruction blocks)
  const stripped = sectionContent.replace(/<!--[\s\S]*?-->/g, '').trim();
  // Empty OR only placeholder text → fail
  if (stripped === '' || stripped === placeholder) {
    return { heading, reason: 'placeholder-only' };
  }
  return null;
}

interface ComplianceResult {
  ok: boolean;
  missing: MissingSection[];
  exempt: boolean;
  exemptReason: string | null;
}

function checkCompliance(text: string): ComplianceResult {
  // Check inline exemption first
  if (INLINE_EXEMPT_REGEX.test(text)) {
    const m = INLINE_EXEMPT_REGEX.exec(text);
    // Capture group 1 of INLINE_EXEMPT_REGEX is the reason text itself.
    const reason = m && m[1] ? m[1].trim() : '(no reason captured)';
    return { ok: true, missing: [], exempt: true, exemptReason: reason };
  }
  const missing: MissingSection[] = [];
  for (const section of REQUIRED_SECTIONS) {
    const result = checkSection(text, section.heading, section.placeholder);
    if (result) missing.push(result);
  }
  return { ok: missing.length === 0, missing, exempt: false, exemptReason: null };
}

function main(): void {
  const args = process.argv.slice(2);
  console.log('\n→ check-pr-template-compliance (Phase 0a.13)\n');

  const { entries: allowlist, malformed } = loadAllowlist();
  if (malformed.length > 0) {
    console.error('Allowlist malformed:');
    for (const m of malformed) console.error(`  ${m}`);
    process.exit(2);
  }

  const { text, source } = loadBody(args);
  console.log(`  source: ${source}`);
  console.log(`  text length: ${text.length} chars`);
  console.log(`  allowlist entries: ${allowlist.size}`);
  console.log(`  required sections: ${REQUIRED_SECTIONS.length}`);

  const result = checkCompliance(text);

  if (result.exempt) {
    console.log(`  inline exempt: ${result.exemptReason}`);
    console.log('');
    console.log('✓ PR body has @pr-template-exempt annotation; section check skipped.');
    process.exit(0);
  }

  console.log(`  missing sections: ${result.missing.length}\n`);

  if (result.ok) {
    console.log('✓ All 5 mandatory sections present with substantive content.');
    process.exit(0);
  }

  console.log('═══ MISSING / PLACEHOLDER SECTIONS ═══\n');
  for (const m of result.missing) {
    console.log(`  ${m.heading}`);
    console.log(`    reason: ${m.reason}`);
    console.log(`    fix: ${m.reason === 'absent' ? 'add the heading + substantive content' : 'replace placeholder text with actual content'}`);
    console.log('');
  }
  console.log(
    'PR body must contain all 5 mandatory sections from the template (.github/pull_request_template.md).',
  );
  console.log('Inline opt-out for trivial PRs: <!-- @pr-template-exempt: <reason> -->');
  process.exit(1);
}

if (require.main === module) {
  main();
}

export { checkCompliance, checkSection, REQUIRED_SECTIONS };
