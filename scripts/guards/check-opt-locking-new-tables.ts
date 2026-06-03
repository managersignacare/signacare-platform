#!/usr/bin/env tsx
/*
 * scripts/guards/check-opt-locking-new-tables.ts
 *
 * Phase R1 PR-R1-12 cycle-2 — CLAUDE.md §1.6 enforcement
 * (optimistic-locking on multi-writer clinical tables).
 *
 * ── Why this exists (cycle-2 expanded scope) ─────────────────────
 * §1.6: "Tables with concurrent writers from multiple surfaces
 *  (prescriber + dispenser + pharmacist; multiple-clinician edits
 *  during handover) MUST have a `lock_version` integer column."
 *
 * Cycle-1 (REJECT): scanned ONLY `createTable` blocks in migrations,
 * counted 2+ `_by_*_id` columns. L3 cycle-1 review surfaced:
 *   - `prescriptions` (locked per §1.6) has 1 `_by_*_id` col → MISSED
 *   - `treatment_pathways` (locked per BUG-402) has 0 → MISSED
 *   - `alterTable` additions (e.g. episodes' 2nd/3rd `_by` columns
 *     came from a later alterTable migration) → MISSED
 *   - `medication_administrations` + `restrictive_interventions`
 *     are clinical-safety S0 multi-writer surfaces — both currently
 *     LACK `lock_version` and silent overwrite is patient-harm.
 *
 * Cycle-2 pivot: read `apps/api/src/db/schema-snapshot.json` (the
 * live cumulative DB state, refreshed by `npm run db:snapshot`).
 * The snapshot has the MERGED column set across baseline +
 * createTable + alterTable migrations, so cumulative multi-writer-
 * ness is correctly detected. Plus three disjunctive triggers:
 *
 *   TRIGGER A: 2+ `_by_<role>_id` columns (cycle-1 signal, retained)
 *   TRIGGER B: 1+ `_by_<role>_id` AND `status` AND ≥1 state-
 *             transition `*_at` column (the §1.6 motivating shape:
 *             prescribed_by + status + dispensed_at = multi-surface
 *             state-machine race)
 *   TRIGGER C: name-listed in CANONICAL_LOCKED_TABLES (the §1.6
 *             explicit list — `prescriptions`, `clinical_notes`,
 *             etc. — hard-fail if `lock_version` absent regardless
 *             of column shape)
 *
 * Match → require `lock_version` in the table's column set, OR be
 * in the per-table allowlist with a documented reason.
 *
 * ── Allowlist format (cycle-2 per-table grain) ──────────────────
 *   <table>  # reason  (per-table allowlist; cycle-1 file-level
 *                       allowlist replaced for granularity)
 *
 * Cycle-1's file-level allowlist for `20260701000000_baseline.ts`
 * was too coarse — only 15 of 200+ baseline tables are flagged,
 * and a NEW createTable accidentally appended would be silently
 * allowlisted. Cycle-2: per-table entries for each grandfathered
 * table.
 *
 * ── Run ──────────────────────────────────────────────────────────
 * `npm run guard:opt-locking-new-tables`
 *
 * Exit codes:
 *   0  every multi-writer table declares lock_version (or allowlisted)
 *   1  one or more multi-writer tables lack lock_version
 *   2  schema-snapshot.json missing or malformed
 */

import * as fs from 'fs';
import * as path from 'path';

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const SNAPSHOT_PATH = path.join(REPO_ROOT, 'apps', 'api', 'src', 'db', 'schema-snapshot.json');
const ALLOWLIST_PATH = path.join(__dirname, 'check-opt-locking-new-tables.allowlist');

/**
 * §1.6 explicit name-list (TRIGGER C). These tables MUST have
 * `lock_version` regardless of column shape.
 */
export const CANONICAL_LOCKED_TABLES = new Set([
  'clinical_notes',
  'prescriptions',
  'patient_medications',
  'episodes',
  'treatment_pathways',
]);

/**
 * State-transition `*_at` timestamp suffixes that signal multi-
 * surface workflow mutations (TRIGGER B). Used in conjunction
 * with `status` column + 1+ `_by_*_id` to detect state-machine
 * race conditions.
 */
const STATE_TRANSITION_AT_SUFFIXES = [
  'accepted_at',
  'acknowledged_at',
  'approved_at',
  'cancelled_at',
  'completed_at',
  'dispensed_at',
  'downloaded_at',
  'expired_at',
  'rejected_at',
  'resolved_at',
  'reviewed_at',
  'signed_at',
  'submitted_at',
  'verified_at',
];

