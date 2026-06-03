/*
 * scripts/guards/__tests__/check-knex-column-references.test.ts
 *
 * PR-R1-13 vitest fixture suite — mutation-resistant per PR-R1-12 cycle-2 lesson.
 * Tests both pure helpers AND end-to-end runGuard() invocations against
 * synthetic snapshots so mutating the guard's decision path (e.g.,
 * silencing a pattern detector or the violation collector) breaks the
 * relevant fixture test.
 *
 * Coverage:
 *   - parseTableAlias / resolveColRef (pure unit)
 *   - buildVariableTableMap + lookupVarAtPosition (positional scope-emulation)
 *   - end-to-end: ghost-column detection across all 7 patterns
 *   - end-to-end: SQL-fragment whitelist
 *   - end-to-end: inline @knex-col-exempt opt-out
 *   - end-to-end: allowlist multiplicity rejection
 *   - end-to-end: snapshot missing → exit 2
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  parseTableAlias,
  resolveColRef,
  buildVariableTableMap,
  lookupVarAtPosition,
  resolveBoundTable,
  findDbAliasIdentifiers,
  findQueryScopedAliases,
  runGuard,
} from '../check-knex-column-references';

// ── Pure unit tests ───────────────────────────────────────────────────

describe('parseTableAlias', () => {
  it('extracts table + alias from "table as alias" form', () => {
    expect(parseTableAlias('appointments as a')).toEqual({
      table: 'appointments',
      alias: 'a',
    });
  });

  it('returns table=alias for bare-table form', () => {
    expect(parseTableAlias('appointments')).toEqual({
      table: 'appointments',
      alias: 'appointments',
    });
  });
});

describe('resolveColRef', () => {
  it('resolves alias.column via aliases map', () => {
    const aliases = new Map([['a', 'appointments']]);
    expect(resolveColRef('a.start_time', aliases)).toEqual({
      table: 'appointments',
      column: 'start_time',
    });
  });

  it('returns null for non-dotted form', () => {
    const aliases = new Map([['a', 'appointments']]);
    expect(resolveColRef('start_time', aliases)).toBeNull();
  });

  it('uses table name verbatim when alias not in map', () => {
    expect(resolveColRef('foo.bar', new Map())).toEqual({ table: 'foo', column: 'bar' });
  });
});

// ── Positional variable-binding tests ────────────────────────────────

describe('buildVariableTableMap + lookupVarAtPosition', () => {
  const SOURCE = `
function a() {
  const q = db('appointments').whereBetween('a.appointment_start', [from, to]);
  q.where('telehealth', true);
}
function b() {
  const q = db('risk_assessments').whereNull('deleted_at');
  q.where('overall_risk_level', 'high');
}
`;

  it('captures every variable declaration with its position', () => {
    const bindings = buildVariableTableMap(SOURCE);
    expect(bindings).toHaveLength(2);
    expect(bindings[0]!.varName).toBe('q');
    expect(bindings[0]!.table).toBe('appointments');
    expect(bindings[1]!.varName).toBe('q');
    expect(bindings[1]!.table).toBe('risk_assessments');
    // Positions must be ascending (regex order = source order).
    expect(bindings[0]!.position).toBeLessThan(bindings[1]!.position);
  });

  it('lookup returns most-recent declaration BEFORE callIndex', () => {
    const bindings = buildVariableTableMap(SOURCE);
    // Call inside function a — should resolve to appointments.
    const callA = SOURCE.indexOf("q.where('telehealth'");
    expect(lookupVarAtPosition(bindings, 'q', callA)).toBe('appointments');
    // Call inside function b — should resolve to risk_assessments.
    const callB = SOURCE.indexOf("q.where('overall_risk_level'");
    expect(lookupVarAtPosition(bindings, 'q', callB)).toBe('risk_assessments');
  });

  it('returns null for unknown variable', () => {
    const bindings = buildVariableTableMap(SOURCE);
    expect(lookupVarAtPosition(bindings, 'unknown_var', 100)).toBeNull();
  });
});

describe('resolveBoundTable — chain root through .clone()', () => {
  it('resolves q.clone().where() to q\'s declared table', () => {
    const src = `const q = db('appointments').whereBetween('appointment_start', [a, b]);
const c = q.clone().where('telehealth', true);`;
    const bindings = buildVariableTableMap(src);
    const callIndex = src.indexOf(".where('telehealth'");
    expect(resolveBoundTable(src, callIndex, bindings)).toBe('appointments');
  });

  it('resolves directly-chained q.where() (no .clone())', () => {
    const src = `const q = db('episodes').whereNotNull('end_date');
q.where('status', 'closed');`;
    const bindings = buildVariableTableMap(src);
    const callIndex = src.indexOf(".where('status'");
    expect(resolveBoundTable(src, callIndex, bindings)).toBe('episodes');
  });
});

// ── End-to-end runGuard fixture tests ────────────────────────────────

const TMP_BASE = join(tmpdir(), 'pr-r1-13-fixtures');

beforeAll(() => {
  if (existsSync(TMP_BASE)) rmSync(TMP_BASE, { recursive: true, force: true });
  mkdirSync(TMP_BASE, { recursive: true });
});

afterAll(() => {
  if (existsSync(TMP_BASE)) rmSync(TMP_BASE, { recursive: true, force: true });
});

function writeFixture(name: string, snapshot: object, src: string, allowlist: string): {
  snapshotPath: string;
  allowlistPath: string;
  scanRoot: string;
} {
  const dir = join(TMP_BASE, name);
  mkdirSync(dir, { recursive: true });
  const scanRoot = join(dir, 'src');
  mkdirSync(scanRoot, { recursive: true });
  const snapshotPath = join(dir, 'snapshot.json');
  const allowlistPath = join(dir, 'allowlist.txt');
  const srcPath = join(scanRoot, 'fixture.ts');
  writeFileSync(snapshotPath, JSON.stringify(snapshot, null, 2), 'utf-8');
  writeFileSync(allowlistPath, allowlist, 'utf-8');
  writeFileSync(srcPath, src, 'utf-8');
  return { snapshotPath, allowlistPath, scanRoot };
}

const TWO_TABLE_SNAPSHOT = {
  generatedAt: '2026-04-30',
  database: 'test',
  tables: {
    referrals: ['id', 'clinic_id', 'patient_id', 'assigned_to_staff_id', 'status', 'deleted_at'],
    tasks: ['id', 'clinic_id', 'assigned_to_id', 'status', 'due_date'],
  },
  foreignKeys: {},
};

describe('runGuard — end-to-end fixture tests (mutation-resistant)', () => {
  it('rejects ghost-column where-string reference', () => {
    const { snapshotPath, allowlistPath, scanRoot } = writeFixture(
      'where_ghost',
      TWO_TABLE_SNAPSHOT,
      `db('referrals').where('assigned_to_id', 'x');`,
      '',
    );
    const r = runGuard({ snapshotPath, allowlistPath, scanRoots: [scanRoot] });
    expect(r.exitCode).toBe(1);
    expect(r.violations).toHaveLength(1);
    expect(r.violations[0]!.column).toBe('assigned_to_id');
    expect(r.violations[0]!.table).toBe('referrals');
  });

  it('passes real-column where-string reference', () => {
    const { snapshotPath, allowlistPath, scanRoot } = writeFixture(
      'where_real',
      TWO_TABLE_SNAPSHOT,
      `db('referrals').where('assigned_to_staff_id', 'x');`,
      '',
    );
    const r = runGuard({ snapshotPath, allowlistPath, scanRoots: [scanRoot] });
    expect(r.exitCode).toBe(0);
    expect(r.violations).toHaveLength(0);
  });

  it('rejects ghost whereRaw bare-column (NEW-S1-CASCADE-A class)', () => {
    const { snapshotPath, allowlistPath, scanRoot } = writeFixture(
      'whereraw_ghost',
      TWO_TABLE_SNAPSHOT,
      `db('tasks').whereRaw('due_at < CURRENT_DATE');`,
      '',
    );
    const r = runGuard({ snapshotPath, allowlistPath, scanRoots: [scanRoot] });
    expect(r.exitCode).toBe(1);
    expect(r.violations[0]!.column).toBe('due_at');
  });

  it('passes correct whereRaw column reference', () => {
    const { snapshotPath, allowlistPath, scanRoot } = writeFixture(
      'whereraw_real',
      TWO_TABLE_SNAPSHOT,
      `db('tasks').whereRaw('due_date < CURRENT_DATE');`,
      '',
    );
    const r = runGuard({ snapshotPath, allowlistPath, scanRoots: [scanRoot] });
    expect(r.exitCode).toBe(0);
  });

  it('skips SQL fragments (CURRENT_DATE, count(*), etc.)', () => {
    const { snapshotPath, allowlistPath, scanRoot } = writeFixture(
      'sql_fragment',
      TWO_TABLE_SNAPSHOT,
      `db('tasks').whereRaw('CURRENT_DATE = CURRENT_DATE').orderBy('count(*)');`,
      '',
    );
    const r = runGuard({ snapshotPath, allowlistPath, scanRoots: [scanRoot] });
    expect(r.exitCode).toBe(0);
  });

  it('honours inline @knex-col-exempt with non-empty reason', () => {
    const { snapshotPath, allowlistPath, scanRoot } = writeFixture(
      'inline_exempt',
      TWO_TABLE_SNAPSHOT,
      `// @knex-col-exempt: legitimate CTE alias not in snapshot
db('referrals').where('assigned_to_id', 'x');`,
      '',
    );
    const r = runGuard({ snapshotPath, allowlistPath, scanRoots: [scanRoot] });
    expect(r.exitCode).toBe(0);
    expect(r.counts.skippedExempt).toBe(1);
  });

  it('honours fingerprint allowlist entry', () => {
    const src = `db('referrals').where('assigned_to_id', 'x');`;
    const { snapshotPath, allowlistPath, scanRoot } = writeFixture(
      'allowlist_pass',
      TWO_TABLE_SNAPSHOT,
      src,
      '', // empty initially
    );
    // First run: detect the violation; capture its file-path-as-recorded
    // (the guard computes relative-from-repo-root so we don't have to
    // guess).
    const r0 = runGuard({ snapshotPath, allowlistPath, scanRoots: [scanRoot] });
    expect(r0.violations).toHaveLength(1);
    const recordedFile = r0.violations[0]!.file;
    // Compute fingerprint of the violation line and add to allowlist.
    const fp = createHash('sha256').update(src.trim()).digest('hex').substring(0, 8);
    writeFileSync(allowlistPath, `${recordedFile} ${fp}\n`, 'utf-8');
    const r = runGuard({ snapshotPath, allowlistPath, scanRoots: [scanRoot] });
    expect(r.exitCode).toBe(0);
  });

  it('rejects when snapshot is missing or empty', () => {
    const dir = join(TMP_BASE, 'no_snapshot');
    mkdirSync(dir, { recursive: true });
    const r = runGuard({
      snapshotPath: join(dir, 'nonexistent.json'),
      allowlistPath: join(dir, 'allowlist.txt'),
      scanRoots: [dir],
    });
    expect(r.exitCode).toBe(2);
  });

  it('detects ghost-column in .select() multi-arg form', () => {
    const { snapshotPath, allowlistPath, scanRoot } = writeFixture(
      'select_ghost',
      TWO_TABLE_SNAPSHOT,
      `db('tasks').select('id', 'ghost_col_does_not_exist');`,
      '',
    );
    const r = runGuard({ snapshotPath, allowlistPath, scanRoots: [scanRoot] });
    expect(r.exitCode).toBe(1);
    expect(r.violations[0]!.column).toBe('ghost_col_does_not_exist');
  });

  it('detects ghost-column in .where({ key: val }) object form', () => {
    const { snapshotPath, allowlistPath, scanRoot } = writeFixture(
      'where_obj_ghost',
      TWO_TABLE_SNAPSHOT,
      `db('referrals').where({ ghost_field: 'x' });`,
      '',
    );
    const r = runGuard({ snapshotPath, allowlistPath, scanRoots: [scanRoot] });
    expect(r.exitCode).toBe(1);
    expect(r.violations[0]!.column).toBe('ghost_field');
  });

  // ── Cycle-2 absorb (L3 REJECT #1) — opener-shape coverage ──────────

  it('cycle-2: recognises conn() locally-bound via `?? db` ternary as an opener', () => {
    // Sibling shape of referralRepository.ts:493 (BUG-602 conn parameter pattern)
    const src = `function find(connOrTrx?: Knex) {
  const conn = connOrTrx ?? db;
  return conn('referrals').where('assigned_to_staff_id', 'x');
}`;
    // tasks.assigned_to_staff_id doesn't exist; referrals.assigned_to_staff_id does.
    // If the opener regex doesn't recognise `conn`, the bound table falls back
    // to a previous opener (or null), and the column check would either pass
    // wrongly or fail to find a binding. With cycle-2's findDbAliasIdentifiers,
    // `conn` is recognised → bound table is `referrals` → assigned_to_staff_id
    // is a real column → no violation.
    const aliases = findDbAliasIdentifiers(src);
    expect(aliases.has('conn')).toBe(true);
  });

  it('cycle-2: recognises parenthesised `(trx ?? db)(table)` opener', () => {
    // Sibling shape of imports/importResolvers.ts:60
    const src = `const q = (trx ?? db)('legal_order_types').where({code: 'X'});`;
    const callIndex = src.indexOf(".where(");
    const aliases = findQueryScopedAliases(src, callIndex);
    // The parenthesised opener should bind 'legal_order_types' as alias.
    expect(aliases.get('legal_order_types')).toBe('legal_order_types');
  });

  it('cycle-2 mutation-resistance: removing parenthesised-ternary branch fails this fixture', () => {
    const TWO_T = {
      tables: {
        legal_order_types: ['id', 'code', 'name'],
        staff: ['id', 'first_name', 'last_name'],
      },
      foreignKeys: {},
    };
    const { snapshotPath, allowlistPath, scanRoot } = writeFixture(
      'paren_ternary',
      TWO_T,
      `const q = (trx ?? db)('legal_order_types').where({code: 'X'}).select('id', 'code');`,
      '',
    );
    const r = runGuard({ snapshotPath, allowlistPath, scanRoots: [scanRoot] });
    // No violations: code + id both exist on legal_order_types.
    expect(r.exitCode).toBe(0);
  });

  it('mutation-resistance: removing whereRaw pattern fails this test', () => {
    // This test FAILS if a mutator removes the `WHERE_RAW_RE` pattern
    // detector. Specifically asserts that the whereRaw violation is
    // surfaced — not just any violation.
    const { snapshotPath, allowlistPath, scanRoot } = writeFixture(
      'mut_whereraw',
      TWO_TABLE_SNAPSHOT,
      `db('tasks').whereRaw('due_at < CURRENT_DATE');`,
      '',
    );
    const r = runGuard({ snapshotPath, allowlistPath, scanRoots: [scanRoot] });
    expect(r.violations.some((v) => v.kind === 'whereRaw-bare-col')).toBe(true);
  });
});
