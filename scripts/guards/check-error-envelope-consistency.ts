/**
 * PR-R1-21 (re-scoped) — CI guard: 4xx/5xx error responses MUST go through
 * `next(new AppError(...))` (CLAUDE.md §3.4) rather than inline
 * `res.status(4xx).json(...)`.
 *
 * Why this exists — CLAUDE.md §3.4 mandates the two-rail discipline:
 * services return `Result<T, AppError>` for expected failures; routes
 * narrow via `isErr(r)` and call `next(r.error)`. The global error
 * middleware in `apps/api/src/shared/errors.ts` formats AppError into
 * the canonical wire shape `{ error: { message, code, details? } }`.
 *
 * Inline `res.status(4xx).json(...)` patterns bypass the canonical
 * envelope, producing inconsistent shapes:
 *   - some routes: `{ error: 'Validation failed', code: 'X', details: ... }`
 *   - others:      `{ error: 'Not found' }`
 *   - others:      `{ message: '...' }`
 * Frontend consumers can't depend on a single error contract; tests
 * become brittle; Sentry / observability dashboards aggregate badly.
 *
 * The original PR-R1-21 plan-doc framing was "Response Zod parse
 * mandate enforcement" — but that's already covered by BUG-638's
 * `check-response-shape-validated.ts` guard. Re-scoped per the
 * re-scope rule to the highest-leverage related discipline gap:
 * error-envelope consistency.
 *
 * Detection:
 *   1. Walk every `apps/api/src/features/**\/*.ts` file
 *   2. Find every `res.status(<4xx-or-5xx>)` chain followed by `.json(`
 *   3. REJECT — route should `return next(new AppError(...))` instead
 *   4. Skip non-error status codes (1xx/2xx/3xx)
 *   5. Inline `// @error-envelope-exempt: <reason>` opt-out for
 *      legitimate cases (e.g., ENV-DRIVEN custom error formats for
 *      external integration partners)
 *
 * Allowlist:
 *   - Inline `// @error-envelope-exempt: <reason>` (REQUIRES non-empty
 *     reason)
 *   - File-level fingerprint allowlist for grandfathered baseline
 *
 * Mutation-resistant testing: `runGuard()` exported.
 *
 * Exit codes:
 *   0 — every error response uses next(AppError)
 *   1 — one or more inline error responses
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
  walkTsFiles,
} from './lib/guardRuntime';

const ROOT = resolve(__dirname, '..', '..');
const DEFAULT_SNAPSHOT_PATH = resolve(ROOT, 'apps', 'api', 'src', 'db', 'schema-snapshot.json');
const DEFAULT_SCAN_ROOT = resolve(ROOT, 'apps', 'api', 'src', 'features');
const DEFAULT_ALLOWLIST_PATH = resolve(__dirname, 'check-error-envelope-consistency.allowlist');

export interface Violation {
  file: string;
  lineNo: number;
  status: number;
  preview: string;
}

interface ScanCounts {
  validatedOkResponses: number;
  skippedExempt: number;
  filesScanned: number;
}

function hasInlineExemption(source: string, lineNo: number, lineOffsets: number[]): boolean {
  return hasInlineExemptionOnPreviousLine(source, lineNo, lineOffsets, /@error-envelope-exempt:\s*\S/);
}

// Match `res.status(<NNN>).json(` where NNN is 400-599 (4xx or 5xx).
// Captures the status code in group 1.
const ERROR_RESPONSE_RE = /\bres\.status\s*\(\s*([45]\d{2})\s*\)\s*\.\s*json\s*\(/g;

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
  counts.filesScanned++;

  let m: RegExpExecArray | null;
  ERROR_RESPONSE_RE.lastIndex = 0;
  while ((m = ERROR_RESPONSE_RE.exec(source)) !== null) {
    const status = parseInt(m[1], 10);
    const lineNo = lineNoOfIndex(lineOffsets, m.index);

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
            status,
            preview,
          });
        }
      }
      continue;
    }

    violations.push({
      file: relFile,
      lineNo,
      status,
      preview,
    });
  }

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
      counts: { validatedOkResponses: 0, skippedExempt: 0, filesScanned: 0 },
      filesScanned: 0,
      allowlistEntries: 0,
    };
  }

  const allow = loadFingerprintAllowlist(allowlistPath);
  const files = walkTsFiles(scanRoot, [], {
    excludeDirs: ['node_modules', 'dist', '__tests__'],
  });
  const counts: ScanCounts = {
    validatedOkResponses: 0,
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
  console.log('→ check-error-envelope-consistency (PR-R1-21; CLAUDE.md §3.4)');
  // eslint-disable-next-line no-console
  console.log(`  scan root:          ${relative(ROOT, DEFAULT_SCAN_ROOT)}`);
  // eslint-disable-next-line no-console
  console.log(`  allowlist:          ${relative(ROOT, DEFAULT_ALLOWLIST_PATH)} (${result.allowlistEntries} entries)`);
  // eslint-disable-next-line no-console
  console.log(`  files scanned:      ${result.counts.filesScanned}`);

  if (result.exitCode === 2) {
    // eslint-disable-next-line no-console
    console.error(`✗ schema-snapshot.json read failed or empty.`);
    process.exit(2);
  }

  // eslint-disable-next-line no-console
  console.log(`\n  skipped exempt:     ${result.counts.skippedExempt}`);

  if (result.violations.length === 0) {
    // eslint-disable-next-line no-console
    console.log('\n✓ Every error response uses next(AppError) — no inline 4xx/5xx res.json.');
    process.exit(0);
  }

  // eslint-disable-next-line no-console
  console.error(`\n✗ ${result.violations.length} inline error response(s) detected:\n`);
  for (const v of result.violations) {
    // eslint-disable-next-line no-console
    console.error(`  ${v.file}:${v.lineNo}  res.status(${v.status}).json(...)`);
    // eslint-disable-next-line no-console
    console.error(`    preview: ${v.preview}`);
  }
  // eslint-disable-next-line no-console
  console.error(
    '\nFix shape: replace `res.status(<NNN>).json({...})` with `return next(new AppError(<message>, <NNN>, <code>))` so the global error middleware in apps/api/src/shared/errors.ts formats the canonical envelope `{ error: { message, code, details? } }`. If the inline shape is INTENTIONAL (rare — vendor-protocol custom error format / external partner contract), add `// @error-envelope-exempt: <reason>` directly above the line.',
  );
  process.exit(1);
}

if (require.main === module) main();
