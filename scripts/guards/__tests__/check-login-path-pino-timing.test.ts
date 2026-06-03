import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdirSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runGuard } from '../check-login-path-pino-timing';

const TMP_BASE = join(tmpdir(), 'a1-login-path-timing-fixtures');

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

describe('runGuard — login path pino timing', () => {
  it('passes when every direct await in loginController is wrapped with withTiming', () => {
    const sourcePath = writeFixture(
      'all_wrapped',
      `export async function loginController() {
  const result = await withTiming('login.auth', async () => authService.login());
  const mod = await withTiming('login.importDb', async () => import('./db'));
  const row = await withTiming('login.query', async () => mod.db('staff').first());
  await withTiming('login.audit', async () => writeAuditLog(row));
  return result;
}`,
    );

    const result = runGuard({ sourcePath });
    expect(result.exitCode).toBe(0);
    expect(result.awaitedStages).toBe(4);
    expect(result.validatedWrappedStages).toBe(4);
  });

  it('rejects a direct await that is not wrapped with withTiming', () => {
    const sourcePath = writeFixture(
      'bare_await',
      `export async function loginController() {
  const result = await authService.login();
  return result;
}`,
    );

    const result = runGuard({ sourcePath });
    expect(result.exitCode).toBe(1);
    expect(result.violations).toHaveLength(1);
  });

  it('honours inline @login-path-timing-exempt with non-empty reason', () => {
    const sourcePath = writeFixture(
      'inline_exempt',
      `export async function loginController() {
  // @login-path-timing-exempt: temporary manual probe for one-off diagnosis
  const result = await authService.login();
  return result;
}`,
    );

    const result = runGuard({ sourcePath });
    expect(result.exitCode).toBe(0);
    expect(result.exemptedStages).toBe(1);
  });

  it('ignores awaits outside loginController', () => {
    const sourcePath = writeFixture(
      'other_function',
      `export async function refreshController() {
  await authService.refresh();
}

export async function loginController() {
  return await withTiming('login.auth', async () => authService.login());
}`,
    );

    const result = runGuard({ sourcePath });
    expect(result.exitCode).toBe(0);
    expect(result.awaitedStages).toBe(1);
  });

  it('ignores awaits inside nested functions within loginController', () => {
    const sourcePath = writeFixture(
      'nested_function',
      `export async function loginController() {
  const result = await withTiming('login.auth', async () => authService.login());
  const later = async () => {
    await doSomethingElse();
  };
  return { result, later };
}`,
    );

    const result = runGuard({ sourcePath });
    expect(result.exitCode).toBe(0);
    expect(result.awaitedStages).toBe(1);
  });

  it('returns exitCode 2 when loginController is missing', () => {
    const sourcePath = writeFixture(
      'missing_login',
      `export async function refreshController() {
  await authService.refresh();
}`,
    );

    const result = runGuard({ sourcePath });
    expect(result.exitCode).toBe(2);
  });
});
