#!/usr/bin/env tsx
/**
 * scripts/guards/check-commit-claims.ts
 *
 * Phase 0a.12 — claim-discipline guard for commit messages + PR descriptions.
 *
 * Operator's second-monitor concern #3 (2026-05-03): commit/PR text honesty
 * is weaker than file honesty. Existing guards catch a lot in committed
 * files (no-band-aid-annotations / response-shape-validated / mapper-naming),
 * but claim-quality in commit messages and PR bodies is more human-policed
 * than mechanically enforced. shortcut-detector caught the agent (Claude)
 * commit-message text 3+ times in a single session's 4 absorb cycles —
 * exactly the failure mode this guard prevents at merge gate.
 *
 * What this guard does:
 *
 *   1. Reads claim text from one of two sources:
 *      - Local commit-msg hook: `.git/COMMIT_EDITMSG` (the message about
 *        to be committed) — invoked via `.husky/commit-msg`.
 *      - CI merge-gate: `gh pr view --json body --jq .body` (the PR
 *        description on the open PR) — invoked when COMMIT_EDITMSG is
 *        absent + the script is run with `--mode=pr <pr-number>`.
 *
 *   2. Applies the banned-phrase rubric mirroring shortcut-detector +
 *      gold-standard-enforcer:
 *      - Unsubstantiated-prediction phrases ("should work" / "looks correct"
 *        / "likely" / "probably" / "I'm sure").
 *      - Unverifiable-totality claims ("comprehensive" / "exhaustive" /
 *        "all modules" / "every X" / "complete coverage") without a
 *        per-item tally OR an honest-qualifier ("audit (sampled)").
 *      - Unsubstantiated-closure claims ("fixed" without commit SHA;
 *        "tests pass" without command output; "complete" / "done" /
 *        "shipped" without DoD reference).
 *      - Gold-standard-downgrade phrasing ("Approach B chosen" /
 *        "easier" / "faster" / "less risk" / "fewer edits" as
 *        reasoning) without operator authorization or BUG citation.
 *
 *   3. Allows inline honest qualifiers:
 *      - `[Confidence: HIGH/MEDIUM/LOW/UNKNOWN — <reason>]`
 *      - `[NOT REQUESTED — <reason>]` for actions explicitly deferred
 *      - `[NOT INVOKED — <reason>]` for agents explicitly skipped
 *
 *   4. Allowlist (`scripts/guards/check-commit-claims.allowlist`) for
 *      fingerprinted historical claims that pre-date the guard.
 *      Per Phase 0a.7 expiry policy: every entry has `permanent: <reason>`
 *      OR `expires: YYYY-MM-DD (cascade: BUG-XXX)` annotation.
 *
 * Exit codes:
 *   0 — clean (no banned phrases without honest qualifier)
 *   1 — violations found (NEW unqualified claim detected)
 *   2 — allowlist malformed or stale OR usage error
 *
 * Usage:
 *   tsx scripts/guards/check-commit-claims.ts                     # local commit-msg hook
 *   tsx scripts/guards/check-commit-claims.ts --commit-msg <path> # explicit path
 *   tsx scripts/guards/check-commit-claims.ts --pr <pr-number>    # CI merge-gate via gh
 */

import { readFileSync, existsSync } from 'fs';
import { execSync } from 'child_process';
import { join } from 'path';
import { REPO_ROOT } from './lib/repoRoot';

const ALLOWLIST_PATH = join(REPO_ROOT, 'scripts/guards/check-commit-claims.allowlist');

// Honest-qualifier patterns that downgrade an otherwise-banned phrase.
// If a banned phrase appears within `WINDOW_CHARS` of one of these
// qualifiers, the phrase is treated as honestly-labeled (not a violation).
const QUALIFIER_REGEXES: readonly RegExp[] = [
  /\[Confidence:\s*(?:HIGH|MEDIUM|LOW|UNKNOWN)\s*[—-][^\]]*\]/i,
  /\[NOT REQUESTED[^\]]*\]/i,
  /\[NOT INVOKED[^\]]*\]/i,
  /\[PENDING[^\]]*\]/i,
  /\[BLOCKED[^\]]*\]/i,
  /\baudit\s*\(sampled\)/i,
  /\bstatic-traced;\s*runtime\s+unverified\b/i,
];

const WINDOW_CHARS = 250;

interface BannedPattern {
  readonly id: string;
  readonly regex: RegExp;
  readonly class: string;
  readonly required: string;
}

