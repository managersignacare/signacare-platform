/**
 * PR-R1-22 (re-scoped) — CI guard: every `useMutation({...})` call MUST
 * include an `invalidateQueries(...)` call (or equivalent) in its body
 * (CLAUDE.md §4.3 — closes the "data saves but doesn't appear" class).
 *
 * Why this exists — fix-registry MEDS1-10 tracked 10 individual
 * query-key / invalidation mismatch bugs. Each was a clinician saying
 * "I saved this, it didn't appear until I refreshed." The existing
 * `check-query-key-factories.sh` enforces FACTORY usage (no literal
 * `[...]` arrays). PR-R1-22 closes the related gap: a mutation that
 * never invalidates ANY key — UI never refreshes after save.
 *
 * Original PR-R1-22 plan-doc framing was "Mutation invalidation key
 * bidirectional match" — but that's largely covered by existing
 * factory rule + TypeScript (undefined factory methods caught at
 * compile time). Re-scoped per the re-scope rule to the highest-
 * leverage related gap: missing-invalidation entirely.
 *
 * Detection (per useMutation call body):
 *   1. Walk apps/web/src/**\/*.{ts,tsx} files
 *   2. Find every `useMutation({` opener
 *   3. Walk balanced braces to find the body end
 *   4. Body MUST contain at least one of:
 *      - `invalidateQueries(...)`
 *      - `setQueryData(...)` (manual optimistic update)
 *      - `removeQueries(...)`
 *      - `refetchQueries(...)`
 *      - `resetQueries(...)`
 *      - `cancelQueries(...)`
 *   5. If none → REJECT.
 *
 * Allowlist:
 *   - Inline `// @no-invalidate-needed: <reason>` (REQUIRES non-empty
 *     reason) directly above `useMutation({`. Common cases: mutation
 *     triggers navigation that re-mounts queries; mutation is purely
 *     side-effect (analytics tracking) with no consumer-visible state.
 *   - File-level fingerprint allowlist for grandfathered baseline.
 *
 * Mutation-resistant testing: `runGuard()` exported.
 *
 * Exit codes:
 *   0 — every useMutation has an invalidate-class call
 *   1 — one or more mutations missing invalidation
 *   2 — schema-snapshot.json malformed or missing
 */

import { readFileSync } from 'fs';
import { resolve, relative } from 'path';
import {
  loadAllowlist as loadFingerprintAllowlist,
  isAllowlisted as isAllowlistedFingerprint,
  fingerprint as fingerprintLine,
  getAllowlistedCount,
  type AllowlistEntry,
} from './lib/allowlist-fingerprint';
import {
  buildLineOffsets,
  lineNoOfIndex,
  hasInlineExemptionOnPreviousLine,
  hasUsableSchemaSnapshot,
  walkSourceFiles,
} from './lib/guardRuntime';

const ROOT = resolve(__dirname, '..', '..');
const DEFAULT_SNAPSHOT_PATH = resolve(ROOT, 'apps', 'api', 'src', 'db', 'schema-snapshot.json');
const DEFAULT_SCAN_ROOT = resolve(ROOT, 'apps', 'web', 'src');
const DEFAULT_ALLOWLIST_PATH = resolve(__dirname, 'check-mutation-invalidation.allowlist');

export interface Violation {
  file: string;
  lineNo: number;
  preview: string;
}

interface ScanCounts {
  validatedMutations: number;
  skippedExempt: number;
  filesScanned: number;
}

function hasInlineExemption(source: string, lineNo: number, lineOffsets: number[]): boolean {
  return hasInlineExemptionOnPreviousLine(source, lineNo, lineOffsets, /@no-invalidate-needed:\s*\S/);
}

