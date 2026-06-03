/*
 * scripts/guards/__tests__/check-migration-index-discipline.test.ts
 *
 * PR-R1-16 vitest fixture suite — mutation-resistant.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdirSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runGuard } from '../check-migration-index-discipline';

const TMP_BASE = join(tmpdir(), 'pr-r1-16-fixtures');

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

function writeFixture(name: string, migration: string, allowlist: string): {
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
  const migrationPath = join(migrationsDir, '20260501000001_test.ts');
  writeFileSync(snapshotPath, SNAPSHOT, 'utf-8');
  writeFileSync(allowlistPath, allowlist, 'utf-8');
  writeFileSync(migrationPath, migration, 'utf-8');
  return { snapshotPath, allowlistPath, migrationsDir };
}

describe('runGuard — migration-index-discipline', () => {
  it('REJECTs FK column without t.index', () => {
    const { snapshotPath, allowlistPath, migrationsDir } = writeFixture(
      'fk_no_index',
      `import { Knex } from 'knex';
export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable('orders', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.uuid('customer_id').notNullable().references('id').inTable('customers');
  });
}
export async function down() {}`,
      '',
    );
    const r = runGuard({ snapshotPath, allowlistPath, migrationsDir });
    expect(r.exitCode).toBe(1);
    expect(r.violations[0]!.column).toBe('customer_id');
  });

  it('PASSES FK column WITH t.index', () => {
    const { snapshotPath, allowlistPath, migrationsDir } = writeFixture(
      'fk_with_index',
      `import { Knex } from 'knex';
export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable('orders', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.uuid('customer_id').notNullable().references('id').inTable('customers');
    t.index(['customer_id']);
  });
}
export async function down() {}`,
      '',
    );
    const r = runGuard({ snapshotPath, allowlistPath, migrationsDir });
    expect(r.exitCode).toBe(0);
  });

  it('REJECTs clinic_id without t.index', () => {
    const { snapshotPath, allowlistPath, migrationsDir } = writeFixture(
      'clinic_no_index',
      `import { Knex } from 'knex';
export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable('foo', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.uuid('clinic_id').notNullable();
  });
}
export async function down() {}`,
      '',
    );
    const r = runGuard({ snapshotPath, allowlistPath, migrationsDir });
    expect(r.exitCode).toBe(1);
    expect(r.violations[0]!.column).toBe('clinic_id');
  });

  it('REJECTs patient_id without t.index', () => {
    const { snapshotPath, allowlistPath, migrationsDir } = writeFixture(
      'patient_no_index',
      `import { Knex } from 'knex';
export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable('foo', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.uuid('patient_id').notNullable();
  });
}
export async function down() {}`,
      '',
    );
    const r = runGuard({ snapshotPath, allowlistPath, migrationsDir });
    expect(r.exitCode).toBe(1);
    expect(r.violations[0]!.column).toBe('patient_id');
  });

  it('PASSES composite index where the column is the FIRST element', () => {
    const { snapshotPath, allowlistPath, migrationsDir } = writeFixture(
      'composite_first',
      `import { Knex } from 'knex';
export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable('foo', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.uuid('patient_id').notNullable();
    t.index(['patient_id', 'created_at']);
  });
}
export async function down() {}`,
      '',
    );
    const r = runGuard({ snapshotPath, allowlistPath, migrationsDir });
    expect(r.exitCode).toBe(0);
  });

  it('SKIPs squashed-baseline files entirely', () => {
    const { snapshotPath, allowlistPath, migrationsDir } = writeFixture(
      'squashed_baseline',
      `// @migration-squashed-baseline
import { Knex } from 'knex';
export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable('foo', (t) => {
    t.uuid('patient_id').notNullable();
  });
}
export async function down() {}`,
      '',
    );
    const r = runGuard({ snapshotPath, allowlistPath, migrationsDir });
    expect(r.exitCode).toBe(0);
    expect(r.counts.skippedSquashed).toBe(1);
  });

  it('honours inline @migration-index-exempt', () => {
    const { snapshotPath, allowlistPath, migrationsDir } = writeFixture(
      'inline_exempt',
      `import { Knex } from 'knex';
export async function up(knex: Knex): Promise<void> {
  // @migration-index-exempt: small lookup table; seq-scan faster than index-scan
  await knex.schema.createTable('lookup', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.uuid('clinic_id').notNullable();
  });
}
export async function down() {}`,
      '',
    );
    const r = runGuard({ snapshotPath, allowlistPath, migrationsDir });
    expect(r.exitCode).toBe(0);
    expect(r.counts.skippedExempt).toBe(1);
  });

  it('cycle-2 absorb: skips clinic_id-as-PRIMARY-KEY (Pattern 2 .primary() skip)', () => {
    // L3 REJECT cycle-2 absorb: Pattern 2 (clinic_id/patient_id detection)
    // must skip primary-key columns the same way Pattern 1 (FK detection)
    // does. clinic_settings.clinic_id is the canonical single-tenant
    // settings shape — clinic_id IS the primary key, so implicitly indexed.
    const { snapshotPath, allowlistPath, migrationsDir } = writeFixture(
      'clinic_id_as_pk',
      `import { Knex } from 'knex';
export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable('clinic_settings', (t) => {
    t.uuid('clinic_id').primary().references('id').inTable('clinics').onDelete('CASCADE');
    t.string('value');
  });
}
export async function down() {}`,
      '',
    );
    const r = runGuard({ snapshotPath, allowlistPath, migrationsDir });
    expect(r.exitCode).toBe(0);
    expect(r.violations).toHaveLength(0);
  });

  it('cycle-2 absorb: skips patient_id-as-PRIMARY-KEY', () => {
    const { snapshotPath, allowlistPath, migrationsDir } = writeFixture(
      'patient_id_as_pk',
      `import { Knex } from 'knex';
export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable('patient_preferences', (t) => {
    t.uuid('patient_id').primary().references('id').inTable('patients').onDelete('CASCADE');
    t.string('locale');
  });
}
export async function down() {}`,
      '',
    );
    const r = runGuard({ snapshotPath, allowlistPath, migrationsDir });
    expect(r.exitCode).toBe(0);
  });

  it('skips primary-key columns (implicitly indexed)', () => {
    const { snapshotPath, allowlistPath, migrationsDir } = writeFixture(
      'primary_key',
      `import { Knex } from 'knex';
export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable('foo', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()')).references('id').inTable('parent');
  });
}
export async function down() {}`,
      '',
    );
    const r = runGuard({ snapshotPath, allowlistPath, migrationsDir });
    expect(r.exitCode).toBe(0);
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

  it('mutation-resistance: removing FK detection fails this fixture', () => {
    const { snapshotPath, allowlistPath, migrationsDir } = writeFixture(
      'mut_fk_detect',
      `import { Knex } from 'knex';
export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable('orders', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.uuid('parent_id').notNullable().references('id').inTable('parent');
  });
}
export async function down() {}`,
      '',
    );
    const r = runGuard({ snapshotPath, allowlistPath, migrationsDir });
    expect(r.violations).toHaveLength(1);
    expect(r.violations[0]!.column).toBe('parent_id');
  });
});
