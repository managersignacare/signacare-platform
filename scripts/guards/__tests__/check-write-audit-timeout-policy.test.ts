import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { runGuard } from '../check-write-audit-timeout-policy';

const TMP_BASE = join(tmpdir(), 'a2-write-audit-timeout-policy-fixtures');

beforeAll(() => {
  if (existsSync(TMP_BASE)) rmSync(TMP_BASE, { recursive: true, force: true });
  mkdirSync(TMP_BASE, { recursive: true });
});

afterAll(() => {
  if (existsSync(TMP_BASE)) rmSync(TMP_BASE, { recursive: true, force: true });
});

function writeFixture(name: string, content: string): string {
  const file = join(TMP_BASE, `${name}.ts`);
  writeFileSync(file, content, 'utf8');
  return file;
}

describe('check-write-audit-timeout-policy', () => {
  it('passes when writeAuditLog is called directly without wrapper', () => {
    const file = writeFixture(
      'pass-direct',
      `
export async function run() {
  await writeAuditLog({ action: 'LOGIN' });
}
`,
    );

    const result = runGuard({ files: [file] });
    expect(result.exitCode).toBe(0);
    expect(result.violations).toHaveLength(0);
  });

  it('passes when wrapper has explicit exemption rationale', () => {
    const file = writeFixture(
      'pass-exempt',
      `
export async function run() {
  // @write-audit-timeout-exempt: login endpoint has stricter SLA than general writer fallback budget
  await withTimeout(writeAuditLog({ action: 'LOGIN' }), 1200, 'login.writeAuditLog');
}
`,
    );

    const result = runGuard({ files: [file] });
    expect(result.exitCode).toBe(0);
    expect(result.exemptedSites).toBe(1);
  });

  it('fails when withTimeout wraps writeAuditLog without exemption', () => {
    const file = writeFixture(
      'fail-timeout',
      `
export async function run() {
  await withTimeout(writeAuditLog({ action: 'LOGIN' }), 1200, 'login.writeAuditLog');
}
`,
    );

    const result = runGuard({ files: [file] });
    expect(result.exitCode).toBe(1);
    expect(result.violations.some((v) => v.reason.includes('caller-level timeout/race wrapper'))).toBe(true);
  });

  it('fails when Promise.race wraps writeAuditLog without exemption', () => {
    const file = writeFixture(
      'fail-race',
      `
export async function run() {
  await Promise.race([writeAuditLog({ action: 'LOGIN' }), pause(1000)]);
}
`,
    );

    const result = runGuard({ files: [file] });
    expect(result.exitCode).toBe(1);
    expect(result.violations).toHaveLength(1);
  });
});
