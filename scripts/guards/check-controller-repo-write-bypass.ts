/**
 * PR-R1-19 (re-scoped) — CI guard: Routes/Controller files MUST NOT call
 * write-mutator repository methods directly. Writes go through the
 * service layer where AuthContext-based authorization gates live
 * (CLAUDE.md §13 layered architecture).
 *
 * Why this exists — `req.user.id` vs `staffId` discipline (the original
 * PR-R1-19 plan-doc concern) is a non-issue: req.user has no `staffId`
 * field; req.user.id IS the staff ID. The actual related discipline
 * gap is the layered-architecture violation: a controller calling
 * `xRepository.update(clinicId, id, ...)` directly bypasses
 * `xService.update(auth, ...)` which does `requirePermission` /
 * `requirePatientRelationship` / specialty checks. The controller
 * effectively grants every authenticated user write access regardless
 * of role — RLS is the only remaining defence.
 *
 * Detection (per-file):
 *   1. Walk every routes/controller surface in `apps/api/src/features`:
 *      `*Routes.ts` / `*.routes.ts` / `*Controller.ts` / `*.controller.ts`.
 *   2. Find every call shape `<x>Repository.<method>(...)` /
 *      `<x>Repo.<method>(...)` where method is one of the WRITE
 *      mutators: update / insert / upsert / delete / del / softDelete
 *      / hardDelete / create / createX / updateX (X = any suffix).
 *   3. REJECT.
 *
 * SELECT methods (find / get / list / count / search) are fine to
 * call from controllers — they don't mutate state. Only the WRITE
 * side requires going through the service.
 *
 * Allowlist:
 *   - Inline `// @repo-write-bypass-exempt: <reason>` (REQUIRES non-empty
 *     reason) directly above the call (rare — typically when the
 *     "service" wrapper would add no authz value because the operation
 *     is implicitly admin-scoped, e.g., system-job DI seeding).
 *   - File-level fingerprint allowlist for grandfathered baseline.
 *
 * Mutation-resistant testing: `runGuard()` exported.
 *
 * Exit codes:
 *   0 — every controller-side write goes through a service
 *   1 — one or more direct repo-write calls in controller files
 *   2 — schema-snapshot.json malformed or missing (parity with siblings)
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
import { matchesMethodPrefix } from './lib/methodNameClassifier';

const ROOT = resolve(__dirname, '..', '..');
const DEFAULT_SNAPSHOT_PATH = resolve(ROOT, 'apps', 'api', 'src', 'db', 'schema-snapshot.json');
const DEFAULT_SCAN_ROOT = resolve(ROOT, 'apps', 'api', 'src', 'features');
const DEFAULT_ALLOWLIST_PATH = resolve(__dirname, 'check-controller-repo-write-bypass.allowlist');

export interface Violation {
  file: string;
  lineNo: number;
  repoIdent: string;
  method: string;
  preview: string;
}

interface ScanCounts {
  validatedReadCalls: number;
  filesScanned: number;
  skippedExempt: number;
}

// Method-name patterns that indicate a WRITE mutation. The regex below
// captures these prefixes; exact-match checks happen on extracted method.
const WRITE_METHOD_PREFIXES = [
  'create', 'insert', 'update', 'upsert', 'delete', 'del', 'soft', 'hard',
  'archive', 'restore', 'transition', 'flag', 'unflag', 'lock', 'unlock',
  'approve', 'reject', 'sign', 'amend', 'revoke', 'cancel', 'cease',
  'remove', 'add', 'set', 'apply', 'patch', 'replace', 'increment',
  'decrement', 'enable', 'disable',
];

function isWriteMethod(name: string): boolean {
  return matchesMethodPrefix(name, WRITE_METHOD_PREFIXES, {
    allowUnderscoreBoundary: true,
  });
}

// ── helpers (sibling of PR-R1-13/14/15/16/17/18) ──────────────────────

function hasInlineExemption(source: string, lineNo: number, lineOffsets: number[]): boolean {
  return hasInlineExemptionOnPreviousLine(source, lineNo, lineOffsets, /@repo-write-bypass-exempt:\s*\S/);
}

function isControllerFile(file: string): boolean {
  // Match Routes.ts, Controller.ts, or controller.ts (case-sensitive on
  // 'C'/'R' to match the codebase convention). Not feature-folder
  // services / repositories / mappers / hooks.
  return /\/(?:[\w-]+Routes\.ts|[\w-]+\.routes\.ts|[\w-]+(?:[Cc]ontroller)\.ts|[\w-]+\.controller\.ts)$/.test(file);
}

// ── file scanner ───────────────────────────────────────────────────────

function checkFile(
  file: string,
  source: string,
  allow: AllowlistEntry[],
  counts: ScanCounts,
  violationBuckets: Map<string, number>,
): Violation[] {
  if (!isControllerFile(file)) return [];

  const violations: Violation[] = [];
  const relFile = relative(ROOT, file);
  const lineOffsets = buildLineOffsets(source);
  const lines = source.split('\n');
  counts.filesScanned++;

  // Match: <repoIdent>Repository.<method>( OR <repoIdent>Repo.<method>(
  // The repoIdent is captured (e.g., 'pathwayRepository' / 'appointmentRepo').
  const callRe = /\b([\w$]+(?:Repository|Repo))\.([\w$]+)\s*\(/g;
  let m: RegExpExecArray | null;
  while ((m = callRe.exec(source)) !== null) {
    const repoIdent = m[1];
    const method = m[2];

    if (!isWriteMethod(method)) {
      counts.validatedReadCalls++;
      continue;
    }

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
            repoIdent,
            method,
            preview,
          });
        }
      }
      continue;
    }

    violations.push({
      file: relFile,
      lineNo,
      repoIdent,
      method,
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
      counts: { validatedReadCalls: 0, filesScanned: 0, skippedExempt: 0 },
      filesScanned: 0,
      allowlistEntries: 0,
    };
  }

  const allow = loadFingerprintAllowlist(allowlistPath);
  const files = walkTsFiles(scanRoot, [], {
    excludeDirs: ['node_modules', 'dist', '__tests__'],
  });
  const counts: ScanCounts = {
    validatedReadCalls: 0,
    filesScanned: 0,
    skippedExempt: 0,
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
  console.log('→ check-controller-repo-write-bypass (PR-R1-19; CLAUDE.md §13)');
  // eslint-disable-next-line no-console
  console.log(`  scan root:          ${relative(ROOT, DEFAULT_SCAN_ROOT)}`);
  // eslint-disable-next-line no-console
  console.log(`  allowlist:          ${relative(ROOT, DEFAULT_ALLOWLIST_PATH)} (${result.allowlistEntries} entries)`);
  // eslint-disable-next-line no-console
  console.log(`  controller files:   ${result.counts.filesScanned}`);

  if (result.exitCode === 2) {
    // eslint-disable-next-line no-console
    console.error(`✗ schema-snapshot.json read failed or empty.`);
    process.exit(2);
  }

  // eslint-disable-next-line no-console
  console.log(`\n  validated read calls: ${result.counts.validatedReadCalls}`);
  // eslint-disable-next-line no-console
  console.log(`  skipped exempt:       ${result.counts.skippedExempt}`);

  if (result.violations.length === 0) {
    // eslint-disable-next-line no-console
    console.log('\n✓ No controller-side direct repo write calls found.');
    process.exit(0);
  }

  // eslint-disable-next-line no-console
  console.error(`\n✗ ${result.violations.length} controller-side direct repo write(s) detected:\n`);
  for (const v of result.violations) {
    // eslint-disable-next-line no-console
    console.error(`  ${v.file}:${v.lineNo}  ${v.repoIdent}.${v.method}(...)`);
    // eslint-disable-next-line no-console
    console.error(`    preview: ${v.preview}`);
  }
  // eslint-disable-next-line no-console
  console.error(
    '\nFix shape: refactor the repository write call into a service method that accepts `auth: AuthContext` (CLAUDE.md §13). The service does `requirePermission(auth, ...)` / `requirePatientRelationship(auth, ...)` / specialty checks before delegating to the repository. The controller then calls `<feature>Service.<method>(buildAuthContext(req), ...)`. If the operation is genuinely admin-only / system-job (rare), add `// @repo-write-bypass-exempt: <reason>` directly above the call.',
  );
  process.exit(1);
}

if (require.main === module) main();
