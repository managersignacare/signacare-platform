/* PR-R1-21 vitest fixture suite. */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdirSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runGuard } from '../check-error-envelope-consistency';

const TMP_BASE = join(tmpdir(), 'pr-r1-21-fixtures');

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

function writeFixture(name: string, content: string): {
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
  writeFileSync(join(scanRoot, 'fixture.ts'), content, 'utf-8');
  return { snapshotPath, allowlistPath, scanRoot };
}

describe('runGuard — error-envelope-consistency', () => {
  it('REJECTs res.status(404).json', () => {
    const { snapshotPath, allowlistPath, scanRoot } = writeFixture(
      'inline_404',
      `if (!row) { res.status(404).json({ error: 'Not found' }); return; }`,
    );
    const r = runGuard({ snapshotPath, allowlistPath, scanRoot });
    expect(r.exitCode).toBe(1);
    expect(r.violations[0]!.status).toBe(404);
  });

  it('REJECTs res.status(400).json', () => {
    const { snapshotPath, allowlistPath, scanRoot } = writeFixture(
      'inline_400',
      `res.status(400).json({ error: 'Validation failed', details: parsed.error });`,
    );
    const r = runGuard({ snapshotPath, allowlistPath, scanRoot });
    expect(r.exitCode).toBe(1);
    expect(r.violations[0]!.status).toBe(400);
  });

  it('REJECTs res.status(500).json', () => {
    const { snapshotPath, allowlistPath, scanRoot } = writeFixture(
      'inline_500',
      `res.status(500).json({ error: 'Internal' });`,
    );
    const r = runGuard({ snapshotPath, allowlistPath, scanRoot });
    expect(r.exitCode).toBe(1);
    expect(r.violations[0]!.status).toBe(500);
  });

  it('PASSES res.status(200).json (success)', () => {
    const { snapshotPath, allowlistPath, scanRoot } = writeFixture(
      'success_200',
      `res.status(200).json({ ok: true });`,
    );
    const r = runGuard({ snapshotPath, allowlistPath, scanRoot });
    expect(r.exitCode).toBe(0);
  });

  it('PASSES res.status(201).json (created)', () => {
    const { snapshotPath, allowlistPath, scanRoot } = writeFixture(
      'success_201',
      `res.status(201).json({ id: 'x' });`,
    );
    const r = runGuard({ snapshotPath, allowlistPath, scanRoot });
    expect(r.exitCode).toBe(0);
  });

  it('PASSES res.status(204).end (no body)', () => {
    const { snapshotPath, allowlistPath, scanRoot } = writeFixture(
      'success_204',
      `res.status(204).end();`,
    );
    const r = runGuard({ snapshotPath, allowlistPath, scanRoot });
    expect(r.exitCode).toBe(0);
  });

  it('PASSES next(new AppError(...)) (canonical pattern)', () => {
    const { snapshotPath, allowlistPath, scanRoot } = writeFixture(
      'canonical_next',
      `if (!row) return next(new AppError('Not found', 404, 'NOT_FOUND'));`,
    );
    const r = runGuard({ snapshotPath, allowlistPath, scanRoot });
    expect(r.exitCode).toBe(0);
  });

  it('honours inline @error-envelope-exempt with non-empty reason', () => {
    const { snapshotPath, allowlistPath, scanRoot } = writeFixture(
      'inline_exempt',
      `// @error-envelope-exempt: NPDS vendor protocol requires custom error shape with structured fault detail
res.status(400).json({ ResponseCode: 'INVALID_PRESCRIPTION', Detail: 'malformed' });`,
    );
    const r = runGuard({ snapshotPath, allowlistPath, scanRoot });
    expect(r.exitCode).toBe(0);
    expect(r.counts.skippedExempt).toBe(1);
  });

  it('detects multiple violations in same file', () => {
    const { snapshotPath, allowlistPath, scanRoot } = writeFixture(
      'multi_violations',
      `res.status(400).json({ error: 'a' });
res.status(404).json({ error: 'b' });
res.status(500).json({ error: 'c' });`,
    );
    const r = runGuard({ snapshotPath, allowlistPath, scanRoot });
    expect(r.exitCode).toBe(1);
    expect(r.violations).toHaveLength(3);
  });

  it('rejects when snapshot is missing', () => {
    const dir = join(TMP_BASE, 'no_snapshot');
    mkdirSync(dir, { recursive: true });
    const r = runGuard({
      snapshotPath: join(dir, 'nonexistent.json'),
      allowlistPath: join(dir, 'allowlist.txt'),
      scanRoot: dir,
    });
    expect(r.exitCode).toBe(2);
  });

  it('mutation-resistance: removing ERROR_RESPONSE_RE fails this fixture', () => {
    const { snapshotPath, allowlistPath, scanRoot } = writeFixture(
      'mut_error_re',
      `res.status(403).json({ error: 'Forbidden' });`,
    );
    const r = runGuard({ snapshotPath, allowlistPath, scanRoot });
    expect(r.violations).toHaveLength(1);
  });
});
