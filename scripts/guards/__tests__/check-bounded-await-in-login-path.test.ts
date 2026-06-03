import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdirSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runGuard } from '../check-bounded-await-in-login-path';

const TMP_BASE = join(tmpdir(), 'a2-bounded-await-login-fixtures');

beforeAll(() => {
  if (existsSync(TMP_BASE)) rmSync(TMP_BASE, { recursive: true, force: true });
  mkdirSync(TMP_BASE, { recursive: true });
});

afterAll(() => {
  if (existsSync(TMP_BASE)) rmSync(TMP_BASE, { recursive: true, force: true });
});

function writeFixture(name: string, content: string): string {
  const dir = join(TMP_BASE, name);
  mkdirSync(dir, { recursive: true });
  const file = join(dir, 'authController.ts');
  writeFileSync(file, content, 'utf8');
  return file;
}

describe('runGuard — bounded await in login path', () => {
  it('passes when login.writeAuditLog stage uses withTimeout', () => {
    const sourcePath = writeFixture(
      'pass',
      `export async function loginController() {
  await withTiming(
    'login.writeAuditLog',
    async () => withTimeout(writeAuditLog({}), 2000, 'login.writeAuditLog'),
  );
}`,
    );
    const result = runGuard({ sourcePath });
    expect(result.exitCode).toBe(0);
    expect(result.violations).toHaveLength(0);
  });

  it('fails when login.writeAuditLog is timed but not bounded', () => {
    const sourcePath = writeFixture(
      'missing_timeout',
      `export async function loginController() {
  await withTiming('login.writeAuditLog', async () => writeAuditLog({}));
}`,
    );
    const result = runGuard({ sourcePath });
    expect(result.exitCode).toBe(1);
    expect(result.violations.some((v) => v.reason.includes('withTimeout'))).toBe(true);
  });

  it('fails when login.writeAuditLog timing stage is missing', () => {
    const sourcePath = writeFixture(
      'missing_stage',
      `export async function loginController() {
  await withTimeout(writeAuditLog({}), 2000, 'login.writeAuditLog');
}`,
    );
    const result = runGuard({ sourcePath });
    expect(result.exitCode).toBe(1);
    expect(result.violations.some((v) => v.reason.includes("withTiming('login.writeAuditLog'"))).toBe(true);
  });

  it('returns exitCode 2 when loginController is missing', () => {
    const sourcePath = writeFixture(
      'missing_controller',
      `export async function refreshController() {
  return true;
}`,
    );
    const result = runGuard({ sourcePath });
    expect(result.exitCode).toBe(2);
  });
});
