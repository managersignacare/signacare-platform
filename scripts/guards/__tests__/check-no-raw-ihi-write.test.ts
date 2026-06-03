/* BUG-A5.0 vitest fixture suite. */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdirSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runGuard } from '../check-no-raw-ihi-write';

const TMP_BASE = join(tmpdir(), 'bug-a5-0-fixtures');

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

function writeFixture(name: string, content: string, fileName = 'fixture.ts'): {
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
  writeFileSync(snapshotPath, SNAPSHOT, 'utf-8');
  writeFileSync(allowlistPath, '', 'utf-8');
  writeFileSync(join(scanRoot, fileName), content, 'utf-8');
  return { snapshotPath, allowlistPath, scanRoot };
}

describe('runGuard — no-raw-ihi-write', () => {
  it('REJECTs raw ihi_number string write outside canonical path', () => {
    const { snapshotPath, allowlistPath, scanRoot } = writeFixture(
      'raw_write',
      `await db('patients').insert({ ihi_number: '8003608000000001' });`,
    );
    const r = runGuard({ snapshotPath, allowlistPath, scanRoot });
    expect(r.exitCode).toBe(1);
    expect(r.violations).toHaveLength(1);
  });

  it('PASSES ihi_number: null (legitimate anonymisation/clear)', () => {
    const { snapshotPath, allowlistPath, scanRoot } = writeFixture(
      'null_clear',
      `await db('patients').update({ ihi_number: null });`,
    );
    const r = runGuard({ snapshotPath, allowlistPath, scanRoot });
    expect(r.exitCode).toBe(0);
    expect(r.counts.skippedNullClear).toBe(1);
  });

  it('honours @ihi-write-exempt with non-empty reason', () => {
    const { snapshotPath, allowlistPath, scanRoot } = writeFixture(
      'exempt',
      `// @ihi-write-exempt: FHIR ingest path with inline Luhn gate
await db('patients').insert({ ihi_number: someValue });`,
    );
    const r = runGuard({ snapshotPath, allowlistPath, scanRoot });
    expect(r.exitCode).toBe(0);
    expect(r.counts.skippedExempt).toBe(1);
  });

  it('does NOT honour @ihi-write-exempt with empty reason', () => {
    const { snapshotPath, allowlistPath, scanRoot } = writeFixture(
      'empty_exempt',
      `// @ihi-write-exempt:
await db('patients').insert({ ihi_number: someValue });`,
    );
    const r = runGuard({ snapshotPath, allowlistPath, scanRoot });
    expect(r.exitCode).toBe(1);
  });

  it('does NOT flag writes that do not contain ihi_number', () => {
    const { snapshotPath, allowlistPath, scanRoot } = writeFixture(
      'unrelated',
      `await db('patients').insert({ given_name: 'Test', family_name: 'User' });`,
    );
    const r = runGuard({ snapshotPath, allowlistPath, scanRoot });
    expect(r.exitCode).toBe(0);
  });

  it('does NOT flag commented-out write', () => {
    const { snapshotPath, allowlistPath, scanRoot } = writeFixture(
      'commented',
      `// await db('patients').insert({ ihi_number: 'old-bad-pattern' });
const x = 1;`,
    );
    const r = runGuard({ snapshotPath, allowlistPath, scanRoot });
    expect(r.exitCode).toBe(0);
  });

  it('does NOT flag string-literal mention', () => {
    const { snapshotPath, allowlistPath, scanRoot } = writeFixture(
      'string_mention',
      `const help = "Use db('patients').insert({ ihi_number: ... }) only via patientService";`,
    );
    const r = runGuard({ snapshotPath, allowlistPath, scanRoot });
    expect(r.exitCode).toBe(0);
  });

  it('REJECTs bare-line raw write detection — mutation resistance', () => {
    const { snapshotPath, allowlistPath, scanRoot } = writeFixture(
      'mut_raw',
      `await db('patients').insert({ ihi_number: '8003609999999999', given_name: 'X' });`,
    );
    const r = runGuard({ snapshotPath, allowlistPath, scanRoot });
    expect(r.exitCode).toBe(1);
    expect(r.violations).toHaveLength(1);
  });

  it('rejects when snapshot is missing', () => {
    const dir = join(TMP_BASE, 'no_snap');
    mkdirSync(dir, { recursive: true });
    const r = runGuard({
      snapshotPath: join(dir, 'nonexistent.json'),
      allowlistPath: join(dir, 'allowlist.txt'),
      scanRoot: dir,
    });
    expect(r.exitCode).toBe(2);
  });
});

describe('isValidIhi (shared luhn helper)', () => {
  it('accepts a Luhn-valid IHI', async () => {
    const { isValidIhi, luhnCheck } = await import('../../../packages/shared/src/luhn');
    // Generate a valid 16-digit IHI: 800360 prefix + 9 digits + Luhn check digit
    const partial = '800360123456789';
    let sum = 0;
    let alt = true;
    for (let i = partial.length - 1; i >= 0; i--) {
      let n = parseInt(partial[i], 10);
      if (alt) { n *= 2; if (n > 9) n -= 9; }
      sum += n;
      alt = !alt;
    }
    const checkDigit = (10 - (sum % 10)) % 10;
    const validIhi = partial + checkDigit;
    expect(luhnCheck(validIhi)).toBe(true);
    expect(isValidIhi(validIhi)).toBe(true);
  });

  it('rejects 16-digit non-IHI prefix', async () => {
    const { isValidIhi } = await import('../../../packages/shared/src/luhn');
    expect(isValidIhi('1234567890123452')).toBe(false); // valid Luhn but wrong prefix
  });

  it('rejects too-short IHI', async () => {
    const { isValidIhi } = await import('../../../packages/shared/src/luhn');
    expect(isValidIhi('800360123456789')).toBe(false); // 15 digits
  });

  it('rejects empty / null / undefined', async () => {
    const { isValidIhi } = await import('../../../packages/shared/src/luhn');
    expect(isValidIhi('')).toBe(false);
    expect(isValidIhi(null)).toBe(false);
    expect(isValidIhi(undefined)).toBe(false);
  });

  it('strips whitespace', async () => {
    const { isValidIhi } = await import('../../../packages/shared/src/luhn');
    // 8003 6012 3456 7890 — known valid IHI from test vectors? Use the dynamic generator.
    const partial = '800360111111111';
    let sum = 0;
    let alt = true;
    for (let i = partial.length - 1; i >= 0; i--) {
      let n = parseInt(partial[i], 10);
      if (alt) { n *= 2; if (n > 9) n -= 9; }
      sum += n;
      alt = !alt;
    }
    const checkDigit = (10 - (sum % 10)) % 10;
    const validIhi = partial + checkDigit;
    const spaced = `${validIhi.slice(0, 4)} ${validIhi.slice(4, 8)} ${validIhi.slice(8, 12)} ${validIhi.slice(12)}`;
    expect(isValidIhi(spaced)).toBe(true);
  });
});
