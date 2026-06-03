import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { runGuard } from '../check-no-ambiguous-validation-status';

const TMP_BASE = join(tmpdir(), 'check-no-ambiguous-validation-status-fixtures');

beforeAll(() => {
  if (existsSync(TMP_BASE)) rmSync(TMP_BASE, { recursive: true, force: true });
  mkdirSync(TMP_BASE, { recursive: true });
});

afterAll(() => {
  if (existsSync(TMP_BASE)) rmSync(TMP_BASE, { recursive: true, force: true });
});

function writeFixture(name: string, fileName: string, source: string): string {
  const dir = join(TMP_BASE, name);
  mkdirSync(dir, { recursive: true });
  const target = join(dir, fileName);
  writeFileSync(target, source, 'utf8');
  return dir;
}

describe('check-no-ambiguous-validation-status', () => {
  it('passes when status assertions are explicit single-code checks', () => {
    const root = writeFixture(
      'pass-single-status',
      'sample.int.test.ts',
      `
it('explicit', async () => {
  expect(res.status).toBe(422);
});
`,
    );

    const result = runGuard({ rootDir: root });
    expect(result.exitCode).toBe(0);
    expect(result.violations).toHaveLength(0);
  });

  it('fails on [400, 422] status arrays', () => {
    const root = writeFixture(
      'fail-array',
      'sample.int.test.ts',
      `
it('ambiguous', async () => {
  expect([400, 422]).toContain(res.status);
});
`,
    );

    const result = runGuard({ rootDir: root });
    expect(result.exitCode).toBe(1);
    expect(result.violations.some((v) => v.reason.includes('ambiguous validation-status contract'))).toBe(true);
  });

  it('fails on 400/422 prose shorthand', () => {
    const root = writeFixture(
      'fail-prose',
      'sample.int.test.ts',
      `
// schema reject path 400/422
it('desc', async () => {
  expect(res.status).toBeGreaterThanOrEqual(400);
});
`,
    );

    const result = runGuard({ rootDir: root });
    expect(result.exitCode).toBe(1);
    expect(result.violations).toHaveLength(1);
  });

  it('allows explicit exemption with reason', () => {
    const root = writeFixture(
      'pass-exempt',
      'sample.int.test.ts',
      `
it('migration window', async () => {
  // @validation-status-ambiguous-exempt: BUG-999 temporary split-contract during endpoint migration
  expect([400, 422]).toContain(res.status);
});
`,
    );

    const result = runGuard({ rootDir: root });
    expect(result.exitCode).toBe(0);
    expect(result.violations).toHaveLength(0);
  });

  it('fails when exemption tag has no reason', () => {
    const root = writeFixture(
      'fail-empty-exempt',
      'sample.int.test.ts',
      `
it('bad exemption', async () => {
  // @validation-status-ambiguous-exempt:
  expect([400, 422]).toContain(res.status);
});
`,
    );

    const result = runGuard({ rootDir: root });
    expect(result.exitCode).toBe(1);
    expect(result.violations[0]?.reason).toContain('missing a non-empty reason');
  });
});
