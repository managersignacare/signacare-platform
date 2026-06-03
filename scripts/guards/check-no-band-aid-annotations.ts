#!/usr/bin/env tsx
/**
 * scripts/guards/check-no-band-aid-annotations.ts
 *
 * Phase 0a.9 — companion guard for the `gold-standard-enforcer` agent.
 *
 * The agent (Layer 0a discipline) catches band-aid framing in conversational
 * text, plan files, and commit messages at claim-time. This guard provides
 * the mechanical complement at file-content-time: any band-aid annotation
 * inside source code, plan files, or quality docs MUST cite a BUG-XXX
 * identifier OR be marked `permanent: <reason>`.
 *
 * Why this exists:
 *
 *   - `feedback_absolute_gold_standard.md` is non-negotiable: no band-aids,
 *     no monitoring as substitute, no grandfathering, no silent deferral.
 *   - The agent catches it in CLAIMS (recommendation paragraphs).
 *   - This guard catches it in ARTIFACTS (committed files).
 *   - Together they form Layer 0a's two-rail enforcement: agent for
 *     claim-time, guard for content-time.
 *
 * Detected patterns (case-insensitive, comment-stripped where applicable):
 *
 *   1. `// TODO` / `// FIXME` / `// HACK` / `// XXX` without `BUG-XXX` on
 *      the same line OR within 80 chars of the marker.
 *
 *   2. `for now` / `for the time being` / `interim` / `temporary` /
 *      `temporarily` / `v1 lenience` / `MVP` / `first cut` in CLAUDE.md,
 *      docs/quality/*.md, or plan files unless followed by BUG-XXX
 *      citation OR `permanent: <reason>` within 200 chars.
 *
 *   3. `out of scope` in any reviewer-facing artifact unless followed by
 *      BUG-XXX citation within 200 chars.
 *
 *   4. `// @*-exempt: temporary` / `// @*-exempt: TODO` / `// @*-exempt: FIXME`
 *      in source code (exempt annotations require a structural reason from
 *      the §12.4 taxonomy or equivalent — never "temporary").
 *
 *   5. `monitor` / `regression test` / `size ratchet` framed as a
 *      substitute (preceded by phrases like "instead of", "as a", "rather
 *      than") for fixing the root cause.
 *
 * Allowlist:
 *   scripts/guards/check-no-band-aid-annotations.allowlist
 *   Per Phase 0a.7 expiry retrofit: every entry has expires:date OR
 *   permanent:<reason> annotation. Pre-existing patterns are baselined
 *   under BUG-PHASE-0A-9-CASCADE-DRAIN-BAND-AID-ANNOTATIONS.
 *
 * Inline opt-out (in-file):
 *   `// @band-aid-exempt: <BUG-XXX | permanent:reason>` — REQUIRES non-
 *   empty rationale that names a BUG row OR explicit permanent rationale.
 *
 * Exit codes:
 *   0 — all band-aid annotations carry BUG-XXX citation or permanent rationale
 *   1 — violations found; details printed
 *   2 — allowlist is malformed or stale
 *
 * Run: tsx scripts/guards/check-no-band-aid-annotations.ts
 *      OR npm run guard:no-band-aid-annotations
 */

import { promises as fs } from 'fs';
import * as path from 'path';

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const ALLOWLIST_PATH = path.join(REPO_ROOT, 'scripts', 'guards', 'check-no-band-aid-annotations.allowlist');

interface Violation {
  readonly file: string;
  readonly line: number;
  readonly snippet: string;
  readonly pattern: string;
  readonly required: string;
}

interface AllowlistEntry {
  readonly raw: string;
  readonly fingerprint: string;
  readonly annotation: string;
}

const SCAN_GLOBS: readonly { dir: string; ext: RegExp; recursive: boolean }[] = [
  { dir: path.join(REPO_ROOT, 'apps', 'api', 'src'), ext: /\.(ts|tsx|js|jsx)$/, recursive: true },
  { dir: path.join(REPO_ROOT, 'apps', 'web', 'src'), ext: /\.(ts|tsx|js|jsx)$/, recursive: true },
  { dir: path.join(REPO_ROOT, 'packages', 'shared', 'src'), ext: /\.(ts|tsx|js|jsx)$/, recursive: true },
  { dir: path.join(REPO_ROOT, 'docs', 'quality'), ext: /\.md$/, recursive: false },
  { dir: path.join(REPO_ROOT, 'docs', 'plans'), ext: /\.md$/, recursive: false },
  { dir: REPO_ROOT, ext: /^CLAUDE\.md$/, recursive: false },
];