const BY_ROLE_RE = /_by_(staff_id|clinician_id|user_id|id)$/;

export interface MultiWriterFinding {
  table: string;
  trigger: 'A_two_plus_by' | 'B_status_state_transition' | 'C_canonical_list';
  byColumns: string[];
  stateTransitionColumns: string[];
  hasStatus: boolean;
  hasLockVersion: boolean;
}

/**
 * Find all multi-writer columns in a column list (both _by_*_id
 * actor columns and state-transition *_at timestamps).
 */
export function findMultiWriterByColumns(columns: string[]): string[] {
  return columns.filter((c) => BY_ROLE_RE.test(c));
}

export function findStateTransitionAtColumns(columns: string[]): string[] {
  return columns.filter((c) => STATE_TRANSITION_AT_SUFFIXES.includes(c));
}

/**
 * Apply the three disjunctive triggers to a (table, columns) pair.
 * Returns null if not multi-writer; returns finding with trigger ID
 * if detected.
 */
export function evaluateTable(table: string, columns: string[]): MultiWriterFinding | null {
  const byColumns = findMultiWriterByColumns(columns);
  const stateTransitionColumns = findStateTransitionAtColumns(columns);
  const hasStatus = columns.includes('status');
  const hasLockVersion = columns.includes('lock_version');

  // TRIGGER C — name-listed canonical tables ALWAYS need lock_version
  if (CANONICAL_LOCKED_TABLES.has(table)) {
    return {
      table,
      trigger: 'C_canonical_list',
      byColumns,
      stateTransitionColumns,
      hasStatus,
      hasLockVersion,
    };
  }

  // TRIGGER A — 2+ actor columns
  if (byColumns.length >= 2) {
    return {
      table,
      trigger: 'A_two_plus_by',
      byColumns,
      stateTransitionColumns,
      hasStatus,
      hasLockVersion,
    };
  }

  // TRIGGER B — 1+ actor + status + state-transition timestamp
  if (byColumns.length >= 1 && hasStatus && stateTransitionColumns.length >= 1) {
    return {
      table,
      trigger: 'B_status_state_transition',
      byColumns,
      stateTransitionColumns,
      hasStatus,
      hasLockVersion,
    };
  }

  return null;
}

/**
 * Load the per-table allowlist. Format: one table name per line,
 * optional `# comment` after.
 */
export function loadAllowlist(filePath: string = ALLOWLIST_PATH): {
  tables: Set<string>;
  parseErrors: string[];
} {
  const tables = new Set<string>();
  const parseErrors: string[] = [];
  let raw: string;
  try {
    raw = fs.readFileSync(filePath, 'utf-8');
  } catch {
    return { tables, parseErrors };
  }
  const lines = raw.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i]!.split('#')[0]!.trim();
    if (!trimmed) continue;
    if (!/^[a-z_]+$/.test(trimmed)) {
      parseErrors.push(
        `line ${i + 1}: malformed entry "${trimmed}" — expected: <table_name>  # reason`,
      );
      continue;
    }
    tables.add(trimmed);
  }
  return { tables, parseErrors };
}

export interface GuardResult {
  exitCode: number;
  violations: MultiWriterFinding[];
  staleAllowlistEntries: string[];
  parseErrors: string[];
  scannedTables: number;
}

/**
 * Run the guard end-to-end. Reads the snapshot, applies the three
 * triggers to every table, returns a structured result. Exported
 * so tests can call it directly with synthetic snapshots / allowlists
 * (per L3 PR-R1-7 cycle-2 lesson — no parser duplication).
 */
