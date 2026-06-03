/**
 * PR-R1-15 — CI guard: Knex `.update(...)` and `.delete()` / `.del()`
 * chains MUST include a `.where(...)` clause (CLAUDE.md §1.3 belt).
 *
 * Why this exists — CLAUDE.md §1.3 mandates `clinic_id` on every UPDATE
 * / DELETE. The pre-existing `check-query-has-clinic-id.ts` guard catches
 * the §1.3 main rule. This guard catches the ZERO-CLAUSE case — chains
 * with NO `.where*` at all that would unconditionally affect every row
 * in the table. A chain with `.update({...})` and no `.where(...)` is
 * never intentional outside admin "factory reset" flows; default-deny
 * is the right posture.
 *
 * Detection (Stage 1):
 *   1. Walk every `apps/api/src/{features,mcp,integrations,jobs}/*.ts`
 *   2. Find every Knex opener `db('TABLE')` / `dbRead('TABLE')` /
 *      `trx('TABLE')` / `dbAdmin('TABLE')` (incl. generic-call form)
 *   3. Walk forward chain. If chain contains `.update(...)` / `.delete()`
 *      / `.del()` AND NO `.where*` clause → REJECT.
 *   4. Skip INSERT chains (no targeting needed).
 *
 * Allowlist:
 *   - Inline `// @empty-where-exempt: <reason>` (REQUIRES non-empty
 *     reason) on the line directly above the opener
 *   - File-level fingerprint allowlist for grandfathered baseline
 *
 * Exit codes:
 *   0 — every UPDATE/DELETE chain has at least one .where* clause
 *   1 — one or more chains lack any .where* clause
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
import {
  buildDbOpenerRegex,
  findChainEnd,
  findDbAliasIdentifiers,
  parseTableAlias,
  stripCommentsPreservingLayout,
} from './lib/knexChainRuntime';

const ROOT = resolve(__dirname, '..', '..');
const DEFAULT_SNAPSHOT_PATH = resolve(ROOT, 'apps', 'api', 'src', 'db', 'schema-snapshot.json');
const DEFAULT_SCAN_ROOTS = [
  resolve(ROOT, 'apps', 'api', 'src', 'features'),
  resolve(ROOT, 'apps', 'api', 'src', 'mcp'),
  resolve(ROOT, 'apps', 'api', 'src', 'integrations'),
  resolve(ROOT, 'apps', 'api', 'src', 'jobs'),
];
const DEFAULT_ALLOWLIST_PATH = resolve(__dirname, 'check-empty-where-on-mutation.allowlist');

export interface Violation {
  file: string;
  lineNo: number;
  table: string;
  mutationKind: 'update' | 'delete' | 'del';
  preview: string;
  reason: string;
}

interface ScanCounts {
  validatedUpdate: number;
  validatedDelete: number;
  skippedExempt: number;
  skippedNoMutation: number;
}

function hasInlineExemption(source: string, lineNo: number, lineOffsets: number[]): boolean {
  return hasInlineExemptionOnPreviousLine(source, lineNo, lineOffsets, /@empty-where-exempt:\s*\S/);
}

const HAS_WHERE_RE = /\.(where|whereIn|whereNot|whereNotIn|whereNull|whereNotNull|whereRaw|whereBetween|whereNotBetween|whereExists|whereNotExists|whereLike|whereILike|andWhere|orWhere)\s*\(/;
const HAS_UPDATE_RE = /\.update\s*\(/;
const HAS_DELETE_RE = /\.(delete|del)\s*\(/;

export { findDbAliasIdentifiers };

// ── file scanner ───────────────────────────────────────────────────────

function checkFile(
  file: string,
  rawSource: string,
  allow: AllowlistEntry[],
  counts: ScanCounts,
  violationBuckets: Map<string, number>,
): Violation[] {
  const source = stripCommentsPreservingLayout(rawSource);
  const rawLineOffsets = buildLineOffsets(rawSource);
  const violations: Violation[] = [];
  const relFile = relative(ROOT, file);
  const lineOffsets = buildLineOffsets(source);
  const lines = rawSource.split('\n');
  const dbAliases = findDbAliasIdentifiers(source);
  const openerRe = buildDbOpenerRegex(dbAliases);

  let m: RegExpExecArray | null;
  openerRe.lastIndex = 0;
  while ((m = openerRe.exec(source)) !== null) {
    const spec = m[1] || m[2] || '';
    if (!spec) continue;
    const { table } = parseTableAlias(spec);

    const chainEnd = findChainEnd(source, m.index);
    const chain = source.slice(m.index, chainEnd);

    const hasUpdate = HAS_UPDATE_RE.test(chain);
    const hasDelete = HAS_DELETE_RE.test(chain);
    if (!hasUpdate && !hasDelete) {
      counts.skippedNoMutation++;
      continue;
    }

    const hasWhere = HAS_WHERE_RE.test(chain);
    if (hasWhere) {
      if (hasUpdate) counts.validatedUpdate++;
      if (hasDelete) counts.validatedDelete++;
      continue;
    }

    // Violation: UPDATE/DELETE chain without any .where*.
    const lineNo = lineNoOfIndex(lineOffsets, m.index);
    if (hasInlineExemption(rawSource, lineNo, rawLineOffsets)) {
      counts.skippedExempt++;
      continue;
    }

    const fullLine = lines[lineNo - 1] || '';
    const preview = fullLine.trim().slice(0, 180);
    const mutationKind: 'update' | 'delete' | 'del' = hasUpdate
      ? 'update'
      : /\.delete\s*\(/.test(chain)
        ? 'delete'
        : 'del';

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
            table,
            mutationKind,
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
      table,
      mutationKind,
      preview,
      reason: `${mutationKind.toUpperCase()} chain on '${table}' has NO .where* clause — would unconditionally affect every row in the table`,
    });
  }

  return violations;
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

export function runGuard(opts: RunGuardOpts = {}): RunGuardResult {
  const snapshotPath = opts.snapshotPath ?? DEFAULT_SNAPSHOT_PATH;
  const scanRoots = opts.scanRoots ?? DEFAULT_SCAN_ROOTS;
  const allowlistPath = opts.allowlistPath ?? DEFAULT_ALLOWLIST_PATH;

  // The snapshot is read for parity with sibling guards (informational).
  // This guard does not actually need column data — it operates on chain
  // shape. We still verify the snapshot exists so all guards have the same
  // pre-flight failure mode.
  if (!hasUsableSchemaSnapshot(snapshotPath)) {
    return {
      exitCode: 2,
      violations: [],
      counts: { validatedUpdate: 0, validatedDelete: 0, skippedExempt: 0, skippedNoMutation: 0 },
      filesScanned: 0,
      allowlistEntries: 0,
    };
  }

  const allow = loadFingerprintAllowlist(allowlistPath);
  const files = Array.from(
    new Set(
      scanRoots.flatMap((root) => walkTsFiles(root, [], {
        excludeDirs: ['node_modules', 'dist', '__tests__'],
      })),
    ),
  ).sort();
  const counts: ScanCounts = {
    validatedUpdate: 0,
    validatedDelete: 0,
    skippedExempt: 0,
    skippedNoMutation: 0,
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
    filesScanned: files.length,
    allowlistEntries: allow.length,
  };
}

// ── CLI entry ──────────────────────────────────────────────────────────

function main(): void {
  const result = runGuard();
  // eslint-disable-next-line no-console
  console.log('→ check-empty-where-on-mutation (PR-R1-15; CLAUDE.md §1.3 belt)');
  // eslint-disable-next-line no-console
  console.log(`  snapshot:           ${relative(ROOT, DEFAULT_SNAPSHOT_PATH)}`);
  // eslint-disable-next-line no-console
  console.log(`  allowlist:          ${relative(ROOT, DEFAULT_ALLOWLIST_PATH)} (${result.allowlistEntries} entries)`);
  // eslint-disable-next-line no-console
  console.log(`  scanned:            ${result.filesScanned} ts file(s)`);

  if (result.exitCode === 2) {
    // eslint-disable-next-line no-console
    console.error(`✗ schema-snapshot.json read failed or empty.`);
    process.exit(2);
  }

  // eslint-disable-next-line no-console
  console.log(`\n  validated UPDATE chains:  ${result.counts.validatedUpdate}`);
  // eslint-disable-next-line no-console
  console.log(`  validated DELETE chains:  ${result.counts.validatedDelete}`);
  // eslint-disable-next-line no-console
  console.log(`  skipped (no mutation):    ${result.counts.skippedNoMutation}`);
  // eslint-disable-next-line no-console
  console.log(`  skipped exempt:           ${result.counts.skippedExempt}`);

  if (result.violations.length === 0) {
    // eslint-disable-next-line no-console
    console.log('\n✓ Every UPDATE/DELETE chain has at least one .where* clause.');
    process.exit(0);
  }

  // eslint-disable-next-line no-console
  console.error(`\n✗ ${result.violations.length} mutation chain(s) without WHERE clause:\n`);
  for (const v of result.violations) {
    // eslint-disable-next-line no-console
    console.error(`  ${v.file}:${v.lineNo}  ${v.mutationKind.toUpperCase()} '${v.table}'`);
    // eslint-disable-next-line no-console
    console.error(`    reason: ${v.reason}`);
    // eslint-disable-next-line no-console
    console.error(`    preview: ${v.preview}`);
  }
  // eslint-disable-next-line no-console
  console.error(
    '\nFix shape: add a `.where(...)` clause that scopes the mutation (typically by `id` + `clinic_id` per CLAUDE.md §1.3). If the mutation is INTENTIONALLY unscoped (admin factory-reset / migration / explicit data-clear), add `// @empty-where-exempt: <reason>` on the line directly above the opener OR add `<file> <fingerprint>  # comment` to scripts/guards/check-empty-where-on-mutation.allowlist.',
  );
  process.exit(1);
}

if (require.main === module) main();
