/*
 * scripts/guards/__tests__/check-empty-where-on-mutation.test.ts
 *
 * PR-R1-15 vitest fixture suite — mutation-resistant.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdirSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runGuard, findDbAliasIdentifiers } from '../check-empty-where-on-mutation';

describe('findDbAliasIdentifiers', () => {
  it('captures `?? db` ternary aliases', () => {
    const aliases = findDbAliasIdentifiers(`const conn = trx ?? db;`);
    expect(aliases.has('conn')).toBe(true);
  });
});

const TMP_BASE = join(tmpdir(), 'pr-r1-15-fixtures');

beforeAll(() => {
  if (existsSync(TMP_BASE)) rmSync(TMP_BASE, { recursive: true, force: true });
  mkdirSync(TMP_BASE, { recursive: true });
});

afterAll(() => {
  if (existsSync(TMP_BASE)) rmSync(TMP_BASE, { recursive: true, force: true });
});

function writeFixture(name: string, src: string, allowlist: string): {
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
  writeFileSync(snapshotPath, JSON.stringify({
    generatedAt: '2026-05-01',
    database: 'test',
    tables: { foo: ['id', 'name'], bar: ['id', 'value'] },
    foreignKeys: {},
  }), 'utf-8');
  writeFileSync(allowlistPath, allowlist, 'utf-8');
  writeFileSync(srcPath, src, 'utf-8');
  return { snapshotPath, allowlistPath, scanRoot };
}

describe('runGuard — empty-WHERE on mutation', () => {
  it('REJECTs UPDATE chain with no .where clause', () => {
    const { snapshotPath, allowlistPath, scanRoot } = writeFixture(
      'update_no_where',
      `db('foo').update({ name: 'x' });`,
      '',
    );
    const r = runGuard({ snapshotPath, allowlistPath, scanRoots: [scanRoot] });
    expect(r.exitCode).toBe(1);
    expect(r.violations).toHaveLength(1);
    expect(r.violations[0]!.mutationKind).toBe('update');
    expect(r.violations[0]!.table).toBe('foo');
  });

  it('REJECTs DELETE chain with no .where clause', () => {
    const { snapshotPath, allowlistPath, scanRoot } = writeFixture(
      'delete_no_where',
      `db('foo').delete();`,
      '',
    );
    const r = runGuard({ snapshotPath, allowlistPath, scanRoots: [scanRoot] });
    expect(r.exitCode).toBe(1);
    expect(r.violations[0]!.mutationKind).toBe('delete');
  });

  it('REJECTs .del() chain with no .where clause', () => {
    const { snapshotPath, allowlistPath, scanRoot } = writeFixture(
      'del_no_where',
      `db('foo').del();`,
      '',
    );
    const r = runGuard({ snapshotPath, allowlistPath, scanRoots: [scanRoot] });
    expect(r.exitCode).toBe(1);
    expect(r.violations[0]!.mutationKind).toBe('del');
  });

  it('PASSES UPDATE chain with .where()', () => {
    const { snapshotPath, allowlistPath, scanRoot } = writeFixture(
      'update_with_where',
      `db('foo').where({ id: 'x' }).update({ name: 'y' });`,
      '',
    );
    const r = runGuard({ snapshotPath, allowlistPath, scanRoots: [scanRoot] });
    expect(r.exitCode).toBe(0);
  });

  it('PASSES DELETE chain with .whereIn()', () => {
    const { snapshotPath, allowlistPath, scanRoot } = writeFixture(
      'delete_with_wherein',
      `db('foo').whereIn('id', ['a', 'b']).delete();`,
      '',
    );
    const r = runGuard({ snapshotPath, allowlistPath, scanRoots: [scanRoot] });
    expect(r.exitCode).toBe(0);
  });

  it('PASSES UPDATE chain with .whereRaw()', () => {
    const { snapshotPath, allowlistPath, scanRoot } = writeFixture(
      'update_with_whereraw',
      `db('foo').whereRaw('id = ?', ['x']).update({ name: 'y' });`,
      '',
    );
    const r = runGuard({ snapshotPath, allowlistPath, scanRoots: [scanRoot] });
    expect(r.exitCode).toBe(0);
  });

  it('SKIPs SELECT chain (no mutation)', () => {
    const { snapshotPath, allowlistPath, scanRoot } = writeFixture(
      'select_chain',
      `db('foo').select('*');`,
      '',
    );
    const r = runGuard({ snapshotPath, allowlistPath, scanRoots: [scanRoot] });
    expect(r.exitCode).toBe(0);
    expect(r.counts.skippedNoMutation).toBeGreaterThan(0);
  });

  it('SKIPs INSERT chain', () => {
    const { snapshotPath, allowlistPath, scanRoot } = writeFixture(
      'insert_chain',
      `db('foo').insert({ name: 'x' });`,
      '',
    );
    const r = runGuard({ snapshotPath, allowlistPath, scanRoots: [scanRoot] });
    expect(r.exitCode).toBe(0);
  });

  it('honours inline @empty-where-exempt with non-empty reason', () => {
    const { snapshotPath, allowlistPath, scanRoot } = writeFixture(
      'inline_exempt',
      `// @empty-where-exempt: factory-reset admin flow with explicit confirmation
db('foo').delete();`,
      '',
    );
    const r = runGuard({ snapshotPath, allowlistPath, scanRoots: [scanRoot] });
    expect(r.exitCode).toBe(0);
    expect(r.counts.skippedExempt).toBe(1);
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

  it('mutation-resistance: removing HAS_WHERE_RE check fails this fixture', () => {
    // If HAS_WHERE_RE always returns true (mutation), the UPDATE-no-where
    // case would PASS. This fixture verifies the regex correctly detects absence.
    const { snapshotPath, allowlistPath, scanRoot } = writeFixture(
      'mut_has_where',
      `db('foo').update({ name: 'x' });`,
      '',
    );
    const r = runGuard({ snapshotPath, allowlistPath, scanRoots: [scanRoot] });
    expect(r.violations).toHaveLength(1);
  });

  it('PASSES function-style chained .where(builder)', () => {
    const { snapshotPath, allowlistPath, scanRoot } = writeFixture(
      'where_function',
      `db('foo').where(function () { this.where('id', 'x') }).update({ name: 'y' });`,
      '',
    );
    const r = runGuard({ snapshotPath, allowlistPath, scanRoots: [scanRoot] });
    expect(r.exitCode).toBe(0);
  });
});
