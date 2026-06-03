/* PR-R1-22 vitest fixture suite. */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdirSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runGuard } from '../check-mutation-invalidation';

const TMP_BASE = join(tmpdir(), 'pr-r1-22-fixtures');

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

describe('runGuard — mutation-invalidation', () => {
  it('REJECTs useMutation with no invalidate call', () => {
    const { snapshotPath, allowlistPath, scanRoot } = writeFixture(
      'no_invalidate',
      `const m = useMutation({
  mutationFn: (dto) => apiClient.post('/foo', dto),
});`,
    );
    const r = runGuard({ snapshotPath, allowlistPath, scanRoot });
    expect(r.exitCode).toBe(1);
  });

  it('PASSES useMutation with invalidateQueries', () => {
    const { snapshotPath, allowlistPath, scanRoot } = writeFixture(
      'with_invalidate',
      `const m = useMutation({
  mutationFn: (dto) => apiClient.post('/foo', dto),
  onSuccess: () => qc.invalidateQueries({ queryKey: fooKeys.all }),
});`,
    );
    const r = runGuard({ snapshotPath, allowlistPath, scanRoot });
    expect(r.exitCode).toBe(0);
  });

  it('PASSES useMutation with setQueryData', () => {
    const { snapshotPath, allowlistPath, scanRoot } = writeFixture(
      'with_setQueryData',
      `const m = useMutation({
  mutationFn: (dto) => apiClient.post('/foo', dto),
  onSuccess: (data) => qc.setQueryData(['foo', data.id], data),
});`,
    );
    const r = runGuard({ snapshotPath, allowlistPath, scanRoot });
    expect(r.exitCode).toBe(0);
  });

  it('PASSES useMutation with refetchQueries', () => {
    const { snapshotPath, allowlistPath, scanRoot } = writeFixture(
      'with_refetch',
      `const m = useMutation({
  mutationFn: (dto) => apiClient.post('/foo', dto),
  onSuccess: () => qc.refetchQueries({ queryKey: ['foo'] }),
});`,
    );
    const r = runGuard({ snapshotPath, allowlistPath, scanRoot });
    expect(r.exitCode).toBe(0);
  });

  it('honours @no-invalidate-needed with non-empty reason', () => {
    const { snapshotPath, allowlistPath, scanRoot } = writeFixture(
      'inline_exempt',
      `// @no-invalidate-needed: pure analytics-tracking mutation; no consumer-visible state
const m = useMutation({
  mutationFn: (event) => apiClient.post('/track', event),
});`,
    );
    const r = runGuard({ snapshotPath, allowlistPath, scanRoot });
    expect(r.exitCode).toBe(0);
    expect(r.counts.skippedExempt).toBe(1);
  });

  it('handles useMutation<TData, TError, TVars> generic syntax', () => {
    const { snapshotPath, allowlistPath, scanRoot } = writeFixture(
      'generic_useMutation',
      `const m = useMutation<Foo, Error, FooDto>({
  mutationFn: (dto) => apiClient.post('/foo', dto),
  onSuccess: () => qc.invalidateQueries({ queryKey: fooKeys.all }),
});`,
    );
    const r = runGuard({ snapshotPath, allowlistPath, scanRoot });
    expect(r.exitCode).toBe(0);
  });

  it('detects multiple violations', () => {
    const { snapshotPath, allowlistPath, scanRoot } = writeFixture(
      'multi',
      `const m1 = useMutation({ mutationFn: () => api.post('/a', {}) });
const m2 = useMutation({ mutationFn: () => api.post('/b', {}) });
const m3 = useMutation({ mutationFn: () => api.post('/c', {}), onSuccess: () => qc.invalidateQueries({ queryKey: cKeys.all }) });`,
    );
    const r = runGuard({ snapshotPath, allowlistPath, scanRoot });
    expect(r.exitCode).toBe(1);
    expect(r.violations).toHaveLength(2);
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

  it('mutation-resistance: removing INVALIDATE_PATTERN fails this fixture', () => {
    const { snapshotPath, allowlistPath, scanRoot } = writeFixture(
      'mut_invalidate_pattern',
      `const m = useMutation({ mutationFn: () => api.post('/x', {}) });`,
    );
    const r = runGuard({ snapshotPath, allowlistPath, scanRoot });
    expect(r.violations).toHaveLength(1);
  });
});