// Mirrors shortcut-detector + gold-standard-enforcer rubrics.
const BANNED_PATTERNS: readonly BannedPattern[] = [
  // Unsubstantiated-prediction
  { id: 'should-work', regex: /\bshould work\b/gi, class: 'unverified-prediction', required: 'verified claim or [Confidence: LOW — <reason>]' },
  { id: 'looks-correct', regex: /\blooks correct\b/gi, class: 'static-only-claim', required: '[Confidence: MEDIUM — static-traced; runtime unverified]' },
  { id: 'likely', regex: /\blikely\b/gi, class: 'inferred-without-verification', required: 'verified claim or [Confidence: LOW — inferred; not verified]' },
  { id: 'probably', regex: /\bprobably\b/gi, class: 'inferred-without-verification', required: 'verified claim or [Confidence: LOW — inferred]' },
  { id: 'im-sure', regex: /\bI(?:'|')?m sure\b/gi, class: 'claim-without-artifact', required: 'cite artifact or [Confidence: LOW]' },
  { id: 'im-confident', regex: /\bI(?:'|')?m confident\b/gi, class: 'claim-without-artifact', required: 'cite artifact or [Confidence: LOW]' },
  { id: 'this-should-be-fine', regex: /\bthis should be fine\b/gi, class: 'hand-waving', required: 'state the concrete check + run it' },
  { id: 'the-chain-is-intact', regex: /\bthe chain (?:is intact|works)\b/gi, class: 'static-claim-as-runtime', required: '[Confidence: MEDIUM — static chain traced; runtime path not exercised]' },
  // Unverifiable-totality
  { id: 'comprehensive', regex: /\bcomprehensive\b/gi, class: 'unverifiable-totality', required: 'per-item tally OR audit (sampled): N of M covered' },
  { id: 'exhaustive', regex: /\bexhaustive\b/gi, class: 'unverifiable-totality', required: 'per-item tally OR audit (sampled): N of M covered' },
  { id: 'complete-coverage', regex: /\bcomplete coverage\b/gi, class: 'unverifiable-totality', required: 'per-item tally with each ✓/✗' },
  // Unsubstantiated-closure
  { id: 'tests-pass-no-output', regex: /\btests? pass(?:ed|ing)?\b/gi, class: 'unrun-test-claim', required: 'show command + output OR run it' },
  { id: 'no-regressions', regex: /\bno\s+regressions?\b/gi, class: 'unrun-regression-claim', required: 'show regression suite output' },
  // Gold-standard-downgrade phrasing (mirrors gold-standard-enforcer rubric)
  { id: 'approach-b', regex: /\b(?:approach b|option 2)\b\s+(?:recommended|chosen|preferred)/gi, class: 'multi-approach-recommendation', required: 'cite operator authorization OR pivot to gold-standard' },
  { id: 'easier-as-reason', regex: /\b(?:easier|faster|less risk|fewer edits|simpler)\b/gi, class: 'effort-downgrade', required: 'effort is not a valid reason; cite operator authorization OR pivot to gold-standard' },
  // Silent deferral (mirrors gold-standard-enforcer)
  { id: 'for-now-no-bug', regex: /\bfor now\b/gi, class: 'silent-deferral', required: 'cite BUG-XXX-FOLLOWUP-* with close-by date' },
  { id: 'interim', regex: /\binterim\b/gi, class: 'silent-deferral', required: 'cite BUG-XXX-FOLLOWUP-* with close-by date' },
  { id: 'temporary-no-bug', regex: /\btemporar(?:y|ily)\b/gi, class: 'silent-deferral', required: 'cite BUG-XXX-FOLLOWUP-* with close-by date OR permanent: <reason>' },
];

// Specific-shape requirements that override the simple within-window check.
// E.g. "fixed" requires a commit SHA pattern (7+ hex chars).
const SHAPE_REQUIREMENTS: readonly { regex: RegExp; companion: RegExp; required: string; class: string; id: string }[] = [
  { id: 'fixed-no-sha', regex: /\b(?:fixed|fix(?:es|ed)?)\s+BUG-/gi, companion: /\b[a-f0-9]{7,40}\b/i, required: 'cite commit SHA (7+ hex)', class: 'unsubstantiated-closure' },
];

interface Violation {
  readonly line: number;
  readonly col: number;
  readonly snippet: string;
  readonly pattern_id: string;
  readonly pattern_class: string;
  readonly required: string;
}

interface AllowlistEntry {
  readonly raw: string;
  readonly fingerprint: string;
  readonly annotation: string;
}

