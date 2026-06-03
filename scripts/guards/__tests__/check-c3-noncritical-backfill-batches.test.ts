import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const TMP_BASE = join(tmpdir(), 'check-c3-noncritical-backfill-batches-fixtures');
const SCRIPT = join(process.cwd(), 'scripts', 'guards', 'check-c3-noncritical-backfill-batches.ts');

beforeAll(() => {
  if (existsSync(TMP_BASE)) rmSync(TMP_BASE, { recursive: true, force: true });
  mkdirSync(TMP_BASE, { recursive: true });
});

afterAll(() => {
  if (existsSync(TMP_BASE)) rmSync(TMP_BASE, { recursive: true, force: true });
});

function writeFixture(
  name: string,
  mutate?: (manifest: Record<string, unknown>) => void,
): string {
  const dir = join(TMP_BASE, name);
  mkdirSync(dir, { recursive: true });

  const manifest: Record<string, unknown> = {
    version: 1,
    bugId: 'BUG-453',
    inventoryStatus: 'baseline_pending',
    policy: {
      maxRoutesPerBatchPr: 5,
      minCoveredRoutesDelta: 3,
      minCoverageGainPercent: 2,
      maxBatchesBeforeRetriage: 4,
    },
    batches: [],
    residualInventory: {
      agreedThreshold: null,
      currentUncoveredCount: null,
      routes: [],
    },
    retriage: {
      requiredAfterBatch: 4,
      performed: false,
      evidenceRef: 'pending-first-four-batches',
    },
    notes: ['fixture'],
  };

  mutate?.(manifest);
  const manifestPath = join(dir, 'manifest.json');
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
  return manifestPath;
}

function runGuard(manifestPath: string): { ok: boolean; output: string } {
  try {
    const output = execFileSync(
      'npx',
      ['tsx', SCRIPT, manifestPath],
      {
        cwd: process.cwd(),
        env: process.env,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
      },
    );
    return { ok: true, output };
  } catch (error) {
    const stdout = error instanceof Error && 'stdout' in error ? String((error as { stdout?: string }).stdout ?? '') : '';
    const stderr = error instanceof Error && 'stderr' in error ? String((error as { stderr?: string }).stderr ?? '') : '';
    return { ok: false, output: `${stdout}\n${stderr}` };
  }
}

describe('check-c3-noncritical-backfill-batches', () => {
  it('passes baseline_pending manifest', () => {
    const manifestPath = writeFixture('pass');
    const res = runGuard(manifestPath);
    expect(res.ok).toBe(true);
    expect(res.output).toContain('✓ check-c3-noncritical-backfill-batches');
  });

  it('fails if a batch exceeds max routes per PR', () => {
    const manifestPath = writeFixture('too-many-routes', (manifest) => {
      manifest.inventoryStatus = 'active';
      manifest.residualInventory = {
        agreedThreshold: 8,
        currentUncoveredCount: 8,
        routes: [],
      };
      manifest.batches = [
        {
          batchId: 'C3-4-B1',
          date: '2026-05-11',
          prRef: 'PR-1',
          owner: 'qa-platform',
          routesAdded: [
            { method: 'GET', route: '/api/v1/a' },
            { method: 'GET', route: '/api/v1/b' },
            { method: 'GET', route: '/api/v1/c' },
            { method: 'GET', route: '/api/v1/d' },
            { method: 'GET', route: '/api/v1/e' },
            { method: 'GET', route: '/api/v1/f' },
          ],
          coveredRoutesDelta: 6,
          coverageGainPercent: 2.5,
          nonCriticalUncoveredAfter: 8,
        },
      ];
    });
    const res = runGuard(manifestPath);
    expect(res.ok).toBe(false);
    expect(res.output).toContain('exceeds maxRoutesPerBatchPr');
  });

  it('fails when batch delta misses both minimums', () => {
    const manifestPath = writeFixture('delta-too-small', (manifest) => {
      manifest.inventoryStatus = 'active';
      manifest.residualInventory = {
        agreedThreshold: 8,
        currentUncoveredCount: 8,
        routes: [],
      };
      manifest.batches = [
        {
          batchId: 'C3-4-B1',
          date: '2026-05-11',
          prRef: 'PR-1',
          owner: 'qa-platform',
          routesAdded: [{ method: 'GET', route: '/api/v1/non-critical-one' }],
          coveredRoutesDelta: 1,
          coverageGainPercent: 1.2,
          nonCriticalUncoveredAfter: 8,
        },
      ];
    });
    const res = runGuard(manifestPath);
    expect(res.ok).toBe(false);
    expect(res.output).toContain('must satisfy +3 routes OR +2% coverage');
  });

  it('fails when a safety-critical route appears in C3-4 routes', () => {
    const manifestPath = writeFixture('safety-route-leak', (manifest) => {
      manifest.inventoryStatus = 'active';
      manifest.residualInventory = {
        agreedThreshold: 8,
        currentUncoveredCount: 8,
        routes: [],
      };
      manifest.batches = [
        {
          batchId: 'C3-4-B1',
          date: '2026-05-11',
          prRef: 'PR-1',
          owner: 'qa-platform',
          routesAdded: [
            {
              method: 'POST',
              route: '/api/v1/clinical-notes/',
            },
            { method: 'GET', route: '/api/v1/non-critical-two' },
            { method: 'GET', route: '/api/v1/non-critical-three' },
          ],
          coveredRoutesDelta: 3,
          coverageGainPercent: 2.1,
          nonCriticalUncoveredAfter: 8,
        },
      ];
    });
    const res = runGuard(manifestPath);
    expect(res.ok).toBe(false);
    expect(res.output).toContain('is safety-critical and must stay in C3-2');
  });
});
