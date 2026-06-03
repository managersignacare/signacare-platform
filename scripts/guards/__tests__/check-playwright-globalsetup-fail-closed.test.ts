import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdirSync, rmSync, existsSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { runGuard } from '../check-playwright-globalsetup-fail-closed';

const TMP_BASE = join(tmpdir(), 'check-playwright-globalsetup-fail-closed-fixtures');

beforeAll(() => {
  if (existsSync(TMP_BASE)) rmSync(TMP_BASE, { recursive: true, force: true });
  mkdirSync(TMP_BASE, { recursive: true });
});

afterAll(() => {
  if (existsSync(TMP_BASE)) rmSync(TMP_BASE, { recursive: true, force: true });
});

function writeFixture(name: string, source: string): string {
  const path = join(TMP_BASE, name);
  writeFileSync(path, source, 'utf8');
  return path;
}

describe('check-playwright-globalsetup-fail-closed', () => {
  it('passes when catches rethrow and no silent .catch suppression is present', () => {
    const file = writeFixture(
      'pass.ts',
      `
export default async function globalSetup() {
  try {
    await Promise.resolve();
  } catch (err) {
    throw new Error(String(err));
  }
}
`,
    );

    const result = runGuard({ sourcePath: file });
    expect(result.exitCode).toBe(0);
    expect(result.violations).toHaveLength(0);
  });

  it('fails when catch block does not throw', () => {
    const file = writeFixture(
      'fail-catch.ts',
      `
export default async function globalSetup() {
  try {
    await Promise.resolve();
  } catch (err) {
    console.error(err);
  }
}
`,
    );

    const result = runGuard({ sourcePath: file });
    expect(result.exitCode).toBe(1);
    expect(result.violations.some((v) => v.reason.includes('does not rethrow'))).toBe(true);
  });

  it('fails on silent .catch(() => undefined)', () => {
    const file = writeFixture(
      'fail-silent.ts',
      `
export default async function globalSetup() {
  await Promise.resolve().catch(() => undefined);
}
`,
    );

    const result = runGuard({ sourcePath: file });
    expect(result.exitCode).toBe(1);
    expect(result.violations.some((v) => v.reason.includes('silent `.catch'))).toBe(true);
  });
});
