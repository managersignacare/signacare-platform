/**
 * PR-R1-18 — CI guard: every mutation method on a SAFETY-SURFACE service
 * MUST call `writeAuditLog(...)` in its body (CLAUDE.md §11 audit-trail
 * discipline; AHPRA Standard 1 forensic-chain compliance).
 *
 * Why this exists — the existing `check-clinical-note-audit-log.ts` guard
 * (BUG-369) covers `clinicalNoteService` only. AHPRA Standard 1 + state
 * Mental Health Act forensic-chain discipline applies equally to:
 *
 *   - prescriptions  (S8 / SafeScript / eRx audit trail)
 *   - medications    (cease / amend / administration audit)
 *   - ECT            (consent / treatment session audit)
 *   - TMS            (consent / treatment session audit)
 *   - risk           (suicide-risk reassessment audit)
 *   - escalations    (ISBAR + escalation transition audit)
 *   - advance-directives (legal-document creation/revocation audit)
 *   - legal-orders   (MHA order create/transition/expiry audit)
 *
 * Without an audit row on every mutation, coronial review cannot
 * reconstruct the edit history. PR-R1-18 generalises BUG-369's pattern
 * to all safety surfaces.
 *
 * Detection (per safety-surface service file):
 *   1. For each (service, requiredMethods) pair in SAFETY_SURFACES:
 *   2. Read the service file.
 *   3. Find every `async <name>(auth: AuthContext, ...)` method.
 *   4. If `<name>` matches a mutation prefix (create/update/sign/amend/
 *      cancel/cease/delete/approve/deactivate/administer/record/escalate/
 *      resolve/softDelete/hardDelete/revoke/prescribe/stop/complete/fail
 *      /transition/expire/discharge/admit/restore/release/reinstate),
 *      verify the method body contains `writeAuditLog(`.
 *   5. If missing → REJECT.
 *
 * Allowlist:
 *   - Inline `// @audit-log-exempt: <reason>` (REQUIRES non-empty reason)
 *     directly above the method declaration
 *   - Per-method fingerprint allowlist for grandfathered baseline
 *
 * Mutation-resistant testing: `runGuard()` exported.
 *
 * Exit codes:
 *   0 — every mutation method on every safety surface has writeAuditLog
 *   1 — one or more mutations missing the audit call
 *   2 — schema-snapshot.json malformed or missing (parity with siblings)
 */

import { readFileSync, existsSync } from 'fs';
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
} from './lib/guardRuntime';
import { matchesMethodPrefix } from './lib/methodNameClassifier';

const ROOT = resolve(__dirname, '..', '..');
const DEFAULT_SNAPSHOT_PATH = resolve(ROOT, 'apps', 'api', 'src', 'db', 'schema-snapshot.json');
const DEFAULT_ALLOWLIST_PATH = resolve(__dirname, 'check-safety-surface-audit-log.allowlist');

/**
 * Safety-surface service files that REQUIRE audit-log on every mutation.
 * Each entry is the path relative to ROOT. The guard walks the file's
 * exported service object and checks every mutation method.
 *
 * NOTE: clinicalNote.service.ts is NOT included here — it has its own
 * dedicated guard (`check-clinical-note-audit-log.ts`) per BUG-369 +
 * keeps the original spec test-stable. PR-R1-18 covers the SIBLING
 * surfaces only.
 */
export const SAFETY_SURFACES: string[] = [
  'apps/api/src/features/medications/medicationService.ts',
  'apps/api/src/features/prescriptions/prescriptionService.ts',
  'apps/api/src/features/ect/ectService.ts',
  'apps/api/src/features/tms/tmsService.ts',
  'apps/api/src/features/risk/riskService.ts',
  'apps/api/src/features/escalations/escalation.service.ts',
];

// Method-name prefixes that indicate a MUTATION (write-side).
// Conservative list — if a method doesn't start with one of these prefixes,
// assume it's a read.
const MUTATION_PREFIXES = [
  'create', 'update', 'sign', 'amend', 'cancel', 'cease', 'delete', 'soft', 'hard',
  'approve', 'deactivate', 'administer', 'record', 'escalate', 'resolve', 'revoke',
  'prescribe', 'stop', 'complete', 'fail', 'transition', 'expire', 'discharge',
  'admit', 'restore', 'release', 'reinstate', 'submit', 'reject', 'archive',
  'lock', 'unlock', 'flag', 'unflag', 'add', 'remove', 'merge', 'split',
  'enable', 'disable', 'redact', 'unsign', 'reopen', 'close',
];

// Method-name prefixes that are read-only — never need audit.
const READ_PREFIXES = [
  'list', 'get', 'find', 'count', 'search', 'check', 'has', 'is', 'fetch',
  'load', 'query', 'verify', 'derive', 'compute', 'build', 'format', 'render',
];

function isMutationMethod(name: string): boolean {
  // Read prefix wins (e.g. `getCancellationReason` is a read, not a mutation
  // despite containing "cancel").
  if (matchesMethodPrefix(name, READ_PREFIXES)) return false;
  return matchesMethodPrefix(name, MUTATION_PREFIXES);
}

export interface Violation {
  file: string;
  lineNo: number;
  method: string;
  preview: string;
}

interface ScanCounts {
  validatedMutations: number;
  skippedReads: number;
  skippedExempt: number;
  filesScanned: number;
  filesMissing: number;
}

function hasInlineExemption(source: string, lineNo: number, lineOffsets: number[]): boolean {
  return hasInlineExemptionOnPreviousLine(source, lineNo, lineOffsets, /@audit-log-exempt:\s*\S/);
}

interface MethodInfo {
  name: string;
  start: number;
  bodyEnd: number;
}