const INVALIDATE_PATTERN = /\b(?:invalidateQueries|setQueryData|removeQueries|refetchQueries|resetQueries|cancelQueries)\s*\(/;

/**
 * Find the body of a `useMutation({...})` call. Walks balanced braces.
 */
function extractMutationBody(source: string, startIdx: number): { body: string; bodyEnd: number } | null {
  // startIdx points at `useMutation`. Find the `{` opener.
  const openMatch = /useMutation\s*[<(][^{]*\{/.exec(source.slice(startIdx, startIdx + 200));
  if (!openMatch) {
    // Maybe simpler form: useMutation({  (no generic)
    const simple = /useMutation\s*\(\s*\{/.exec(source.slice(startIdx, startIdx + 80));
    if (!simple) return null;
    const bodyStart = startIdx + simple.index + simple[0].length;
    return walkBalancedBraces(source, bodyStart);
  }
  const bodyStart = startIdx + openMatch.index + openMatch[0].length;
  return walkBalancedBraces(source, bodyStart);
}

function walkBalancedBraces(source: string, bodyStart: number): { body: string; bodyEnd: number } | null {
  let braceDepth = 1;
  let i = bodyStart;
  while (i < source.length && braceDepth > 0) {
    const c = source[i];
    if (c === '{') braceDepth++;
    else if (c === '}') braceDepth--;
    i++;
  }
  if (braceDepth !== 0) return null;
  return { body: source.slice(bodyStart, i - 1), bodyEnd: i - 1 };
}

// ── file scanner ───────────────────────────────────────────────────────

function checkFile(
  file: string,
  source: string,
  allow: AllowlistEntry[],
  counts: ScanCounts,
  violationBuckets: Map<string, number>,
): Violation[] {
  const violations: Violation[] = [];
  const relFile = relative(ROOT, file);
  const lineOffsets = buildLineOffsets(source);
  const lines = source.split('\n');

  // Find every `useMutation` opener.
  const re = /\buseMutation\s*[<(]/g;
  let m: RegExpExecArray | null;
  let foundAny = false;
  while ((m = re.exec(source)) !== null) {
    foundAny = true;
    const block = extractMutationBody(source, m.index);
    if (!block) continue;

    const lineNo = lineNoOfIndex(lineOffsets, m.index);
    if (hasInlineExemption(source, lineNo, lineOffsets)) {
      counts.skippedExempt++;
      continue;
    }

    if (INVALIDATE_PATTERN.test(block.body)) {
      counts.validatedMutations++;
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
          });
        }
      }
      continue;
    }

    violations.push({
      file: relFile,
      lineNo,
      preview,
    });
  }
  if (foundAny) counts.filesScanned++;
  return violations;
}

// ── runner (exported for tests) ────────────────────────────────────────

export interface RunGuardOpts {
  snapshotPath?: string;
  scanRoot?: string;
  allowlistPath?: string;
}

export interface RunGuardResult {
  exitCode: 0 | 1 | 2;
  violations: Violation[];
  counts: ScanCounts;
  filesScanned: number;
  allowlistEntries: number;
}

export function runGuard(opts: RunGuardOpts = {}): RunGuardResult {
  const snapshotPath = opts.snapshotPath ?? DEFAULT_SNAPSHOT_PATH;
  const scanRoot = opts.scanRoot ?? DEFAULT_SCAN_ROOT;
  const allowlistPath = opts.allowlistPath ?? DEFAULT_ALLOWLIST_PATH;

  if (!hasUsableSchemaSnapshot(snapshotPath)) {
    return {
      exitCode: 2,
      violations: [],
      counts: { validatedMutations: 0, skippedExempt: 0, filesScanned: 0 },
      filesScanned: 0,
      allowlistEntries: 0,
    };
  }

  const allow = loadFingerprintAllowlist(allowlistPath);
  const files = walkSourceFiles(scanRoot, [], {
    excludeDirs: ['node_modules', 'dist', '__tests__', 'build'],
    extensions: ['.ts', '.tsx'],
    excludeSuffixes: ['.d.ts', '.test.ts', '.test.tsx', '.spec.ts', '.spec.tsx'],
  });
  const counts: ScanCounts = {
    validatedMutations: 0,
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
  console.log('→ check-mutation-invalidation (PR-R1-22; CLAUDE.md §4.3)');
  // eslint-disable-next-line no-console
  console.log(`  scan root:           ${relative(ROOT, DEFAULT_SCAN_ROOT)}`);
  // eslint-disable-next-line no-console
  console.log(`  allowlist:           ${relative(ROOT, DEFAULT_ALLOWLIST_PATH)} (${result.allowlistEntries} entries)`);
  // eslint-disable-next-line no-console
  console.log(`  files with mutations: ${result.counts.filesScanned}`);

  if (result.exitCode === 2) {
    // eslint-disable-next-line no-console
    console.error(`✗ schema-snapshot.json read failed or empty.`);
    process.exit(2);
  }

  // eslint-disable-next-line no-console
  console.log(`\n  validated mutations: ${result.counts.validatedMutations}`);
  // eslint-disable-next-line no-console
  console.log(`  skipped exempt:      ${result.counts.skippedExempt}`);

  if (result.violations.length === 0) {
    // eslint-disable-next-line no-console
    console.log('\n✓ Every useMutation has an invalidate-class call.');
    process.exit(0);
  }

  // eslint-disable-next-line no-console
  console.error(`\n✗ ${result.violations.length} mutation(s) missing invalidation:\n`);
  for (const v of result.violations) {
    // eslint-disable-next-line no-console
    console.error(`  ${v.file}:${v.lineNo}`);
    // eslint-disable-next-line no-console
    console.error(`    preview: ${v.preview}`);
  }
  // eslint-disable-next-line no-console
  console.error(
    '\nFix shape: add `onSuccess: () => qc.invalidateQueries({ queryKey: <factory>.<method>(...) })` to the useMutation body. Use a query-key factory (queryKeys.ts) — never a literal array. If the mutation genuinely does NOT need to invalidate (rare — pure side-effect like analytics tracking, or follows navigation that re-mounts queries), add `// @no-invalidate-needed: <reason>` directly above the useMutation call.',
  );
  process.exit(1);
}

if (require.main === module) main();
