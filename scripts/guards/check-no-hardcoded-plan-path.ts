#!/usr/bin/env tsx
/**
 * scripts/guards/check-no-hardcoded-plan-path.ts
 *
 * Phase 0a.11 — mechanical enforcement of the "no hardcoded plan path"
 * rule introduced by `docs/quality/active-plan.md`.
 *
 * Operator's second-monitor concern #2 (2026-05-03): hardcoded external
 * paths (esp. `~/.claude/plans/sleepy-roaming-meteor.md`) appear in 4 of
 * 5 NEW Layer 0a agent prompts + 1 memory entry. Brittle if plan name
 * changes or another plan supersedes. Phase 0a.11 introduces:
 *   1. A canonical pointer: `docs/quality/active-plan.md`.
 *   2. Agent prompts that read from the pointer instead of hardcoded path.
 *   3. THIS GUARD that rejects any future hardcoded plan path outside
 *      the pointer file or the allowlist.
 *
 * Detected pattern: any string matching `/[~/].claude/plans/[a-z-]+\.md/`
 * in scanned files. The pattern catches both `~/.claude/plans/<name>.md`
 * and absolute `/Users/.../.claude/plans/<name>.md` forms.
 *
 * Scanned surfaces:
 *   - `.claude/agents/*.md` — Layer 0a + reused L3-L5 agent prompts
 *   - `~/.claude/projects/-Users-drprakashkamath-Projects-Signacare/memory/feedback_*.md`
 *     — discipline memory entries (skipped if memory dir unreachable)
 *
 * Allowlist (`scripts/guards/check-no-hardcoded-plan-path.allowlist`):
 *   - `docs/quality/active-plan.md` — IS the canonical pointer (must mention path)
 *   - Memory entries citing the plan path as HISTORICAL reference
 *     (where the rule was first articulated) rather than runtime lookup
 *   - Per Phase 0a.7 expiry policy: every entry has `permanent: <reason>`
 *     OR `expires: YYYY-MM-DD (cascade: BUG-XXX)` annotation
 *
 * Inline opt-out: `<!-- @plan-path-exempt: <reason> -->` (markdown) for
 * very specific historical/documentation cases. REQUIRES non-empty reason.
 *
 * Exit codes:
 *   0 — every plan-path mention is in active-plan.md OR allowlist OR exempt
 *   1 — violations found (NEW hardcoded path detected)
 *   2 — allowlist malformed or stale
 */

import { readFileSync, existsSync, readdirSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { REPO_ROOT } from './lib/repoRoot';

const AGENTS_DIR = join(REPO_ROOT, '.claude/agents');
const MEMORY_DIR = join(homedir(), '.claude/projects/-Users-drprakashkamath-Projects-Signacare/memory');
const ACTIVE_PLAN_FILE = join(REPO_ROOT, 'docs/quality/active-plan.md');
const ALLOWLIST_PATH = join(REPO_ROOT, 'scripts/guards/check-no-hardcoded-plan-path.allowlist');

// Match `~/.claude/plans/<name>.md` OR `/Users/<user>/.claude/plans/<name>.md`.
const PLAN_PATH_REGEX = /(?:~|\/[A-Za-z][A-Za-z0-9_-]*\/[A-Za-z][A-Za-z0-9_.-]*)\/\.claude\/plans\/[a-zA-Z0-9_-]+\.md/g;
const INLINE_EXEMPT_REGEX = /<!--\s*@plan-path-exempt:\s*[^\s][^->]*-->/;

interface Violation {
  readonly file: string;
  readonly line: number;
  readonly snippet: string;
  readonly matched_path: string;
}

interface AllowlistEntry {
  readonly raw: string;
  readonly fingerprint: string;
  readonly annotation: string;
}

function relPath(p: string): string {
  return p.startsWith(REPO_ROOT) ? p.slice(REPO_ROOT.length + 1) : p.replace(homedir(), '~');
}

function fingerprintFor(file: string, snippet: string): string {
  const cleaned = snippet.replace(/\s+/g, ' ').trim().slice(0, 200);
  return `${relPath(file)}::${cleaned}`;
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

function scanFile(file: string): Violation[] {
  const violations: Violation[] = [];
  let content: string;
  try {
    content = readFileSync(file, 'utf8');
  } catch {
    return violations;
  }

  // The active-plan.md file IS the canonical pointer; all mentions there
  // are by-design. Skip entirely.
  if (file === ACTIVE_PLAN_FILE) return violations;

  const lines = content.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const lineContent = lines[i];
    if (INLINE_EXEMPT_REGEX.test(lineContent)) continue;
    PLAN_PATH_REGEX.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = PLAN_PATH_REGEX.exec(lineContent)) !== null) {
      violations.push({
        file,
        line: i + 1,
        snippet: lineContent.trim().slice(0, 200),
        matched_path: m[0],
      });
    }
  }
  return violations;
}

function collectFiles(): string[] {
  const out: string[] = [];
  // Agents dir (in repo)
  if (existsSync(AGENTS_DIR)) {
    for (const name of readdirSync(AGENTS_DIR)) {
      if (name.endsWith('.md')) out.push(join(AGENTS_DIR, name));
    }
  }
  // Memory dir (in ~/.claude — may be unreachable in CI)
  if (existsSync(MEMORY_DIR)) {
    for (const name of readdirSync(MEMORY_DIR)) {
      if (name.startsWith('feedback_') && name.endsWith('.md')) out.push(join(MEMORY_DIR, name));
    }
  }
  return out;
}

