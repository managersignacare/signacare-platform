/**
 * PR-R1-20 — CI guard: Frontend permission / visibility / access hooks
 * MUST NOT return `() => true` on `isError` branches (CLAUDE.md §6.5
 * fail-CLOSED discipline; closes the BUG-416 class).
 *
 * Why this exists — BUG-416 (2026-04-26): `useModuleVisibility` returned
 * `() => true` predicates on upstream-fetch error, exposing
 * specialty-gated clinical surfaces (ECT/TMS/MHA/legal/advance-directives/
 * oncology/surgery/paediatrics/O&G/endocrinology/GIM-chronic-disease) to
 * clinicians without the entitlement on transient network blips. Mirrors
 * BUG-444 backend license-middleware fail-OPEN class.
 *
 * Detection (string-pattern; conservative):
 *   1. Walk frontend hook files matching:
 *      - apps/web/src/shared/hooks/*.ts
 *      - apps/web/src/features/**\/hooks/*.ts
 *   2. For files whose name suggests a gating role (use*Visibility,
 *      use*Permission, use*Access, use*Tab, use*Nav, use*Gate,
 *      use*Module, use*Feature, use*Capability):
 *   3. Find every `isError` reference in source.
 *   4. For each, scan a 600-char forward window for the pattern
 *      `() => true` (with optional whitespace).
 *   5. If found AND not inside an `// @fail-open-exempt:` annotation
 *      → REJECT.
 *
 * Allowlist:
 *   - Inline `// @fail-open-exempt: <reason>` (REQUIRES non-empty reason)
 *     directly above the line containing the literal `() => true`.
 *   - File-level fingerprint allowlist for grandfathered baseline.
 *
 * Mutation-resistant testing: `runGuard()` exported.
 *
 * Exit codes:
 *   0 — no fail-OPEN predicates found in gating hooks
 *   1 — one or more fail-OPEN predicates detected
 *   2 — schema-snapshot.json malformed or missing (parity with siblings)
 */

import { readFileSync, readdirSync, statSync } from 'fs';
import { resolve, relative } from 'path';
import {
  loadAllowlist as loadFingerprintAllowlist,
  isAllowlisted as isAllowlistedFingerprint,
  fingerprint as fingerprintLine,
  getAllowlistedCount,
  type AllowlistEntry,
} from './lib/allowlist-fingerprint';

const ROOT = resolve(__dirname, '..', '..');
const DEFAULT_SNAPSHOT_PATH = resolve(ROOT, 'apps', 'api', 'src', 'db', 'schema-snapshot.json');
const DEFAULT_SCAN_ROOTS = [
  resolve(ROOT, 'apps', 'web', 'src', 'shared', 'hooks'),
  resolve(ROOT, 'apps', 'web', 'src', 'features'),
];
const DEFAULT_ALLOWLIST_PATH = resolve(__dirname, 'check-frontend-fail-open-gates.allowlist');

interface SchemaSnapshot {
  generatedAt: string;
  database: string;
  tables: Record<string, string[]>;
}

export interface Violation {
  file: string;
  lineNo: number;
  preview: string;
  reason: string;
}

interface ScanCounts {
  validatedHooks: number;
  skippedNonGatingHooks: number;
  skippedExempt: number;
  filesScanned: number;
}

// Hook names that gate permissions / visibility / access / capabilities.
// Files matching one of these patterns are scanned; others are skipped.
const GATING_HOOK_PATTERNS = [
  /use[A-Z][\w]*Visibility/,
  /use[A-Z][\w]*Permission/,
  /use[A-Z][\w]*Access/,
  /use[A-Z][\w]*Tab/,
  /use[A-Z][\w]*Nav/,
  /use[A-Z][\w]*Gate/,
  /use[A-Z][\w]*Module/,
  /use[A-Z][\w]*Feature/,
  /use[A-Z][\w]*Capability/,
  /use[A-Z][\w]*Authority/,
  /use[A-Z][\w]*Entitlement/,
];

function isGatingHookFile(file: string): boolean {
  // Extract basename without .ts.
  const m = /\/(use[A-Z][\w]+)\.ts$/.exec(file);
  if (!m) return false;
  const hookName = m[1];
  return GATING_HOOK_PATTERNS.some((p) => p.test(hookName));
}

// ── helpers ────────────────────────────────────────────────────────────

function buildLineOffsets(source: string): number[] {
  const offsets = [0];
  for (let i = 0; i < source.length; i++) {
    if (source[i] === '\n') offsets.push(i + 1);
  }
  offsets.push(source.length + 1);
  return offsets;
}

function lineNoOfIndex(lineOffsets: number[], idx: number): number {
  let lo = 0;
  let hi = lineOffsets.length - 2;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (idx >= lineOffsets[mid] && idx < lineOffsets[mid + 1]) return mid + 1;
    if (idx < lineOffsets[mid]) hi = mid - 1;
    else lo = mid + 1;
  }
  return 1;
}