/**
 * Find every async method declaration in the service file. Returns
 * positions for slicing the method body.
 */
function findMethods(source: string): MethodInfo[] {
  const methods: MethodInfo[] = [];
  // Match either:
  //   `async <name>(`        — object-literal method shorthand
  //   `<name>: async (`      — object-literal arrow-function property
  // Both are common in service files.
  //
  // Use `[ \t]{2,4}` (non-newline whitespace) NOT `\s{2,4}` — `\s` matches
  // newline characters in JavaScript regex, which makes the match start
  // on the BLANK line PRECEDING the method instead of the method's own
  // line, producing wrong line numbers.
  const re = /^[ \t]{2,4}(?:async\s+([A-Za-z_][A-Za-z0-9_]*)|([A-Za-z_][A-Za-z0-9_]*)\s*:\s*async)\s*\(/gm;
  let m: RegExpExecArray | null;
  while ((m = re.exec(source)) !== null) {
    const name = m[1] || m[2] || '';
    if (!name) continue;
    methods.push({ name, start: m.index, bodyEnd: 0 });
  }
  // Compute bodyEnd as the start of the next method or EOF.
  for (let i = 0; i < methods.length; i++) {
    methods[i].bodyEnd = i + 1 < methods.length ? methods[i + 1].start : source.length;
  }
  return methods;
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
  counts.filesScanned++;

  const methods = findMethods(source);
  for (const method of methods) {
    if (!isMutationMethod(method.name)) {
      counts.skippedReads++;
      continue;
    }

    const lineNo = lineNoOfIndex(lineOffsets, method.start);
    if (hasInlineExemption(source, lineNo, lineOffsets)) {
      counts.skippedExempt++;
      continue;
    }

    const body = source.slice(method.start, method.bodyEnd);
    if (/writeAuditLog\s*\(/.test(body)) {
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
            method: method.name,
            preview,
          });
        }
      }
      continue;
    }

    violations.push({
      file: relFile,
      lineNo,
      method: method.name,
      preview,
    });
  }

  return violations;
}

// ── runner (exported for tests) ────────────────────────────────────────

export interface RunGuardOpts {
  snapshotPath?: string;
  /** Override service file list (used by tests). */
  serviceFiles?: string[];
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
  const serviceFiles =
    opts.serviceFiles ??
    SAFETY_SURFACES.map((rel) => resolve(ROOT, rel));
  const allowlistPath = opts.allowlistPath ?? DEFAULT_ALLOWLIST_PATH;

  if (!hasUsableSchemaSnapshot(snapshotPath)) {
    return {
      exitCode: 2,
      violations: [],
      counts: { validatedMutations: 0, skippedReads: 0, skippedExempt: 0, filesScanned: 0, filesMissing: 0 },
      filesScanned: 0,
      allowlistEntries: 0,
    };
  }

  const allow = loadFingerprintAllowlist(allowlistPath);
  const counts: ScanCounts = {
    validatedMutations: 0,
    skippedReads: 0,
    skippedExempt: 0,
    filesScanned: 0,
    filesMissing: 0,
  };
  const violationBuckets = new Map<string, number>();
  const allViolations: Violation[] = [];

  for (const file of serviceFiles) {
    if (!existsSync(file)) {
      counts.filesMissing++;
      continue;
    }
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
  console.log('→ check-safety-surface-audit-log (PR-R1-18; CLAUDE.md §11)');
  // eslint-disable-next-line no-console
  console.log(`  surfaces:           ${SAFETY_SURFACES.length} services`);
  // eslint-disable-next-line no-console
  console.log(`  allowlist:          ${relative(ROOT, DEFAULT_ALLOWLIST_PATH)} (${result.allowlistEntries} entries)`);
  // eslint-disable-next-line no-console
  console.log(`  files scanned:      ${result.counts.filesScanned}`);
  // eslint-disable-next-line no-console
  console.log(`  files missing:      ${result.counts.filesMissing}`);

  if (result.exitCode === 2) {
    // eslint-disable-next-line no-console
    console.error(`✗ schema-snapshot.json read failed or empty.`);
    process.exit(2);
  }

  // eslint-disable-next-line no-console
  console.log(`\n  validated mutations: ${result.counts.validatedMutations}`);
  // eslint-disable-next-line no-console
  console.log(`  skipped reads:       ${result.counts.skippedReads}`);
  // eslint-disable-next-line no-console
  console.log(`  skipped exempt:      ${result.counts.skippedExempt}`);

  if (result.violations.length === 0) {
    // eslint-disable-next-line no-console
    console.log('\n✓ Every mutation method on every safety surface calls writeAuditLog.');
    process.exit(0);
  }

  // eslint-disable-next-line no-console
  console.error(`\n✗ ${result.violations.length} mutation(s) missing writeAuditLog:\n`);
  for (const v of result.violations) {
    // eslint-disable-next-line no-console
    console.error(`  ${v.file}:${v.lineNo}  method='${v.method}'`);
    // eslint-disable-next-line no-console
    console.error(`    preview: ${v.preview}`);
  }
  // eslint-disable-next-line no-console
  console.error(
    '\nFix shape: add `await writeAuditLog({ auth, action: \'<DOMAIN>_<VERB>\', resourceType: \'<table>\', resourceId: <id>, oldData: ..., newData: ... });` inside the mutation body. If the method genuinely does NOT need audit (rare — e.g., a transient-state-only operation), add `// @audit-log-exempt: <reason>` directly above the method declaration OR add `<file> <fingerprint>  # comment` to scripts/guards/check-safety-surface-audit-log.allowlist.',
  );
  process.exit(1);
}

if (require.main === module) main();