// Phase 0a.12 absorb of L5 0a.11 advisory #3: verify the active-plan.md
// pointer file itself has the canonical structural shape.
//
// active-plan.md MUST contain:
//   1. Exactly ONE `<!-- active-plan-path: <path> -->` HTML comment (machine-readable).
//   2. A prose `**Path**: ...` field (human-readable).
//   3. The path inside the HTML comment MUST agree with the prose field.
// All three are mechanically verified here so agents can trust the parse contract.
function checkActivePlanPointer(): { ok: boolean; errors: string[] } {
  const errors: string[] = [];
  if (!existsSync(ACTIVE_PLAN_FILE)) {
    return { ok: false, errors: [`active-plan.md does not exist at ${ACTIVE_PLAN_FILE}`] };
  }
  const content = readFileSync(ACTIVE_PLAN_FILE, 'utf8');

  // Anchor to line-start so backtick-quoted in-prose mentions
  // (`<!-- active-plan-path: <path> -->`) inside markdown code spans
  // are excluded; only standalone HTML comments on their own line count.
  const commentMatches = content.match(/^[ \t]*<!--\s*active-plan-path:\s*([^\s].*?)\s*-->[ \t]*$/gm) ?? [];
  if (commentMatches.length === 0) {
    errors.push('active-plan.md missing `<!-- active-plan-path: <path> -->` HTML comment (machine-readable pointer)');
  } else if (commentMatches.length > 1) {
    errors.push(`active-plan.md has ${commentMatches.length} \`<!-- active-plan-path: ... -->\` comments (must be exactly 1)`);
  }
  let commentPath: string | null = null;
  if (commentMatches.length === 1) {
    const m = /<!--\s*active-plan-path:\s*([^\s].*?)\s*-->/.exec(commentMatches[0]);
    if (m) commentPath = m[1].trim();
  }

  const proseMatch = /^\*\*Path\*\*:\s*`([^`]+)`/m.exec(content);
  if (!proseMatch) {
    errors.push('active-plan.md missing prose `**Path**: \\`<path>\\`` field (human-readable pointer)');
  }
  const prosePath = proseMatch ? proseMatch[1].trim() : null;

  if (commentPath !== null && prosePath !== null && commentPath !== prosePath) {
    errors.push(
      `active-plan.md drift: HTML comment path "${commentPath}" disagrees with prose **Path**: field "${prosePath}". ` +
        `Both must agree (no human/machine drift).`,
    );
  }

  return { ok: errors.length === 0, errors };
}

function main(): void {
  console.log('\n→ check-no-hardcoded-plan-path (Phase 0a.11; Phase 0a.12 active-plan structural check)\n');

  // Phase 0a.12: structural check of the canonical pointer file BEFORE
  // scanning consumers. If the pointer is broken, agents have no
  // contract to parse — surface that first.
  const ptr = checkActivePlanPointer();
  console.log(`  active-plan.md structural shape: ${ptr.ok ? '✓ valid' : '✗ INVALID'}`);
  if (!ptr.ok) {
    for (const e of ptr.errors) console.error(`    ${e}`);
    console.error('');
    console.error('Fix the active-plan.md pointer before agents can rely on the parse contract.');
    process.exit(1);
  }

  const { entries: allowlist, malformed } = loadAllowlist();
  if (malformed.length > 0) {
    console.error('Allowlist malformed:');
    for (const m of malformed) console.error(`  ${m}`);
    process.exit(2);
  }

  const files = collectFiles();
  console.log(`  files scanned: ${files.length}`);
  console.log(`  allowlist entries: ${allowlist.size}`);

  const allViolations: Violation[] = [];
  const usedFingerprints = new Set<string>();
  for (const file of files) {
    const fileViolations = scanFile(file);
    for (const v of fileViolations) {
      const fp = fingerprintFor(v.file, v.snippet);
      if (allowlist.has(fp)) {
        usedFingerprints.add(fp);
        continue;
      }
      allViolations.push(v);
    }
  }

  const stale: AllowlistEntry[] = [];
  for (const [fp, entry] of allowlist.entries()) {
    if (!usedFingerprints.has(fp)) stale.push(entry);
  }

  console.log(`  violations:           ${allViolations.length}`);
  console.log(`  stale allowlist:      ${stale.length}\n`);

  if (allViolations.length === 0 && stale.length === 0) {
    console.log('✓ Every plan-path mention is in active-plan.md, allowlisted with rationale, or inline-exempt.');
    process.exit(0);
  }

  if (allViolations.length > 0) {
    console.log('═══ VIOLATIONS ═══\n');
    for (const v of allViolations) {
      console.log(`  ${relPath(v.file)}:${v.line}`);
      console.log(`    matched: ${v.matched_path}`);
      console.log(`    snippet: ${v.snippet}`);
      console.log(`    fix: replace with reference to docs/quality/active-plan.md OR add to allowlist with rationale`);
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
