/* PR-R1-18 vitest fixture suite. */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdirSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runGuard } from '../check-safety-surface-audit-log';

const TMP_BASE = join(tmpdir(), 'pr-r1-18-fixtures');

beforeAll(() => {
  if (existsSync(TMP_BASE)) rmSync(TMP_BASE, { recursive: true, force: true });
  mkdirSync(TMP_BASE, { recursive: true });
});

afterAll(() => {
  if (existsSync(TMP_BASE)) rmSync(TMP_BASE, { recursive: true, force: true });
});

const SNAPSHOT = JSON.stringify({
  generatedAt: '2026-05-01',
  database: 'test',
  tables: { foo: ['id'] },
  foreignKeys: {},
}, null, 2);

function writeFixture(name: string, serviceContent: string): {
  snapshotPath: string;
  allowlistPath: string;
  serviceFiles: string[];
} {
  const dir = join(TMP_BASE, name);
  mkdirSync(dir, { recursive: true });
  const snapshotPath = join(dir, 'snapshot.json');
  const allowlistPath = join(dir, 'allowlist.txt');
  const serviceFile = join(dir, 'service.ts');
  writeFileSync(snapshotPath, SNAPSHOT, 'utf-8');
  writeFileSync(allowlistPath, '', 'utf-8');
  writeFileSync(serviceFile, serviceContent, 'utf-8');
  return { snapshotPath, allowlistPath, serviceFiles: [serviceFile] };
}

describe('runGuard — safety-surface audit-log discipline', () => {
  it('REJECTs mutation method without writeAuditLog', () => {
    const { snapshotPath, allowlistPath, serviceFiles } = writeFixture(
      'mutation_no_audit',
      `export const fooService = {
  async create(auth, dto) {
    return await db('foo').insert(dto);
  },
};`,
    );
    const r = runGuard({ snapshotPath, allowlistPath, serviceFiles });
    expect(r.exitCode).toBe(1);
    expect(r.violations[0]!.method).toBe('create');
  });

  it('PASSES mutation method WITH writeAuditLog', () => {
    const { snapshotPath, allowlistPath, serviceFiles } = writeFixture(
      'mutation_with_audit',
      `export const fooService = {
  async create(auth, dto) {
    const result = await db('foo').insert(dto);
    await writeAuditLog({ auth, action: 'FOO_CREATE' });
    return result;
  },
};`,
    );
    const r = runGuard({ snapshotPath, allowlistPath, serviceFiles });
    expect(r.exitCode).toBe(0);
  });

  it('SKIPs read-only methods (getX / listX / findX / countX)', () => {
    const { snapshotPath, allowlistPath, serviceFiles } = writeFixture(
      'read_methods',
      `export const fooService = {
  async getById(auth, id) { return db('foo').first(); },
  async listByPatient(auth, p) { return db('foo').select(); },
  async countActive(auth) { return db('foo').count(); },
  async findByCode(auth, c) { return db('foo').first(); },
};`,
    );
    const r = runGuard({ snapshotPath, allowlistPath, serviceFiles });
    expect(r.exitCode).toBe(0);
    expect(r.counts.skippedReads).toBeGreaterThanOrEqual(4);
  });

  it('REJECTs multiple missing audit calls', () => {
    const { snapshotPath, allowlistPath, serviceFiles } = writeFixture(
      'multi_missing',
      `export const fooService = {
  async create(auth, dto) { return db('foo').insert(dto); },
  async update(auth, id, p) { return db('foo').where({id}).update(p); },
  async softDelete(auth, id) { return db('foo').where({id}).update({ deleted_at: new Date() }); },
};`,
    );
    const r = runGuard({ snapshotPath, allowlistPath, serviceFiles });
    expect(r.exitCode).toBe(1);
    expect(r.violations).toHaveLength(3);
  });

  it('honours inline @audit-log-exempt with non-empty reason', () => {
    const { snapshotPath, allowlistPath, serviceFiles } = writeFixture(
      'inline_exempt',
      `export const fooService = {
  // @audit-log-exempt: ephemeral cache-clear; no clinical data touched
  async create(auth, dto) { return cache.clear(); },
};`,
    );
    const r = runGuard({ snapshotPath, allowlistPath, serviceFiles });
    expect(r.exitCode).toBe(0);
    expect(r.counts.skippedExempt).toBe(1);
  });

  it('rejects when snapshot is missing', () => {
    const dir = join(TMP_BASE, 'no_snapshot');
    mkdirSync(dir, { recursive: true });
    const r = runGuard({
      snapshotPath: join(dir, 'nonexistent.json'),
      allowlistPath: join(dir, 'allowlist.txt'),
      serviceFiles: [],
    });
    expect(r.exitCode).toBe(2);
  });

  it('correctly resolves line number across blank lines (regex bug fix)', () => {
    // Cycle-1 absorb: \s{2,4} was matching \n + spaces, putting m.index
    // on the BLANK line before the method. Fixed to [ \t]{2,4}.
    const { snapshotPath, allowlistPath, serviceFiles } = writeFixture(
      'blank_line_before_method',
      `export const fooService = {
  async first(auth) {
    return db('foo').first();

    // (blank line above on purpose)
  },

  async create(auth) {
    return db('foo').insert({});
  },
};`,
    );
    const r = runGuard({ snapshotPath, allowlistPath, serviceFiles });
    // The `create` method on line 8 should be flagged; line number must be 8 not 7.
    const createV = r.violations.find((v) => v.method === 'create');
    expect(createV).toBeDefined();
    expect(createV!.lineNo).toBe(8);
  });

  it('mutation-resistance: removing writeAuditLog detection fails this fixture', () => {
    const { snapshotPath, allowlistPath, serviceFiles } = writeFixture(
      'mut_audit_detect',
      `export const fooService = {
  async create(auth, dto) {
    return db('foo').insert(dto);
  },
};`,
    );
    const r = runGuard({ snapshotPath, allowlistPath, serviceFiles });
    expect(r.violations).toHaveLength(1);
  });

  it('handles arrow-function property syntax', () => {
    const { snapshotPath, allowlistPath, serviceFiles } = writeFixture(
      'arrow_property',
      `export const fooService = {
  create: async (auth, dto) => {
    await writeAuditLog({});
    return dto;
  },
};`,
    );
    const r = runGuard({ snapshotPath, allowlistPath, serviceFiles });
    expect(r.exitCode).toBe(0);
  });
});
