/**
 * PR-R1-17 — CI guard: NEW migrations creating tables with `clinic_id`
 * MUST also include `ENABLE ROW LEVEL SECURITY` + a matching
 * `CREATE POLICY rls_<table>_tenant` declaration (CLAUDE.md §6.3).
 *
 * Why this exists — 101 of 103 tables had no Row Level Security before
 * BUG-454 closed the gap (per CLAUDE.md §6.3). Tenant isolation relied
 * entirely on application code. RLS is the second line of defence;
 * forgetting it on a new table opens a cross-tenant leak risk for any
 * future code that reads from the table without an explicit clinic_id
 * filter.
 *
 * Detection (per-migration):
 *   1. Walk every `apps/api/migrations/*.ts` file (skip
 *      `@migration-squashed-baseline`).
 *   2. For each `createTable('<table>', ...)` block whose body declares
 *      `t.uuid('clinic_id')`:
 *      a. Verify the same migration file contains
 *         `ALTER TABLE <table> ENABLE ROW LEVEL SECURITY` (raw SQL).
 *      b. Verify the same migration file contains a `CREATE POLICY`
 *         for the table.
 *   3. If either is missing → REJECT.
 *
 * Allowlist:
 *   - Inline `// @migration-rls-exempt: <reason>` (REQUIRES non-empty
 *     reason) on the line of the `createTable` opener
 *   - Per-migration fingerprint allowlist for grandfathered baseline
 *
 * Out of scope:
 *   - Tables WITHOUT `clinic_id` (out of scope; not tenant-scoped)
 *   - `alterTable` (only `createTable` triggers the rule — RLS must
 *     land in the same migration that creates the table)
 *
 * Mutation-resistant testing: `runGuard()` exported.
 *
 * Exit codes:
 *   0 — every clinic_id table has both ENABLE RLS + CREATE POLICY
 *   1 — one or more tables missing RLS or POLICY
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
  listTopLevelTsFiles,
} from './lib/guardRuntime';
import {
  findMigrationTableBlocks,
  isMigrationSquashedBaseline,
} from './lib/migrationGuardRuntime';

const ROOT = resolve(__dirname, '..', '..');
const DEFAULT_SNAPSHOT_PATH = resolve(ROOT, 'apps', 'api', 'src', 'db', 'schema-snapshot.json');
const DEFAULT_MIGRATIONS_DIR = resolve(ROOT, 'apps', 'api', 'migrations');
const DEFAULT_ALLOWLIST_PATH = resolve(__dirname, 'check-migration-rls-policy.allowlist');

export interface Violation {
  file: string;
  lineNo: number;
  table: string;
  missing: 'enable-rls' | 'create-policy' | 'both';
  preview: string;
}

interface ScanCounts {
  validatedTables: number;
  skippedSquashed: number;
  skippedExempt: number;
  skippedNoClinicId: number;
  scannedFiles: number;
}

// ── helpers ────────────────────────────────────────────────────────────

function hasInlineExemption(source: string, lineNo: number, lineOffsets: number[]): boolean {
  return hasInlineExemptionOnPreviousLine(source, lineNo, lineOffsets, /@migration-rls-exempt:\s*\S/);
}

function bodyHasClinicId(body: string): boolean {
  return /t\.uuid\s*\(\s*['"`]clinic_id['"`]/.test(body);
}

function fileEnablesRlsForTable(source: string, table: string): boolean {
  // Match: ALTER TABLE <table> ENABLE ROW LEVEL SECURITY (case-insensitive,
  // possibly with surrounding whitespace / quotes).
  const escaped = table.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(`ALTER\\s+TABLE\\s+(?:"\\s*)?${escaped}(?:\\s*")?\\s+ENABLE\\s+ROW\\s+LEVEL\\s+SECURITY`, 'i');
  return re.test(source);
}

function fileCreatesPolicyForTable(source: string, table: string): boolean {
  // Match: CREATE POLICY [IF NOT EXISTS] <name> ON <table>
  const escaped = table.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(`CREATE\\s+POLICY\\s+(?:IF\\s+NOT\\s+EXISTS\\s+)?[\\w_]+\\s+ON\\s+(?:"\\s*)?${escaped}(?:\\s*")?\\b`, 'i');
  return re.test(source);
}

// ── file scanner ───────────────────────────────────────────────────────

function checkFile(
  file: string,
  source: string,
  allow: AllowlistEntry[],
  counts: ScanCounts,
  violationBuckets: Map<string, number>,
): Violation[] {
  if (isMigrationSquashedBaseline(source)) {
    counts.skippedSquashed++;
    return [];
  }

  const violations: Violation[] = [];
  const relFile = relative(ROOT, file);
  const lineOffsets = buildLineOffsets(source);
  const lines = source.split('\n');
  counts.scannedFiles++;

  const tableBlocks = findMigrationTableBlocks(source, { includeAlterTable: false });
  for (const block of tableBlocks) {

    if (!bodyHasClinicId(block.body)) {
      counts.skippedNoClinicId++;
      continue;
    }

    const openerLineNo = lineNoOfIndex(lineOffsets, block.openerIndex);
    if (hasInlineExemption(source, openerLineNo, lineOffsets)) {
      counts.skippedExempt++;
      continue;
    }

    const enablesRls = fileEnablesRlsForTable(source, block.tableSpec);
    const createsPolicy = fileCreatesPolicyForTable(source, block.tableSpec);

    if (enablesRls && createsPolicy) {
      counts.validatedTables++;
      continue;
    }

    const missing: 'enable-rls' | 'create-policy' | 'both' = !enablesRls && !createsPolicy
      ? 'both'
      : !enablesRls
        ? 'enable-rls'
        : 'create-policy';

    const fullLine = lines[openerLineNo - 1] || '';
    const preview = fullLine.trim().slice(0, 180);

    if (isAllowlistedFingerprint(relFile, openerLineNo, fullLine, allow)) {
      const fp = fingerprintLine(fullLine);
      if (fp) {
        const key = `${relFile}|${fp}`;
        violationBuckets.set(key, (violationBuckets.get(key) || 0) + 1);
        const allowed = getAllowlistedCount(relFile, fp, allow);
        if ((violationBuckets.get(key) || 0) > allowed) {
          violations.push({
            file: relFile,
            lineNo: openerLineNo,
            table: block.tableSpec,
            missing,
            preview,
          });
        }
      }
      continue;
    }

    violations.push({
      file: relFile,
      lineNo: openerLineNo,
      table: block.tableSpec,
      missing,
      preview,
    });
  }

  return violations;
}

// ── runner (exported for tests) ────────────────────────────────────────

export interface RunGuardOpts {
  snapshotPath?: string;
  migrationsDir?: string;
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
  const migrationsDir = opts.migrationsDir ?? DEFAULT_MIGRATIONS_DIR;
  const allowlistPath = opts.allowlistPath ?? DEFAULT_ALLOWLIST_PATH;

  if (!hasUsableSchemaSnapshot(snapshotPath)) {
    return {
      exitCode: 2,
      violations: [],
      counts: { validatedTables: 0, skippedSquashed: 0, skippedExempt: 0, skippedNoClinicId: 0, scannedFiles: 0 },
      filesScanned: 0,
      allowlistEntries: 0,
    };
  }

  const allow = loadFingerprintAllowlist(allowlistPath);
  const files = listTopLevelTsFiles(migrationsDir);
  const counts: ScanCounts = {
    validatedTables: 0,
    skippedSquashed: 0,
    skippedExempt: 0,
    skippedNoClinicId: 0,
    scannedFiles: 0,
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
  console.log('→ check-migration-rls-policy (PR-R1-17; CLAUDE.md §6.3)');
  // eslint-disable-next-line no-console
  console.log(`  migrations dir:  ${relative(ROOT, DEFAULT_MIGRATIONS_DIR)}`);
  // eslint-disable-next-line no-console
  console.log(`  allowlist:       ${relative(ROOT, DEFAULT_ALLOWLIST_PATH)} (${result.allowlistEntries} entries)`);
  // eslint-disable-next-line no-console
  console.log(`  scanned files:   ${result.filesScanned} (${result.counts.scannedFiles} non-squashed)`);

  if (result.exitCode === 2) {
    // eslint-disable-next-line no-console
    console.error(`✗ schema-snapshot.json read failed or empty.`);
    process.exit(2);
  }

  // eslint-disable-next-line no-console
  console.log(`\n  validated tables:           ${result.counts.validatedTables}`);
  // eslint-disable-next-line no-console
  console.log(`  skipped squashed:           ${result.counts.skippedSquashed}`);
  // eslint-disable-next-line no-console
  console.log(`  skipped (no clinic_id):     ${result.counts.skippedNoClinicId}`);
  // eslint-disable-next-line no-console
  console.log(`  skipped exempt:             ${result.counts.skippedExempt}`);

  if (result.violations.length === 0) {
    // eslint-disable-next-line no-console
    console.log('\n✓ Every clinic_id-bearing table has ENABLE ROW LEVEL SECURITY + CREATE POLICY.');
    process.exit(0);
  }

  // eslint-disable-next-line no-console
  console.error(`\n✗ ${result.violations.length} table(s) missing RLS:\n`);
  for (const v of result.violations) {
    // eslint-disable-next-line no-console
    console.error(`  ${v.file}:${v.lineNo}  table='${v.table}' missing=${v.missing}`);
    // eslint-disable-next-line no-console
    console.error(`    preview: ${v.preview}`);
  }
  // eslint-disable-next-line no-console
  console.error(
    '\nFix shape: add `ALTER TABLE <table> ENABLE ROW LEVEL SECURITY` + `CREATE POLICY rls_<table>_tenant ON <table> FOR ALL USING (clinic_id = NULLIF(current_setting(\'app.clinic_id\', true), \'\')::uuid) WITH CHECK (clinic_id = NULLIF(current_setting(\'app.clinic_id\', true), \'\')::uuid)` raw blocks (with @migration-raw-exempt: rls_policy annotations per CLAUDE.md §12.4) in the same migration. If the table is genuinely NOT tenant-scoped (rare — clinic_id is a coincidence not a tenancy column), add `// @migration-rls-exempt: <reason>` on the line of the createTable opener.',
  );
  process.exit(1);
}

if (require.main === module) main();