const SKIP_DIRS = new Set([
  'node_modules', 'dist', 'build', 'coverage', '.next', '.git',
  '__tests__', '__fixtures__', 'migrations.archive',
  // The agent and fixture files necessarily contain the patterns by name —
  // they're rules-about-the-patterns, not violations.
  'agents',
]);

// Ban-list of band-aid patterns. Each pattern is a regex; the `requires`
// field is what must accompany the pattern within `windowChars` to PASS.
const PATTERNS: readonly {
  name: string;
  regex: RegExp;
  windowChars: number;
  requires: RegExp;
  requiredHuman: string;
  // If true, the pattern only applies inside source code (TS/JS files).
  sourceOnly?: boolean;
  // If true, the pattern only applies inside markdown / plan files.
  docsOnly?: boolean;
}[] = [
  {
    name: 'TODO/FIXME/HACK/XXX without BUG citation',
    regex: /\b(?:\/\/|#|<!--)\s*(?:TODO|FIXME|HACK|XXX)\b/gi,
    windowChars: 200,
    requires: /(?:BUG-[A-Z0-9_-]+|@band-aid-exempt:\s*permanent:)/i,
    requiredHuman: 'BUG-XXX citation OR @band-aid-exempt: permanent:<reason>',
    sourceOnly: true,
  },
  {
    name: '"for now" deferral without BUG citation',
    regex: /\bfor now\b/gi,
    windowChars: 250,
    requires: /(?:BUG-[A-Z0-9_-]+|permanent:|@band-aid-exempt:)/i,
    requiredHuman: 'BUG-XXX citation within 250 chars OR explicit permanent: rationale',
    docsOnly: true,
  },
  {
    name: '"interim" / "temporary" / "v1 lenience" without BUG citation',
    regex: /\b(?:interim|temporary|temporarily|v1 lenience|first cut)\b/gi,
    windowChars: 250,
    requires: /(?:BUG-[A-Z0-9_-]+|permanent:|@band-aid-exempt:)/i,
    requiredHuman: 'BUG-XXX citation within 250 chars OR explicit permanent: rationale',
    docsOnly: true,
  },
  {
    name: '"out of scope" without BUG citation',
    regex: /\bout of scope\b/gi,
    windowChars: 250,
    requires: /(?:BUG-[A-Z0-9_-]+|permanent:|@band-aid-exempt:)/i,
    requiredHuman: 'BUG-XXX citation within 250 chars OR explicit permanent: rationale',
    docsOnly: true,
  },
  {
    name: '@*-exempt: temporary/TODO/FIXME (band-aid disguised as exemption)',
    regex: /@[a-z-]+-exempt:\s*(?:temporary|TODO|FIXME|todo|fixme|temp\b)/gi,
    windowChars: 0,
    requires: /(?:BUG-[A-Z0-9_-]+|permanent:)/i,
    requiredHuman: 'replace "temporary" with §12.4-style category OR cite BUG-XXX',
    sourceOnly: true,
  },
];

async function walk(dir: string, ext: RegExp, recursive: boolean): Promise<string[]> {
  const out: string[] = [];
  async function rec(p: string): Promise<void> {
    let entries;
    try {
      entries = await fs.readdir(p, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      const full = path.join(p, e.name);
      if (e.isDirectory()) {
        if (SKIP_DIRS.has(e.name)) continue;
        if (recursive) await rec(full);
      } else if (ext.test(e.name)) {
        out.push(full);
      }
    }
  }
  if (!recursive) {
    // Single-directory mode (no recursion into subdirs)
    try {
      const entries = await fs.readdir(dir, { withFileTypes: true });
      for (const e of entries) {
        if (!e.isDirectory() && ext.test(e.name)) {
          out.push(path.join(dir, e.name));
        }
      }
    } catch {
      // missing directory is fine — skip silently
    }
  } else {
    await rec(dir);
  }
  return out;
}

function relPath(p: string): string {
  return path.relative(REPO_ROOT, p);
}

function fingerprintFor(file: string, _line: number, snippet: string): string {
  // Line-shift-resilient: file:snippet (line is informational only).
  // Per Phase 0a.7 retrofit, fingerprints survive small reformatting.
  const cleaned = snippet.replace(/\s+/g, ' ').trim().slice(0, 200);
  return `${relPath(file)}::${cleaned}`;
}

async function loadAllowlist(): Promise<{
  entries: Map<string, AllowlistEntry>;
  malformed: string[];
}> {
  const entries = new Map<string, AllowlistEntry>();
  const malformed: string[] = [];
  let raw: string;
  try {
    raw = await fs.readFile(ALLOWLIST_PATH, 'utf8');
  } catch {
    return { entries, malformed };
  }
  for (const line of raw.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    // Format: <fingerprint>  # BUG-XXX expires: 2026-MM-DD OR permanent: <reason>
    // Separator is "  # " (double-space-hash-space) so fingerprints may contain `#`.
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
    if (/expires:\s*\d{4}-\d{2}-\d{2}/i.test(annotation) || /permanent:/i.test(annotation)) {
      entries.set(fingerprint, { raw: trimmed, fingerprint, annotation });
    } else {
      malformed.push(`annotation lacks expires:date or permanent: rationale — ${trimmed}`);
    }
  }
  return { entries, malformed };
}

function isInlineExempt(line: string): boolean {
  return /\/\/\s*@band-aid-exempt:\s*(?:BUG-[A-Z0-9_-]+|permanent:[^]+)/i.test(line);
}

async function scanFile(
  file: string,
  isSource: boolean,
  isDocs: boolean,
): Promise<Violation[]> {
  const violations: Violation[] = [];
  let content: string;
  try {
    content = await fs.readFile(file, 'utf8');
  } catch {
    return violations;
  }
  const lines = content.split('\n');

  for (const pattern of PATTERNS) {
    if (pattern.sourceOnly && !isSource) continue;
    if (pattern.docsOnly && !isDocs) continue;
    pattern.regex.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = pattern.regex.exec(content)) !== null) {
      const matchIdx = m.index;
      const lineNum = content.slice(0, matchIdx).split('\n').length;
      const lineContent = lines[lineNum - 1] ?? '';

      // Check inline exemption
      if (isInlineExempt(lineContent)) continue;

      // Check window for required text
      const windowStart = Math.max(0, matchIdx - pattern.windowChars);
      const windowEnd = Math.min(content.length, matchIdx + m[0].length + pattern.windowChars);
      const window = content.slice(windowStart, windowEnd);
      if (pattern.requires.test(window)) continue;

      violations.push({
        file,
        line: lineNum,
        snippet: lineContent.trim().slice(0, 200),
        pattern: pattern.name,
        required: pattern.requiredHuman,
      });
    }
  }
  return violations;
}