function hasInlineExemption(source: string, lineNo: number, lineOffsets: number[]): boolean {
  if (lineNo < 2) return false;
  const prevLineStart = lineOffsets[lineNo - 2];
  const prevLineEnd = lineOffsets[lineNo - 1];
  const prevLine = source.slice(prevLineStart, prevLineEnd);
  return /@fail-open-exempt:\s*\S/.test(prevLine);
}

// ── file scanner ───────────────────────────────────────────────────────

const FAIL_OPEN_PATTERN = /\(\s*\)\s*=>\s*true\b/g;
const IS_ERROR_WINDOW = 600;

function checkFile(
  file: string,
  source: string,
  allow: AllowlistEntry[],
  counts: ScanCounts,
  violationBuckets: Map<string, number>,
): Violation[] {
  if (!isGatingHookFile(file)) {
    counts.skippedNonGatingHooks++;
    return [];
  }

  const violations: Violation[] = [];
  const relFile = relative(ROOT, file);
  const lineOffsets = buildLineOffsets(source);
  const lines = source.split('\n');
  counts.filesScanned++;

  // For each `() => true` occurrence, check if there's an `isError`
  // reference within IS_ERROR_WINDOW chars BEFORE the occurrence.
  // This is a string-proximity heuristic; AST analysis would be better
  // but is heavier. Strip block + line comments first so prose mentions
  // of `() => true` don't false-fire.
  const sourceWithoutComments = stripCommentsPreservingLayout(source);

  let m: RegExpExecArray | null;
  FAIL_OPEN_PATTERN.lastIndex = 0;
  while ((m = FAIL_OPEN_PATTERN.exec(sourceWithoutComments)) !== null) {
    const idx = m.index;
    const start = Math.max(0, idx - IS_ERROR_WINDOW);
    const window = sourceWithoutComments.slice(start, idx);
    if (!/isError\b/.test(window)) {
      // No isError context — likely a legitimate `() => true` predicate
      // (e.g., default selector, always-include filter). Skip.
      counts.validatedHooks++;
      continue;
    }

    const lineNo = lineNoOfIndex(lineOffsets, idx);
    if (hasInlineExemption(source, lineNo, lineOffsets)) {
      counts.skippedExempt++;
      continue;
    }

    const fullLine = lines[lineNo - 1] || '';
    const preview = fullLine.trim().slice(0, 180);

    if (isAllowlistedFingerprint(relFile, lineNo, fullLine, allow)) {
      const fp = fingerprintLine(fullLine);
      if (fp) {
        const key = `${relFile}|${fp}`;
        violationBuckets.set(key, (violationBuckets.get(key) || 0) + 1);
        const allowed = getAllowlistedCount(relFile, fp, allow);
        if ((violationBuckets.get(key) || 0) > allowed) {
          violations.push({
            file: relFile,
            lineNo,
            preview,
            reason: `over-count: ${violationBuckets.get(key)} occurrences vs ${allowed} allowlisted (fingerprint ${fp})`,
          });
        }
      }
      continue;
    }

    violations.push({
      file: relFile,
      lineNo,
      preview,
      reason: `gating hook returns \`() => true\` predicate within ${IS_ERROR_WINDOW} chars of an \`isError\` reference — fail-OPEN exposes gated UI surfaces on transient network errors (BUG-416 class; CLAUDE.md §6.5)`,
    });
  }

  return violations;
}

function stripCommentsPreservingLayout(source: string): string {
  let out = '';
  let i = 0;
  const n = source.length;
  let inSingle = false;
  let inDouble = false;
  let inTemplate = false;
  while (i < n) {
    const c = source[i];
    const nx = source[i + 1];
    if (!inSingle && !inDouble && !inTemplate && c === '/' && nx === '/') {
      out += '  ';
      i += 2;
      while (i < n && source[i] !== '\n') {
        out += source[i] === '\n' ? '\n' : ' ';
        i++;
      }
      continue;
    }
    if (!inSingle && !inDouble && !inTemplate && c === '/' && nx === '*') {
      out += '  ';
      i += 2;
      while (i < n - 1 && !(source[i] === '*' && source[i + 1] === '/')) {
        out += source[i] === '\n' ? '\n' : ' ';
        i++;
      }
      if (i < n - 1) {
        out += '  ';
        i += 2;
      }
      continue;
    }
    if (!inDouble && !inTemplate && c === "'" && source[i - 1] !== '\\') inSingle = !inSingle;
    else if (!inSingle && !inTemplate && c === '"' && source[i - 1] !== '\\') inDouble = !inDouble;
    else if (!inSingle && !inDouble && c === '`' && source[i - 1] !== '\\') inTemplate = !inTemplate;
    out += c;
    i++;
  }
  return out;
}

// ── runner (exported for tests) ────────────────────────────────────────

export interface RunGuardOpts {
  snapshotPath?: string;
  scanRoots?: string[];
  allowlistPath?: string;
}

export interface RunGuardResult {
  exitCode: 0 | 1 | 2;
  violations: Violation[];
  counts: ScanCounts;
  filesScanned: number;
  allowlistEntries: number;
}

