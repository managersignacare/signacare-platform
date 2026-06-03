/*
 * scripts/guards/__tests__/check-soft-delete-filter.test.ts
 *
 * PR-R1-14 vitest fixture suite — mutation-resistant per PR-R1-12 / PR-R1-13
 * cycle-2 lessons. Tests both pure helpers AND end-to-end runGuard()
 * invocations.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdirSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runGuard, findDbAliasIdentifiers } from '../check-soft-delete-filter';

describe('findDbAliasIdentifiers', () => {
  it('captures locally-bound db-aliases', () => {
    const src = `const conn = connOrTrx ?? db;\nconst foo = bar ?? dbRead;`;
    const aliases = findDbAliasIdentifiers(src);
    expect(aliases.has('conn')).toBe(true);
    expect(aliases.has('foo')).toBe(true);
  });
});

const TMP_BASE = join(tmpdir(), 'pr-r1-14-fixtures');

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

const SNAPSHOT_WITH = {
  generatedAt: '2026-05-01',
  database: 'test',
  tables: {
    episodes: ['id', 'patient_id', 'clinic_id', 'status', 'deleted_at'],
    appointment_modes: ['id', 'name'], // no deleted_at — out of scope
  },
  foreignKeys: {},
};

describe('runGuard — soft-delete filter discipline', () => {
  it('REJECTs SELECT chain on WITH-deleted_at table without filter', () => {
    const { snapshotPath, allowlistPath, scanRoot } = writeFixture(
      'select_no_filter',
      SNAPSHOT_WITH,
      `db('episodes').where({ patient_id: 'x' }).first();`,
      '',
    );
    const r = runGuard({ snapshotPath, allowlistPath, scanRoots: [scanRoot] });
    expect(r.exitCode).toBe(1);
    expect(r.violations).toHaveLength(1);
    expect(r.violations[0]!.table).toBe('episodes');
  });

  it('PASSES SELECT chain WITH .whereNull(deleted_at)', () => {
    const { snapshotPath, allowlistPath, scanRoot } = writeFixture(
      'select_with_filter',
      SNAPSHOT_WITH,
      `db('episodes').where({ patient_id: 'x' }).whereNull('deleted_at').first();`,
      '',
    );
    const r = runGuard({ snapshotPath, allowlistPath, scanRoots: [scanRoot] });
    expect(r.exitCode).toBe(0);
  });

  it('PASSES SELECT chain WITH .whereNull(alias.deleted_at)', () => {
    const { snapshotPath, allowlistPath, scanRoot } = writeFixture(
      'select_with_aliased_filter',
      SNAPSHOT_WITH,
      `db('episodes as e').where('e.patient_id', 'x').whereNull('e.deleted_at').first();`,
      '',
    );
    const r = runGuard({ snapshotPath, allowlistPath, scanRoots: [scanRoot] });
    expect(r.exitCode).toBe(0);
  });

  it('SKIPs UPDATE chain (out of scope)', () => {
    const { snapshotPath, allowlistPath, scanRoot } = writeFixture(
      'update_no_filter',
      SNAPSHOT_WITH,
      `db('episodes').where({ id: 'x' }).update({ status: 'closed' });`,
      '',
    );
    const r = runGuard({ snapshotPath, allowlistPath, scanRoots: [scanRoot] });
    expect(r.exitCode).toBe(0);
  });

  it('SKIPs DELETE chain (out of scope)', () => {
    const { snapshotPath, allowlistPath, scanRoot } = writeFixture(
      'delete_chain',
      SNAPSHOT_WITH,
      `db('episodes').where({ id: 'x' }).del();`,
      '',
    );
    const r = runGuard({ snapshotPath, allowlistPath, scanRoots: [scanRoot] });
    expect(r.exitCode).toBe(0);
  });

  it('SKIPs INSERT chain (out of scope)', () => {
    const { snapshotPath, allowlistPath, scanRoot } = writeFixture(
      'insert_chain',
      SNAPSHOT_WITH,
      `db('episodes').insert({ patient_id: 'x', clinic_id: 'c' });`,
      '',
    );
    const r = runGuard({ snapshotPath, allowlistPath, scanRoots: [scanRoot] });
    expect(r.exitCode).toBe(0);
  });

  it('SKIPs tables WITHOUT deleted_at (PR-R1-13 catches false-presence; out of scope here)', () => {
    const { snapshotPath, allowlistPath, scanRoot } = writeFixture(
      'no_deleted_at',
      SNAPSHOT_WITH,
      `db('appointment_modes').where({ name: 'x' }).first();`,
      '',
    );
    const r = runGuard({ snapshotPath, allowlistPath, scanRoots: [scanRoot] });
    expect(r.exitCode).toBe(0);
  });

  it('honours inline @soft-delete-exempt with non-empty reason', () => {
    const { snapshotPath, allowlistPath, scanRoot } = writeFixture(
      'inline_exempt',
      SNAPSHOT_WITH,
      `// @soft-delete-exempt: admin recovery view intentionally includes soft-deleted records
db('episodes').where({ id: 'x' }).first();`,
      '',
    );
    const r = runGuard({ snapshotPath, allowlistPath, scanRoots: [scanRoot] });
    expect(r.exitCode).toBe(0);
    expect(r.counts.skippedExempt).toBe(1);
  });

  it('PASSES whereRaw with deleted_at IS NULL', () => {
    const { snapshotPath, allowlistPath, scanRoot } = writeFixture(
      'whereraw_filter',
      SNAPSHOT_WITH,
      `db('episodes').whereRaw('deleted_at IS NULL').first();`,
      '',
    );
    const r = runGuard({ snapshotPath, allowlistPath, scanRoots: [scanRoot] });
    expect(r.exitCode).toBe(0);
  });

  it('PASSES whereNotNull(deleted_at) — audit/admin "only deleted" intent', () => {
    const { snapshotPath, allowlistPath, scanRoot } = writeFixture(
      'wherenotnull_filter',
      SNAPSHOT_WITH,
      `db('episodes').whereNotNull('deleted_at').first();`,
      '',
    );
    const r = runGuard({ snapshotPath, allowlistPath, scanRoots: [scanRoot] });
    expect(r.exitCode).toBe(0);
  });

  it('rejects when snapshot is missing', () => {
    const dir = join(TMP_BASE, 'no_snapshot');
    mkdirSync(dir, { recursive: true });
    const r = runGuard({
      snapshotPath: join(dir, 'nonexistent.json'),
      allowlistPath: join(dir, 'allowlist.txt'),
      scanRoots: [dir],
    });
    expect(r.exitCode).toBe(2);
  });

  it('mutation-resistance: removing isSelectListChain check fails this fixture', () => {
    // If isSelectListChain returns true for everything (mutation), UPDATE
    // chains would surface as violations. This fixture confirms the
    // UPDATE-skip path works.
    const { snapshotPath, allowlistPath, scanRoot } = writeFixture(
      'mut_update_skip',
      SNAPSHOT_WITH,
      `db('episodes').where({ id: 'x' }).update({ status: 'closed' });`,
      '',
    );
    const r = runGuard({ snapshotPath, allowlistPath, scanRoots: [scanRoot] });
    expect(r.violations).toHaveLength(0); // UPDATE properly skipped
  });
});
