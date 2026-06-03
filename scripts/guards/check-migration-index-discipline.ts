/**
 * PR-R1-16 — CI guard: NEW migrations adding `clinic_id` / `patient_id`
 * / FK columns MUST also add a `t.index([...])` for the same column(s)
 * (CLAUDE.md §7.1).
 *
 * Why this exists — 20+ tables shipped without `patient_id` indexes,
 * 164 FK columns shipped without indexes (per CLAUDE.md §7.1). JOINs
 * on un-indexed FK columns force sequential scans on the parent table;
 * dashboards and clinical-list endpoints time out under load.
 *
 * Detection (per-migration AST/regex):
 *   1. Walk every `apps/api/migrations/*.ts` file (skip squashed-baseline
 *      files annotated `@migration-squashed-baseline`).
 *   2. For each `createTable(...)` / `alterTable(...)` block:
 *      a. Extract every column added with `.references('id').inTable(...)`
 *         (foreign-key declaration).
 *      b. Extract every `t.uuid('clinic_id')` / `t.uuid('patient_id')`
 *         declaration (CLAUDE.md §7.1 explicit list).
 *      c. Extract every `t.index([...])` declaration in the same block.
 *      d. For each FK / clinic_id / patient_id column, verify it appears
 *         (alone or as the first element) in some `t.index([...])` call.
 *   3. If a required index is missing → REJECT.
 *
 * Allowlist:
 *   - Inline `// @migration-index-exempt: <reason>` (REQUIRES non-empty
 *     reason) on the line of the `createTable` / `alterTable` opener
 *   - File-level `@migration-squashed-baseline` directive (per
 *     CLAUDE.md §12.4) opts the file out entirely
 *   - Per-migration fingerprint allowlist for grandfathered baseline
 *
 * Scope:
 *   `apps/api/migrations/*.ts` (Knex-tracked migrations)
 *
 * Mutation-resistant testing: `runGuard()` exported.
 *
 * Exit codes:
 *   0 — every FK / clinic_id / patient_id column has an index
 *   1 — one or more columns lack the required index
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
const DEFAULT_ALLOWLIST_PATH = resolve(__dirname, 'check-migration-index-discipline.allowlist');

export interface Violation {
  file: string;
  lineNo: number;
  table: string;
  column: string;
  reason: string;
  preview: string;
}

interface ScanCounts {
  validatedColumns: number;
  skippedSquashed: number;
  skippedExempt: number;
  scannedFiles: number;
}

// ── helpers ────────────────────────────────────────────────────────────

function hasInlineExemption(source: string, lineNo: number, lineOffsets: number[]): boolean {
  return hasInlineExemptionOnPreviousLine(source, lineNo, lineOffsets, /@migration-index-exempt:\s*\S/);
}

/**
 * Find the body of a `createTable` / `alterTable` callback. Walks balanced
 * braces from the opener to find the body.
 *
 * Input: source text starting at the position of `createTable(`/`alterTable(`.
 * Output: { body: string, tableSpec: string, bodyStart, bodyEnd } or null
 * if the body can't be parsed.
 */
interface RequiredIndex {
  column: string;
  reason: 'foreign-key' | 'patient_id' | 'clinic_id';
  /** Position within the body where the column was declared (for line-no tracking). */
  posInBody: number;
}

/**
 * Extract columns that REQUIRE an index from a createTable/alterTable body.
 *
 * Required cases:
 *   - Any column with `.references('id').inTable('...')` → FK column
 *   - `t.uuid('clinic_id')` / `t.uuid('patient_id')` (CLAUDE.md §7.1)
 *
 * Skipped cases:
 *   - Primary-key columns (`.primary()`) — implicitly indexed by Postgres
 *   - Columns explicitly marked with surrounding `// @migration-index-exempt:`
 *     (handled at the caller level)
 */