function fingerprintFor(snippet: string): string {
  return snippet.replace(/\s+/g, ' ').trim().slice(0, 200);
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

function loadClaimText(args: string[]): { text: string; source: string } {
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
  const explicitPath = args.indexOf('--commit-msg');
  if (explicitPath >= 0 && args[explicitPath + 1]) {
    const path = args[explicitPath + 1];
    return { text: readFileSync(path, 'utf8'), source: path };
  }
  // Default: local commit-msg hook (.git/COMMIT_EDITMSG).
  const editmsg = join(REPO_ROOT, '.git/COMMIT_EDITMSG');
  if (existsSync(editmsg)) {
    return { text: readFileSync(editmsg, 'utf8'), source: '.git/COMMIT_EDITMSG' };
  }
  console.error('Usage: check-commit-claims.ts [--commit-msg <path>] [--pr <pr-number>]');
  console.error('Default: read .git/COMMIT_EDITMSG (commit-msg hook).');
  process.exit(2);
}

function isQualifiedNearby(text: string, pos: number): boolean {
  const start = Math.max(0, pos - WINDOW_CHARS);
  const end = Math.min(text.length, pos + WINDOW_CHARS);
  const window = text.slice(start, end);
  for (const qre of QUALIFIER_REGEXES) {
    if (qre.test(window)) return true;
  }
  return false;
}

function scanText(text: string): Violation[] {
  const violations: Violation[] = [];
  const lines = text.split('\n');
  const lineOffsets: number[] = [0];
  for (let i = 0; i < lines.length; i++) {
    lineOffsets.push(lineOffsets[i] + lines[i].length + 1);
  }
  function locate(absPos: number): { line: number; col: number } {
    for (let i = 1; i < lineOffsets.length; i++) {
      if (lineOffsets[i] > absPos) return { line: i, col: absPos - lineOffsets[i - 1] + 1 };
    }
    return { line: lines.length, col: 1 };
  }

  for (const pat of BANNED_PATTERNS) {
    pat.regex.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = pat.regex.exec(text)) !== null) {
      if (isQualifiedNearby(text, m.index)) continue;
      const { line, col } = locate(m.index);
      const lineContent = lines[line - 1] ?? '';
      violations.push({
        line,
        col,
        snippet: lineContent.trim().slice(0, 200),
        pattern_id: pat.id,
        pattern_class: pat.class,
        required: pat.required,
      });
    }
  }

  for (const shape of SHAPE_REQUIREMENTS) {
    shape.regex.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = shape.regex.exec(text)) !== null) {
      const start = Math.max(0, m.index - WINDOW_CHARS);
      const end = Math.min(text.length, m.index + m[0].length + WINDOW_CHARS);
      if (shape.companion.test(text.slice(start, end))) continue;
      const { line, col } = locate(m.index);
      const lineContent = lines[line - 1] ?? '';
      violations.push({
        line,
        col,
        snippet: lineContent.trim().slice(0, 200),
        pattern_id: shape.id,
        pattern_class: shape.class,
        required: shape.required,
      });
    }
  }

  return violations;
}

function main(): void {
  const args = process.argv.slice(2);
  console.log('\n→ check-commit-claims (Phase 0a.12)\n');

  const { entries: allowlist, malformed } = loadAllowlist();
  if (malformed.length > 0) {
    console.error('Allowlist malformed:');
    for (const m of malformed) console.error(`  ${m}`);
    process.exit(2);
  }

  const { text, source } = loadClaimText(args);
  console.log(`  source: ${source}`);
  console.log(`  text length: ${text.length} chars`);
  console.log(`  allowlist entries: ${allowlist.size}`);

  const allViolations = scanText(text);
  const usedFingerprints = new Set<string>();
  const filtered: Violation[] = [];
  for (const v of allViolations) {
    const fp = fingerprintFor(v.snippet);
    if (allowlist.has(fp)) {
      usedFingerprints.add(fp);
      continue;
    }
    filtered.push(v);
  }
  const stale: AllowlistEntry[] = [];
  for (const [fp, e] of allowlist.entries()) {
    if (!usedFingerprints.has(fp)) stale.push(e);
  }

  console.log(`  violations:    ${filtered.length}`);
  console.log(`  stale allowlist: ${stale.length}\n`);

  if (filtered.length === 0 && stale.length === 0) {
    console.log('✓ Every claim in the commit/PR text carries an honest qualifier or backing artifact.');
    process.exit(0);
  }

  if (filtered.length > 0) {
    console.log('═══ VIOLATIONS ═══\n');
    for (const v of filtered) {
      console.log(`  line ${v.line} col ${v.col}`);
      console.log(`    pattern: ${v.pattern_id} (class: ${v.pattern_class})`);
      console.log(`    snippet: ${v.snippet}`);
      console.log(`    required: ${v.required}`);
      console.log('');
    }
  }

  if (stale.length > 0) {
    console.log('═══ STALE ALLOWLIST ENTRIES ═══\n');
    for (const s of stale) console.log(`  ${s.raw}`);
    console.log('');
    process.exit(2);
  }

  process.exit(1);
}

if (require.main === module) {
  main();
}

// Phase 0a.12 absorb of L5 0a.11 advisory #2 pattern: also export
// helpers for fixture testing.
export { scanText, isQualifiedNearby, BANNED_PATTERNS, SHAPE_REQUIREMENTS };
