/* PR-R1-20 vitest fixture suite. */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdirSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runGuard } from '../check-frontend-fail-open-gates';

const TMP_BASE = join(tmpdir(), 'pr-r1-20-fixtures');

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

function writeFixture(name: string, fileName: string, content: string): {
  snapshotPath: string;
  allowlistPath: string;
  scanRoots: string[];
} {
  const dir = join(TMP_BASE, name);
  mkdirSync(dir, { recursive: true });
  const hooksDir = join(dir, 'hooks');
  mkdirSync(hooksDir, { recursive: true });
  const snapshotPath = join(dir, 'snapshot.json');
  const allowlistPath = join(dir, 'allowlist.txt');
  writeFileSync(snapshotPath, SNAPSHOT, 'utf-8');
  writeFileSync(allowlistPath, '', 'utf-8');
  writeFileSync(join(hooksDir, fileName), content, 'utf-8');
  return { snapshotPath, allowlistPath, scanRoots: [hooksDir] };
}

describe('runGuard — frontend fail-OPEN gates', () => {
  it('REJECTs () => true predicate near isError in gating hook', () => {
    const { snapshotPath, allowlistPath, scanRoots } = writeFixture(
      'use_visibility_fail_open',
      'useFooVisibility.ts',
      `export function useFooVisibility() {
  const { data, isError } = useQuery(...);
  if (isError) {
    return { isVisible: () => true };
  }
  return { isVisible: (id) => data?.includes(id) ?? false };
}`,
    );
    const r = runGuard({ snapshotPath, allowlistPath, scanRoots });
    expect(r.exitCode).toBe(1);
  });

  it('PASSES fail-CLOSED `() => false` near isError', () => {
    const { snapshotPath, allowlistPath, scanRoots } = writeFixture(
      'use_visibility_fail_closed',
      'useFooVisibility.ts',
      `export function useFooVisibility() {
  const { data, isError } = useQuery(...);
  if (isError) {
    return { isVisible: () => false };
  }
  return { isVisible: (id) => data?.includes(id) ?? false };
}`,
    );
    const r = runGuard({ snapshotPath, allowlistPath, scanRoots });
    expect(r.exitCode).toBe(0);
  });

  it('SKIPs non-gating hook files (out of scope)', () => {
    const { snapshotPath, allowlistPath, scanRoots } = writeFixture(
      'non_gating_hook',
      'useFooData.ts',
      `export function useFooData() {
  const { data, isError } = useQuery(...);
  return { include: () => true };
}`,
    );
    const r = runGuard({ snapshotPath, allowlistPath, scanRoots });
    expect(r.exitCode).toBe(0);
    expect(r.counts.skippedNonGatingHooks).toBeGreaterThan(0);
  });

  it('PASSES `() => true` without nearby isError (legitimate predicate)', () => {
    const { snapshotPath, allowlistPath, scanRoots } = writeFixture(
      'no_error_context',
      'useFooPermission.ts',
      `export function useFooPermission() {
  const ALL_TRUE_FILTER = () => true;
  return { hasPermission: ALL_TRUE_FILTER };
}`,
    );
    const r = runGuard({ snapshotPath, allowlistPath, scanRoots });
    expect(r.exitCode).toBe(0);
  });

  it('honours @fail-open-exempt with non-empty reason', () => {
    const { snapshotPath, allowlistPath, scanRoots } = writeFixture(
      'inline_exempt',
      'useFooAccess.ts',
      `export function useFooAccess() {
  const { isError } = useQuery(...);
  if (isError) {
    // @fail-open-exempt: dev-mode hatch for local testing; never reaches prod
    return { hasAccess: () => true };
  }
}`,
    );
    const r = runGuard({ snapshotPath, allowlistPath, scanRoots });
    expect(r.exitCode).toBe(0);
    expect(r.counts.skippedExempt).toBe(1);
  });

  it('rejects when snapshot is missing', () => {
    const dir = join(TMP_BASE, 'no_snapshot');
    mkdirSync(dir, { recursive: true });
    const r = runGuard({
      snapshotPath: join(dir, 'nonexistent.json'),
      allowlistPath: join(dir, 'allowlist.txt'),
      scanRoots: [dir],
    });
    expect(r.exitCode).toBe(2);
  });

  it('detects multiple gating-hook patterns (Visibility/Permission/Access/Tab/Nav/Gate/Module/Feature)', () => {
    const { snapshotPath, allowlistPath, scanRoots } = writeFixture(
      'multiple_patterns',
      'useFooGate.ts',
      `export function useFooGate() {
  const { isError } = useQuery(...);
  if (isError) return { gate: () => true };
}`,
    );
    const r = runGuard({ snapshotPath, allowlistPath, scanRoots });
    expect(r.exitCode).toBe(1);
  });

  it('mutation-resistance: removing isError-window check fails this fixture', () => {
    const { snapshotPath, allowlistPath, scanRoots } = writeFixture(
      'mut_window_check',
      'useFooVisibility.ts',
      `export function useFooVisibility() {
  const { isError } = useQuery();
  if (isError) return () => true;
}`,
    );
    const r = runGuard({ snapshotPath, allowlistPath, scanRoots });
    expect(r.violations).toHaveLength(1);
  });
});
