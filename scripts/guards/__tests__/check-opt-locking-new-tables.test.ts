/*
 * scripts/guards/__tests__/check-opt-locking-new-tables.test.ts
 *
 * Phase R1 PR-R1-12 cycle-2 — symmetric vitest spec with mutation
 * resistance. Cycle-1 spec was REJECTed by L3 because:
 *   - It tested isolated helpers but never invoked the guard
 *     decision path (`main()` not exported)
 *   - Mutating MULTI_WRITER_THRESHOLD or main() body to no-op
 *     left all tests green (zero mutation resistance)
 *   - No fixture-driven end-to-end test
 *
 * Cycle-2 absorb: import the runGuard() runner directly + add
 * end-to-end fixture tests that run the full pipeline.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdirSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  evaluateTable,
  findMultiWriterByColumns,
  findStateTransitionAtColumns,
  loadAllowlist,
  runGuard,
  CANONICAL_LOCKED_TABLES,
} from '../check-opt-locking-new-tables';

// ── Pure unit tests — column detection ──────────────────────────────

describe('findMultiWriterByColumns', () => {
  it('finds 2+ _by_staff_id columns', () => {
    const cols = ['id', 'clinic_id', 'signed_by_staff_id', 'approved_by_staff_id'];
    expect(findMultiWriterByColumns(cols)).toEqual([
      'signed_by_staff_id',
      'approved_by_staff_id',
    ]);
  });

  it('finds _by_id, _by_clinician_id, _by_user_id variants', () => {
    expect(findMultiWriterByColumns(['created_by_id'])).toEqual(['created_by_id']);
    expect(findMultiWriterByColumns(['reviewed_by_clinician_id'])).toEqual(['reviewed_by_clinician_id']);
    expect(findMultiWriterByColumns(['actor_by_user_id'])).toEqual(['actor_by_user_id']);
  });

  it('does NOT match generic foreign-key columns', () => {
    expect(findMultiWriterByColumns(['patient_id', 'episode_id', 'staff_id'])).toEqual([]);
  });
});

describe('findStateTransitionAtColumns', () => {
  it('finds approved_at, signed_at, dispensed_at, etc.', () => {
    const cols = ['created_at', 'approved_at', 'signed_at', 'name'];
    expect(findStateTransitionAtColumns(cols)).toEqual(['approved_at', 'signed_at']);
  });

  it('does NOT match created_at / updated_at (not state-transition)', () => {
    expect(findStateTransitionAtColumns(['created_at', 'updated_at'])).toEqual([]);
  });
});

// ── evaluateTable trigger tests ─────────────────────────────────────

describe('evaluateTable — TRIGGER A (2+ _by_*_id)', () => {
  it('flags table with 2 actor columns', () => {
    const r = evaluateTable('foo', ['id', 'signed_by_staff_id', 'approved_by_staff_id']);
    expect(r).not.toBeNull();
    expect(r!.trigger).toBe('A_two_plus_by');
    expect(r!.hasLockVersion).toBe(false);
  });

  it('returns hasLockVersion=true when present', () => {
    const r = evaluateTable('foo', [
      'id',
      'signed_by_staff_id',
      'approved_by_staff_id',
      'lock_version',
    ]);
    expect(r!.hasLockVersion).toBe(true);
  });
});

describe('evaluateTable — TRIGGER B (status + state-transition + 1+ _by)', () => {
  it('flags 1 _by + status + 1 state-transition *_at', () => {
    const r = evaluateTable('foo', [
      'id',
      'created_by_id',
      'status',
      'approved_at',
    ]);
    expect(r).not.toBeNull();
    expect(r!.trigger).toBe('B_status_state_transition');
    expect(r!.byColumns).toEqual(['created_by_id']);
    expect(r!.stateTransitionColumns).toEqual(['approved_at']);
  });

  it('does NOT flag 1 _by alone (no status, no state-transition)', () => {
    expect(evaluateTable('foo', ['id', 'created_by_id'])).toBeNull();
  });

  it('does NOT flag 1 _by + status alone (no state-transition)', () => {
    expect(evaluateTable('foo', ['id', 'created_by_id', 'status'])).toBeNull();
  });

  it('does NOT flag 1 _by + state-transition alone (no status)', () => {
    expect(evaluateTable('foo', ['id', 'created_by_id', 'approved_at'])).toBeNull();
  });
});

describe('evaluateTable — TRIGGER C (canonical-locked-tables list)', () => {
  it('flags `prescriptions` regardless of column shape', () => {
    // Prescriptions only has 1 _by column; cycle-1 missed it.
    // Cycle-2 catches via name-list.
    const r = evaluateTable('prescriptions', ['id', 'prescribed_by_staff_id']);
    expect(r).not.toBeNull();
    expect(r!.trigger).toBe('C_canonical_list');
  });

  it('flags `treatment_pathways` even with 0 _by columns', () => {
    // BUG-402 protected; 0 _by columns yet IS multi-writer (milestones JSONB merge).
    const r = evaluateTable('treatment_pathways', ['id', 'milestones']);
    expect(r).not.toBeNull();
    expect(r!.trigger).toBe('C_canonical_list');
  });

  it('canonical list contains all 5 §1.6 tables', () => {
    expect(CANONICAL_LOCKED_TABLES).toContain('clinical_notes');
    expect(CANONICAL_LOCKED_TABLES).toContain('prescriptions');
    expect(CANONICAL_LOCKED_TABLES).toContain('patient_medications');
    expect(CANONICAL_LOCKED_TABLES).toContain('episodes');
    expect(CANONICAL_LOCKED_TABLES).toContain('treatment_pathways');
  });
});

describe('evaluateTable — NEGATIVE (single-writer)', () => {
  it('does NOT flag table with 0 _by columns + no canonical-list match', () => {
    expect(evaluateTable('foo', ['id', 'name'])).toBeNull();
  });

  it('does NOT flag table with 1 _by + no status + no state-transition', () => {
    expect(evaluateTable('foo', ['id', 'created_by_staff_id', 'name'])).toBeNull();
  });
});

// ── End-to-end runGuard() integration tests (cycle-2 absorb) ─────────

const TMP_BASE = join(tmpdir(), 'pr-r1-12-cycle2-fixtures');

beforeAll(() => {
  if (existsSync(TMP_BASE)) rmSync(TMP_BASE, { recursive: true, force: true });
  mkdirSync(TMP_BASE, { recursive: true });
});

afterAll(() => {
  if (existsSync(TMP_BASE)) rmSync(TMP_BASE, { recursive: true, force: true });
});

function writeFixture(name: string, snapshot: object, allowlist: string): {
  snapshotPath: string;
  allowlistPath: string;
} {
  const dir = join(TMP_BASE, name);
  mkdirSync(dir, { recursive: true });
  const snapshotPath = join(dir, 'snapshot.json');
  const allowlistPath = join(dir, 'allowlist.txt');
  writeFileSync(snapshotPath, JSON.stringify(snapshot, null, 2), 'utf-8');
  writeFileSync(allowlistPath, allowlist, 'utf-8');
  return { snapshotPath, allowlistPath };
}

describe('runGuard — end-to-end fixture tests (mutation-resistant)', () => {
  it('exit 1 on multi-writer table without lock_version', () => {
    const { snapshotPath, allowlistPath } = writeFixture(
      'multi_no_lock',
      {
        tables: {
          foo: ['id', 'signed_by_staff_id', 'approved_by_staff_id'],
        },
      },
      '',
    );
    const r = runGuard({ snapshotPath, allowlistPath });
    expect(r.exitCode).toBe(1);
    expect(r.violations).toHaveLength(1);
    expect(r.violations[0]!.table).toBe('foo');
  });

  it('exit 0 on multi-writer table WITH lock_version', () => {
    const { snapshotPath, allowlistPath } = writeFixture(
      'multi_with_lock',
      {
        tables: {
          foo: ['id', 'signed_by_staff_id', 'approved_by_staff_id', 'lock_version'],
        },
      },
      '',
    );
    const r = runGuard({ snapshotPath, allowlistPath });
    expect(r.exitCode).toBe(0);
    expect(r.violations).toHaveLength(0);
  });

  it('exit 0 on multi-writer table that is allowlisted', () => {
    const { snapshotPath, allowlistPath } = writeFixture(
      'multi_allowlisted',
      {
        tables: {
          foo: ['id', 'signed_by_staff_id', 'approved_by_staff_id'],
        },
      },
      'foo  # documented race-precluding reason',
    );
    const r = runGuard({ snapshotPath, allowlistPath });
    expect(r.exitCode).toBe(0);
    expect(r.violations).toHaveLength(0);
    expect(r.staleAllowlistEntries).toEqual([]);
  });

  it('exit 1 when allowlist entry is stale because lock_version exists', () => {
    const { snapshotPath, allowlistPath } = writeFixture(
      'stale_allowlist_has_lock',
      {
        tables: {
          foo: ['id', 'signed_by_staff_id', 'approved_by_staff_id', 'lock_version'],
        },
      },
      'foo  # stale now',
    );
    const r = runGuard({ snapshotPath, allowlistPath });
    expect(r.exitCode).toBe(1);
    expect(r.violations).toHaveLength(0);
    expect(r.staleAllowlistEntries).toHaveLength(1);
    expect(r.staleAllowlistEntries[0]).toContain('lock_version now present');
  });

  it('exit 1 on canonical-list table missing lock_version (TRIGGER C)', () => {
    const { snapshotPath, allowlistPath } = writeFixture(
      'canonical_no_lock',
      {
        tables: {
          // Synthetic — just named like a canonical table, missing lock_version
          prescriptions: ['id', 'prescribed_by_staff_id'],
        },
      },
      '',
    );
    const r = runGuard({ snapshotPath, allowlistPath });
    expect(r.exitCode).toBe(1);
    expect(r.violations[0]!.trigger).toBe('C_canonical_list');
  });

  it('exit 1 on TRIGGER B (status + state-transition + 1 _by)', () => {
    const { snapshotPath, allowlistPath } = writeFixture(
      'trigger_b',
      {
        tables: {
          foo: ['id', 'created_by_id', 'status', 'approved_at'],
        },
      },
      '',
    );
    const r = runGuard({ snapshotPath, allowlistPath });
    expect(r.exitCode).toBe(1);
    expect(r.violations[0]!.trigger).toBe('B_status_state_transition');
  });

  it('exit 0 on single-writer table (no triggers fire)', () => {
    const { snapshotPath, allowlistPath } = writeFixture(
      'single_writer',
      {
        tables: {
          foo: ['id', 'created_by_staff_id', 'name'],
        },
      },
      '',
    );
    const r = runGuard({ snapshotPath, allowlistPath });
    expect(r.exitCode).toBe(0);
  });

  it('exit 2 on missing snapshot file', () => {
    const r = runGuard({
      snapshotPath: join(TMP_BASE, 'nonexistent', 'snapshot.json'),
      allowlistPath: join(TMP_BASE, 'nonexistent', 'allowlist.txt'),
    });
    expect(r.exitCode).toBe(2);
    expect(r.parseErrors.length).toBeGreaterThan(0);
  });

  it('exit 1 on malformed allowlist line', () => {
    const { snapshotPath, allowlistPath } = writeFixture(
      'malformed_allowlist',
      {
        tables: { foo: ['id', 'created_by_id', 'updated_by_id'] },
      },
      'invalid spaces in name',
    );
    const r = runGuard({ snapshotPath, allowlistPath });
    expect(r.exitCode).toBe(1);
    expect(r.parseErrors.some((e) => e.includes('malformed'))).toBe(true);
  });
});

// ── Mutation-resistance verification ────────────────────────────────

describe('mutation-resistance binding', () => {
  it('runGuard returns DIFFERENT exit codes for trigger states', () => {
    // If main() / runGuard() were mutated to return 0 unconditionally,
    // this test pair would fail.
    const flagFixture = writeFixture(
      'mut_resistance_flag',
      { tables: { foo: ['id', 'a_by_id', 'b_by_id'] } },
      '',
    );
    const passFixture = writeFixture(
      'mut_resistance_pass',
      { tables: { foo: ['id', 'a_by_id', 'b_by_id', 'lock_version'] } },
      '',
    );
    const flagged = runGuard({
      snapshotPath: flagFixture.snapshotPath,
      allowlistPath: flagFixture.allowlistPath,
    });
    const passed = runGuard({
      snapshotPath: passFixture.snapshotPath,
      allowlistPath: passFixture.allowlistPath,
    });
    expect(flagged.exitCode).toBe(1);
    expect(passed.exitCode).toBe(0);
    expect(flagged.exitCode).not.toBe(passed.exitCode);
  });
});

// ── loadAllowlist tests ─────────────────────────────────────────────

describe('loadAllowlist', () => {
  it('parses valid table names', () => {
    const { allowlistPath } = writeFixture(
      'valid_allowlist',
      { tables: {} },
      `# header comment
foo  # reason 1
bar  # reason 2

baz_table_name  # reason 3
`,
    );
    const r = loadAllowlist(allowlistPath);
    expect(r.tables.has('foo')).toBe(true);
    expect(r.tables.has('bar')).toBe(true);
    expect(r.tables.has('baz_table_name')).toBe(true);
    expect(r.parseErrors).toEqual([]);
  });

  it('reports malformed entries', () => {
    const { allowlistPath } = writeFixture(
      'malformed',
      { tables: {} },
      `valid_table
INVALID-with-dashes  # reason
also_valid  # reason
`,
    );
    const r = loadAllowlist(allowlistPath);
    expect(r.tables.has('valid_table')).toBe(true);
    expect(r.tables.has('also_valid')).toBe(true);
    expect(r.parseErrors.length).toBe(1);
  });

  it('returns empty for missing file', () => {
    const r = loadAllowlist(join(TMP_BASE, 'nonexistent.txt'));
    expect(r.tables.size).toBe(0);
    expect(r.parseErrors).toEqual([]);
  });
});