async function main(): Promise<void> {
  console.log('\n→ check-no-band-aid-annotations\n');

  // Load allowlist + check malformed
  const { entries: allowlist, malformed } = await loadAllowlist();
  if (malformed.length > 0) {
    console.error('Allowlist malformed:');
    for (const m of malformed) console.error(`  ${m}`);
    process.exit(2);
  }
  console.log(`  allowlist entries: ${allowlist.size}`);

  // Collect all files
  const sourceExt = /\.(ts|tsx|js|jsx)$/;
  const docsExt = /\.md$/;
  const allFiles: { file: string; isSource: boolean; isDocs: boolean }[] = [];
  for (const g of SCAN_GLOBS) {
    const files = await walk(g.dir, g.ext, g.recursive);
    for (const f of files) {
      const isSource = sourceExt.test(f);
      const isDocs = docsExt.test(f);
      allFiles.push({ file: f, isSource, isDocs });
    }
  }

  console.log(`  files scanned: ${allFiles.length}`);

  // Scan
  const allViolations: Violation[] = [];
  const usedFingerprints = new Set<string>();
  for (const { file, isSource, isDocs } of allFiles) {
    const fileViolations = await scanFile(file, isSource, isDocs);
    for (const v of fileViolations) {
      const fp = fingerprintFor(v.file, v.line, v.snippet);
      if (allowlist.has(fp)) {
        usedFingerprints.add(fp);
        continue;
      }
      allViolations.push(v);
    }
  }

  // Stale allowlist detection
  const stale: AllowlistEntry[] = [];
  for (const [fp, entry] of allowlist.entries()) {
    if (!usedFingerprints.has(fp)) stale.push(entry);
  }

  console.log(`  violations:   ${allViolations.length}`);
  console.log(`  stale allowlist entries: ${stale.length}\n`);

  if (allViolations.length === 0 && stale.length === 0) {
    console.log('✓ All band-aid annotations carry BUG-XXX citation or permanent rationale.\n');
    process.exit(0);
  }

  if (allViolations.length > 0) {
    console.log('═══ VIOLATIONS ═══\n');
    for (const v of allViolations) {
      console.log(`  ${relPath(v.file)}:${v.line}`);
      console.log(`    pattern: ${v.pattern}`);
      console.log(`    snippet: ${v.snippet}`);
      console.log(`    required: ${v.required}`);
      console.log('');
    }
  }

  if (stale.length > 0) {
    console.log('═══ STALE ALLOWLIST ENTRIES (no longer match any code) ═══\n');
    for (const s of stale) {
      console.log(`  ${s.raw}`);
    }
    console.log('\nRemove stale entries from check-no-band-aid-annotations.allowlist or fix the underlying drift.\n');
    process.exit(2);
  }

  process.exit(1);
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error('Guard execution failed:', err);
  process.exit(2);
});