function walkTs(dir: string, out: string[] = []): string[] {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return out;
  }
  for (const entry of entries) {
    const full = resolve(dir, entry);
    const s = statSync(full);
    if (s.isDirectory()) {
      if (entry === 'node_modules' || entry === 'dist' || entry === '__tests__' || entry === 'build') continue;
      walkTs(full, out);
    } else if (
      entry.endsWith('.ts') &&
      !entry.endsWith('.d.ts') &&
      !entry.endsWith('.test.ts') &&
      !entry.endsWith('.spec.ts')
    ) {
      out.push(full);
    }
  }
  return out;
}

export function runGuard(opts: RunGuardOpts = {}): RunGuardResult {
  const snapshotPath = opts.snapshotPath ?? DEFAULT_SNAPSHOT_PATH;
  const scanRoots = opts.scanRoots ?? DEFAULT_SCAN_ROOTS;
  const allowlistPath = opts.allowlistPath ?? DEFAULT_ALLOWLIST_PATH;

  let snapshot: SchemaSnapshot;
  try {
    snapshot = JSON.parse(readFileSync(snapshotPath, 'utf-8'));
  } catch {
    return {
      exitCode: 2,
      violations: [],
      counts: { validatedHooks: 0, skippedNonGatingHooks: 0, skippedExempt: 0, filesScanned: 0 },
      filesScanned: 0,
      allowlistEntries: 0,
    };
  }
  if (!snapshot.tables || Object.keys(snapshot.tables).length === 0) {
    return {
      exitCode: 2,
      violations: [],
      counts: { validatedHooks: 0, skippedNonGatingHooks: 0, skippedExempt: 0, filesScanned: 0 },
      filesScanned: 0,
      allowlistEntries: 0,
    };
  }

  const allow = loadFingerprintAllowlist(allowlistPath);
  const files: string[] = [];
  for (const root of scanRoots) walkTs(root, files);
  const counts: ScanCounts = {
    validatedHooks: 0,
    skippedNonGatingHooks: 0,
    skippedExempt: 0,
    filesScanned: 0,
  };
  const violationBuckets = new Map<string, number>();
  const allViolations: Violation[] = [];

  for (const file of files) {
    const source = readFileSync(file, 'utf-8');
    const v = checkFile(file, source, allow, counts, violationBuckets);
    allViolations.push(...v);
  }

  return {
    exitCode: allViolations.length > 0 ? 1 : 0,
    violations: allViolations,
    counts,
    filesScanned: counts.filesScanned,
    allowlistEntries: allow.length,
  };
}

// ── CLI entry ──────────────────────────────────────────────────────────

function main(): void {
  const result = runGuard();
  // eslint-disable-next-line no-console
  console.log('→ check-frontend-fail-open-gates (PR-R1-20; CLAUDE.md §6.5)');
  // eslint-disable-next-line no-console
  console.log(`  allowlist:          ${relative(ROOT, DEFAULT_ALLOWLIST_PATH)} (${result.allowlistEntries} entries)`);
  // eslint-disable-next-line no-console
  console.log(`  gating hooks:       ${result.counts.filesScanned}`);
  // eslint-disable-next-line no-console
  console.log(`  skipped non-gating: ${result.counts.skippedNonGatingHooks}`);

  if (result.exitCode === 2) {
    // eslint-disable-next-line no-console
    console.error(`✗ schema-snapshot.json read failed or empty.`);
    process.exit(2);
  }

  // eslint-disable-next-line no-console
  console.log(`\n  validated permissive predicates (no isError context): ${result.counts.validatedHooks}`);
  // eslint-disable-next-line no-console
  console.log(`  skipped exempt:                              ${result.counts.skippedExempt}`);

  if (result.violations.length === 0) {
    // eslint-disable-next-line no-console
    console.log('\n✓ No fail-OPEN predicates in gating hooks.');
    process.exit(0);
  }

  // eslint-disable-next-line no-console
  console.error(`\n✗ ${result.violations.length} fail-OPEN predicate(s) detected:\n`);
  for (const v of result.violations) {
    // eslint-disable-next-line no-console
    console.error(`  ${v.file}:${v.lineNo}`);
    // eslint-disable-next-line no-console
    console.error(`    reason: ${v.reason}`);
    // eslint-disable-next-line no-console
    console.error(`    preview: ${v.preview}`);
  }
  // eslint-disable-next-line no-console
  console.error(
    '\nFix shape: replace `() => true` on the isError branch with the canonical fail-CLOSED predicate (e.g., `failClosed()` returning empty-set state). Sibling pattern: `apps/web/src/shared/hooks/useModuleVisibility.ts` post-BUG-416 fix delegates to `isPatientTabVisible(_, emptySet)` / `isNavItemVisible(_, emptySet)`. If the predicate is intentionally permissive (rare — e.g., a non-gated read-only widget), add `// @fail-open-exempt: <reason>` directly above the line.',
  );
  process.exit(1);
}

if (require.main === module) main();
