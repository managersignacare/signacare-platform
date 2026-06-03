/*
 * scripts/guards/__tests__/check-migration-rls-policy.test.ts
 *
 * PR-R1-17 vitest fixture suite — mutation-resistant.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdirSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runGuard } from '../check-migration-rls-policy';

const TMP_BASE = join(tmpdir(), 'pr-r1-17-fixtures');

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

function writeFixture(name: string, migration: string): {
  snapshotPath: string;
  allowlistPath: string;
  migrationsDir: string;
} {
  const dir = join(TMP_BASE, name);
  mkdirSync(dir, { recursive: true });
  const migrationsDir = join(dir, 'migrations');
  mkdirSync(migrationsDir, { recursive: true });
  const snapshotPath = join(dir, 'snapshot.json');
  const allowlistPath = join(dir, 'allowlist.txt');
  writeFileSync(snapshotPath, SNAPSHOT, 'utf-8');
  writeFileSync(allowlistPath, '', 'utf-8');
  writeFileSync(join(migrationsDir, '20260501000001_test.ts'), migration, 'utf-8');
  return { snapshotPath, allowlistPath, migrationsDir };
}

describe('runGuard — migration-rls-policy', () => {
  it('REJECTs clinic_id table with NO RLS / NO POLICY', () => {
    const { snapshotPath, allowlistPath, migrationsDir } = writeFixture(
      'no_rls_no_policy',
      `import { Knex } from 'knex';
export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable('foo', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.uuid('clinic_id').notNullable();
    t.index(['clinic_id']);
  });
}
export async function down() {}`,
    );
    const r = runGuard({ snapshotPath, allowlistPath, migrationsDir });
    expect(r.exitCode).toBe(1);
    expect(r.violations[0]!.missing).toBe('both');
  });

  it('REJECTs clinic_id table with ENABLE RLS but NO POLICY', () => {
    const { snapshotPath, allowlistPath, migrationsDir } = writeFixture(
      'rls_only',
      `import { Knex } from 'knex';
export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable('foo', (t) => {
    t.uuid('clinic_id').notNullable();
  });
  await knex.raw(\`ALTER TABLE foo ENABLE ROW LEVEL SECURITY\`);
}
export async function down() {}`,
    );
    const r = runGuard({ snapshotPath, allowlistPath, migrationsDir });
    expect(r.exitCode).toBe(1);
    expect(r.violations[0]!.missing).toBe('create-policy');
  });

  it('REJECTs clinic_id table with POLICY but NO ENABLE RLS', () => {
    const { snapshotPath, allowlistPath, migrationsDir } = writeFixture(
      'policy_only',
      `import { Knex } from 'knex';
export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable('foo', (t) => {
    t.uuid('clinic_id').notNullable();
  });
  await knex.raw(\`CREATE POLICY rls_foo_tenant ON foo FOR ALL USING (clinic_id = current_setting('app.clinic_id', true)::uuid)\`);
}
export async function down() {}`,
    );
    const r = runGuard({ snapshotPath, allowlistPath, migrationsDir });
    expect(r.exitCode).toBe(1);
    expect(r.violations[0]!.missing).toBe('enable-rls');
  });

  it('PASSES clinic_id table with both ENABLE RLS + CREATE POLICY', () => {
    const { snapshotPath, allowlistPath, migrationsDir } = writeFixture(
      'both_present',
      `import { Knex } from 'knex';
export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable('foo', (t) => {
    t.uuid('clinic_id').notNullable();
  });
  await knex.raw(\`
    ALTER TABLE foo ENABLE ROW LEVEL SECURITY;
    CREATE POLICY rls_foo_tenant ON foo FOR ALL USING (clinic_id = current_setting('app.clinic_id', true)::uuid);
  \`);
}
export async function down() {}`,
    );
    const r = runGuard({ snapshotPath, allowlistPath, migrationsDir });
    expect(r.exitCode).toBe(0);
  });

  it('SKIPs tables WITHOUT clinic_id (out of scope)', () => {
    const { snapshotPath, allowlistPath, migrationsDir } = writeFixture(
      'no_clinic_id',
      `import { Knex } from 'knex';
export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable('lookup', (t) => {
    t.string('code', 10).primary();
    t.string('label');
  });
}
export async function down() {}`,
    );
    const r = runGuard({ snapshotPath, allowlistPath, migrationsDir });
    expect(r.exitCode).toBe(0);
    expect(r.counts.skippedNoClinicId).toBeGreaterThan(0);
  });

  it('SKIPs squashed-baseline files', () => {
    const { snapshotPath, allowlistPath, migrationsDir } = writeFixture(
      'squashed',
      `// @migration-squashed-baseline
import { Knex } from 'knex';
export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable('foo', (t) => {
    t.uuid('clinic_id').notNullable();
  });
}
export async function down() {}`,
    );
    const r = runGuard({ snapshotPath, allowlistPath, migrationsDir });
    expect(r.exitCode).toBe(0);
    expect(r.counts.skippedSquashed).toBe(1);
  });

  it('honours inline @migration-rls-exempt', () => {
    const { snapshotPath, allowlistPath, migrationsDir } = writeFixture(
      'inline_exempt',
      `import { Knex } from 'knex';
export async function up(knex: Knex): Promise<void> {
  // @migration-rls-exempt: clinic_id is a coincidental column name; this is a global config table
  await knex.schema.createTable('global_config', (t) => {
    t.uuid('clinic_id');
    t.string('key');
  });
}
export async function down() {}`,
    );
    const r = runGuard({ snapshotPath, allowlistPath, migrationsDir });
    expect(r.exitCode).toBe(0);
    expect(r.counts.skippedExempt).toBe(1);
  });

  it('rejects when snapshot is missing', () => {
    const dir = join(TMP_BASE, 'no_snapshot');
    mkdirSync(dir, { recursive: true });
    mkdirSync(join(dir, 'migrations'), { recursive: true });
    const r = runGuard({
      snapshotPath: join(dir, 'nonexistent.json'),
      allowlistPath: join(dir, 'allowlist.txt'),
      migrationsDir: join(dir, 'migrations'),
    });
    expect(r.exitCode).toBe(2);
  });

  it('mutation-resistance: removing fileEnablesRlsForTable check fails this fixture', () => {
    // If fileEnablesRlsForTable always returns true (mutation), the
    // policy_only fixture would PASS. This explicit fixture confirms
    // the check correctly detects absence.
    const { snapshotPath, allowlistPath, migrationsDir } = writeFixture(
      'mut_no_enable',
      `import { Knex } from 'knex';
export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable('foo', (t) => {
    t.uuid('clinic_id').notNullable();
  });
  await knex.raw(\`CREATE POLICY rls_foo_tenant ON foo FOR ALL USING (true)\`);
}
export async function down() {}`,
    );
    const r = runGuard({ snapshotPath, allowlistPath, migrationsDir });
    expect(r.violations).toHaveLength(1);
    expect(r.violations[0]!.missing).toBe('enable-rls');
  });
});
