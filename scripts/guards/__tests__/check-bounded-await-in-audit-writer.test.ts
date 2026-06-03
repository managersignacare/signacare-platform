import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { runGuard } from '../check-bounded-await-in-audit-writer';

const TMP_BASE = join(tmpdir(), 'a2-bounded-await-audit-writer-fixtures');

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
  const file = join(dir, 'audit.ts');
  writeFileSync(file, content, 'utf8');
  return file;
}

describe('runGuard — bounded await in audit writer', () => {
  it('passes when primary insert and outbox enqueue are both bounded', () => {
    const sourcePath = writeFixture(
      'pass',
      `
async function enqueueAuditOutboxBounded(row) {
  await withTimeout(enqueueAuditOutbox(row), 1000, 'audit.write.enqueueOutbox.primary_insert');
}
export async function writeAuditLog() {
  await withTimeout(insertAuditRowIdempotent(row), 2000, 'audit.write.primaryInsert');
  await enqueueAuditOutboxBounded(row, 1000, { source: 'primary_insert' });
}
`,
    );
    const result = runGuard({ sourcePath });
    expect(result.exitCode).toBe(0);
    expect(result.violations).toHaveLength(0);
  });

  it('fails when primary insert timeout wrapper is missing', () => {
    const sourcePath = writeFixture(
      'missing_primary',
      `
async function enqueueAuditOutboxBounded(row) {
  await withTimeout(enqueueAuditOutbox(row), 1000, 'audit.write.enqueueOutbox.primary_insert');
}
export async function writeAuditLog() {
  await insertAuditRowIdempotent(row);
  await enqueueAuditOutboxBounded(row, 1000, { source: 'primary_insert' });
}
`,
    );
    const result = runGuard({ sourcePath });
    expect(result.exitCode).toBe(1);
    expect(result.violations.some((v) => v.reason.includes('primary insert'))).toBe(true);
  });

  it('fails when outbox timeout wrapper is missing', () => {
    const sourcePath = writeFixture(
      'missing_outbox_timeout',
      `
async function enqueueAuditOutboxBounded(row) {
  await enqueueAuditOutbox(row);
}
export async function writeAuditLog() {
  await withTimeout(insertAuditRowIdempotent(row), 2000, 'audit.write.primaryInsert');
  await enqueueAuditOutboxBounded(row, 1000, { source: 'primary_insert' });
}
`,
    );
    const result = runGuard({ sourcePath });
    expect(result.exitCode).toBe(1);
    expect(result.violations.some((v) => v.reason.includes('outbox enqueue'))).toBe(true);
  });

  it('returns exitCode 2 for missing source file', () => {
    const result = runGuard({ sourcePath: join(TMP_BASE, 'missing', 'audit.ts') });
    expect(result.exitCode).toBe(2);
  });
});