export function runGuard(opts: {
  snapshotPath?: string;
  allowlistPath?: string;
} = {}): GuardResult {
  const snapPath = opts.snapshotPath ?? SNAPSHOT_PATH;
  const allowPath = opts.allowlistPath ?? ALLOWLIST_PATH;

  let snapshot: { tables: Record<string, string[]> };
  try {
    snapshot = JSON.parse(fs.readFileSync(snapPath, 'utf-8'));
  } catch (err) {
    return {
      exitCode: 2,
      violations: [],
      staleAllowlistEntries: [],
      parseErrors: [`could not read or parse snapshot at ${snapPath}: ${(err as Error).message}`],
      scannedTables: 0,
    };
  }
  if (!snapshot.tables || typeof snapshot.tables !== 'object') {
    return {
      exitCode: 2,
      violations: [],
      staleAllowlistEntries: [],
      parseErrors: [`snapshot missing top-level "tables" object`],
      scannedTables: 0,
    };
  }

  const { tables: allowlisted, parseErrors } = loadAllowlist(allowPath);
  const violations: MultiWriterFinding[] = [];
  const staleAllowlistEntries: string[] = [];
  const findingsByTable = new Map<string, MultiWriterFinding | null>();

  for (const [table, columns] of Object.entries(snapshot.tables)) {
    if (!Array.isArray(columns)) continue;
    const finding = evaluateTable(table, columns);
    findingsByTable.set(table, finding);

    if (allowlisted.has(table)) continue;
    if (finding && !finding.hasLockVersion) {
      violations.push(finding);
    }
  }

  for (const table of allowlisted) {
    const finding = findingsByTable.get(table);
    if (!finding) {
      staleAllowlistEntries.push(`${table} — no longer matches any multi-writer trigger`);
      continue;
    }
    if (finding.hasLockVersion) {
      staleAllowlistEntries.push(`${table} — lock_version now present, remove from allowlist`);
    }
  }

  return {
    exitCode:
      parseErrors.length > 0 || violations.length > 0 || staleAllowlistEntries.length > 0
        ? 1
        : 0,
    violations,
    staleAllowlistEntries,
    parseErrors,
    scannedTables: Object.keys(snapshot.tables).length,
  };
}

function formatTrigger(t: MultiWriterFinding['trigger']): string {
  switch (t) {
    case 'A_two_plus_by': return 'A (2+ _by_*_id columns)';
    case 'B_status_state_transition': return 'B (status + state-transition *_at + 1+ _by_*_id)';
    case 'C_canonical_list': return 'C (§1.6 canonical-locked table)';
  }
}

function main(): number {
  const result = runGuard();
  const allowlistCount = loadAllowlist().tables.size;

  console.error('→ check-opt-locking-new-tables (PR-R1-12 cycle-2; CLAUDE.md §1.6)');
  console.error(`  snapshot:   ${path.relative(REPO_ROOT, SNAPSHOT_PATH)}`);
  console.error(`  tables:     ${result.scannedTables}`);
  console.error(`  allowlist:  ${path.relative(REPO_ROOT, ALLOWLIST_PATH)} (${allowlistCount} entries)`);
  console.error(`  violations: ${result.violations.length}`);
  console.error(`  stale:      ${result.staleAllowlistEntries.length}`);
  console.error('');

  if (result.parseErrors.length > 0) {
    console.error(`✗ ${result.parseErrors.length} parse error(s):`);
    for (const e of result.parseErrors) console.error(`  ${e}`);
    console.error('');
  }

  if (result.exitCode === 2) return 2;

  if (
    result.violations.length === 0 &&
    result.parseErrors.length === 0 &&
    result.staleAllowlistEntries.length === 0
  ) {
    console.error('✓ Every multi-writer table declares lock_version (or is allowlisted with reason).');
    return 0;
  }

  if (result.violations.length > 0) {
    console.error(`✗ ${result.violations.length} multi-writer table(s) lack lock_version:\n`);
    for (const v of result.violations) {
      console.error(`  ${v.table}`);
      console.error(`    trigger:   ${formatTrigger(v.trigger)}`);
      console.error(`    byColumns: [${v.byColumns.join(', ') || '(none)'}]`);
      if (v.stateTransitionColumns.length > 0) {
        console.error(`    *_at:      [${v.stateTransitionColumns.join(', ')}]`);
      }
      if (v.hasStatus) console.error(`    status:    yes`);
      console.error('');
    }
    console.error(
      'Fix per CLAUDE.md §1.6: add lock_version via migration AND wire writes through ' +
        '`updateWithOptimisticLock()` from `apps/api/src/shared/db/optimisticLock.ts`. ' +
        `For grandfathered tables, add the table name to ${path.relative(REPO_ROOT, ALLOWLIST_PATH)} ` +
        'with a documented race-precluding reason (e.g., UNIQUE constraint making the UPDATE a CAS).',
    );
  }

  if (result.staleAllowlistEntries.length > 0) {
    console.error(`\n✗ ${result.staleAllowlistEntries.length} stale allowlist entr${result.staleAllowlistEntries.length === 1 ? 'y' : 'ies'}:`);
    for (const stale of result.staleAllowlistEntries) {
      console.error(`  - ${stale}`);
    }
    console.error(
      `\nPrune stale entries from ${path.relative(REPO_ROOT, ALLOWLIST_PATH)} ` +
      'to keep allowlist debt honest and prevent hidden drift.',
    );
  }
  return 1;
}

if (require.main === module) {
  process.exit(main());
}