function extractRequiredIndexedColumns(body: string): RequiredIndex[] {
  const out: RequiredIndex[] = [];

  // Pattern 1: any column with .references()
  // Capture: `t.uuid('foo_id').notNullable().references(...).inTable('bar')`
  // The column name is the FIRST argument of the t.<type>('name', ...) call
  // before the .references() chain.
  const fkRe =
    /t\.\w+\s*\(\s*['"`]([^'"`]+)['"`][^)]*\)(?:\.[a-zA-Z]+\s*\([^)]*\))*\.references\s*\(/g;
  let m: RegExpExecArray | null;
  while ((m = fkRe.exec(body)) !== null) {
    const col = m[1];
    // Skip if column is also marked .primary() — implicitly indexed
    const around = body.slice(m.index, m.index + 200);
    if (/\.primary\s*\(/.test(around)) continue;
    out.push({ column: col, reason: 'foreign-key', posInBody: m.index });
  }

  // Pattern 2: t.uuid('clinic_id') / t.uuid('patient_id') — even if no FK
  // declared in the same statement (some patterns use raw FK constraints
  // separately), §7.1 still requires the index.
  //
  // Cycle-2 absorb (L3 REJECT): mirror Pattern 1's `.primary()` skip so
  // primary-key columns named clinic_id/patient_id (implicitly indexed
  // by Postgres) are not falsely flagged. clinic_settings.clinic_id is
  // the canonical case (single-tenant settings table where clinic_id IS
  // the primary key).
  const ciRe = /t\.uuid\s*\(\s*['"`](clinic_id|patient_id)['"`]/g;
  while ((m = ciRe.exec(body)) !== null) {
    const col = m[1];
    // Skip primary-key columns (Pattern 1 parity).
    const around = body.slice(m.index, m.index + 200);
    if (/\.primary\s*\(/.test(around)) continue;
    // Avoid double-reporting if we already captured this column as an FK.
    if (out.some((r) => r.column === col && r.posInBody === m!.index)) continue;
    out.push({
      column: col,
      reason: col === 'clinic_id' ? 'clinic_id' : 'patient_id',
      posInBody: m.index,
    });
  }

  return out;
}

/**
 * Extract index declarations from a body. Returns an array of column-name
 * arrays (each `t.index([...])` call yields one array).
 */
function extractIndexDeclarations(body: string): string[][] {
  const out: string[][] = [];
  // Patterns:
  //   t.index('col')
  //   t.index(['col1', 'col2'])
  //   t.index(['col'], 'idx_name')
  const re = /t\.index\s*\(\s*(?:\[([^\]]+)\]|['"`]([^'"`]+)['"`])/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(body)) !== null) {
    if (m[1]) {
      // Array form: extract quoted strings.
      const cols: string[] = [];
      const inner = m[1];
      const strRe = /['"`]([^'"`]+)['"`]/g;
      let mm: RegExpExecArray | null;
      while ((mm = strRe.exec(inner)) !== null) {
        cols.push(mm[1]);
      }
      if (cols.length > 0) out.push(cols);
    } else if (m[2]) {
      // Single-string form.
      out.push([m[2]]);
    }
  }
  return out;
}

/**
 * Check if a required column has an index. The column must appear EITHER
 * alone OR as the FIRST element of a multi-column index. (Composite
 * indexes only help queries that filter on the leftmost prefix; per
 * CLAUDE.md §7.1 a single-column index is canonical.)
 */
function hasRequiredIndex(column: string, indexDecls: string[][]): boolean {
  for (const cols of indexDecls) {
    if (cols.length === 0) continue;
    if (cols[0] === column) return true;
    if (cols.length === 1 && cols[0] === column) return true;
  }
  return false;
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

  const tableBlocks = findMigrationTableBlocks(source, { includeAlterTable: true });
  for (const block of tableBlocks) {
    const openerLineNo = lineNoOfIndex(lineOffsets, block.openerIndex);
    if (hasInlineExemption(source, openerLineNo, lineOffsets)) {
      counts.skippedExempt++;
      continue;
    }

    const required = extractRequiredIndexedColumns(block.body);
    const indexes = extractIndexDeclarations(block.body);

    for (const req of required) {
      if (hasRequiredIndex(req.column, indexes)) {
        counts.validatedColumns++;
        continue;
      }

      // Compute the line number of the column declaration.
      const colDeclIdx = block.bodyStart + req.posInBody;
      const colLineNo = lineNoOfIndex(lineOffsets, colDeclIdx);
      const fullLine = lines[colLineNo - 1] || '';
      const preview = fullLine.trim().slice(0, 180);

      if (isAllowlistedFingerprint(relFile, colLineNo, fullLine, allow)) {
        const fp = fingerprintLine(fullLine);
        if (fp) {
          const key = `${relFile}|${fp}`;
          violationBuckets.set(key, (violationBuckets.get(key) || 0) + 1);
          const allowed = getAllowlistedCount(relFile, fp, allow);
          if ((violationBuckets.get(key) || 0) > allowed) {
            violations.push({
              file: relFile,
              lineNo: colLineNo,
              table: block.tableSpec,
              column: req.column,
              reason: `over-count: ${violationBuckets.get(key)} occurrences vs ${allowed} allowlisted (fingerprint ${fp})`,
              preview,
            });
          }
        }
        continue;
      }

      violations.push({
        file: relFile,
        lineNo: colLineNo,
        table: block.tableSpec,
        column: req.column,
        reason: `column '${req.column}' (${req.reason}) on table '${block.tableSpec}' is missing a t.index(['${req.column}']) declaration — JOINs and clinic-scoped queries will force sequential scans (CLAUDE.md §7.1)`,
        preview,
      });
    }
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
      counts: { validatedColumns: 0, skippedSquashed: 0, skippedExempt: 0, scannedFiles: 0 },
      filesScanned: 0,
      allowlistEntries: 0,
    };
  }

  const allow = loadFingerprintAllowlist(allowlistPath);
  const files = listTopLevelTsFiles(migrationsDir);
  const counts: ScanCounts = {
    validatedColumns: 0,
    skippedSquashed: 0,
    skippedExempt: 0,
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
  console.log('→ check-migration-index-discipline (PR-R1-16; CLAUDE.md §7.1)');
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
  console.log(`\n  validated columns:    ${result.counts.validatedColumns}`);
  // eslint-disable-next-line no-console
  console.log(`  skipped squashed:     ${result.counts.skippedSquashed}`);
  // eslint-disable-next-line no-console
  console.log(`  skipped exempt:       ${result.counts.skippedExempt}`);

  if (result.violations.length === 0) {
    // eslint-disable-next-line no-console
    console.log('\n✓ Every FK / clinic_id / patient_id column in non-squashed migrations has a corresponding index.');
    process.exit(0);
  }

  // eslint-disable-next-line no-console
  console.error(`\n✗ ${result.violations.length} column(s) missing required index:\n`);
  for (const v of result.violations) {
    // eslint-disable-next-line no-console
    console.error(`  ${v.file}:${v.lineNo}  table='${v.table}' column='${v.column}'`);
    // eslint-disable-next-line no-console
    console.error(`    reason: ${v.reason}`);
    // eslint-disable-next-line no-console
    console.error(`    preview: ${v.preview}`);
  }
  // eslint-disable-next-line no-console
  console.error(
    '\nFix shape: add `t.index([\'<col>\'])` inside the createTable/alterTable callback for every FK + clinic_id + patient_id column. If the index is intentionally NOT present (rare — usually a small lookup table where seq-scan is faster), add `// @migration-index-exempt: <reason>` on the line of the createTable/alterTable opener OR add `<file> <fingerprint>  # comment` to scripts/guards/check-migration-index-discipline.allowlist.',
  );
  process.exit(1);
}

if (require.main === module) main();
