import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdirSync, rmSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';

const TMP_BASE = join(tmpdir(), 'check-c3-coverage-artifact-fixtures');
const SCRIPT = join(process.cwd(), 'scripts', 'guards', 'check-c3-coverage-artifact.ts');
const STATE_OF_WORLD = join(process.cwd(), 'docs', 'quality', 'remediation', 'state-of-world.md');

interface GovernanceBinding {
  owner: string;
  refreshSlaHours: number;
  schemaPath: string;
  artifactPathCi: string;
}

function parseGovernanceBinding(source: string): GovernanceBinding {
  const sectionMatch = /## Coverage Artifact Governance \(C3-3 \/ BUG-429\)([\s\S]*?)(?:\n## |\n# |$)/.exec(source);
  if (!sectionMatch) throw new Error('missing governance section in state-of-world');
  const block = sectionMatch[1];
  const owner = /- Owner:\s*(.+)/.exec(block)?.[1]?.trim();
  const sla = /- Refresh SLA Hours:\s*(\d+)/.exec(block)?.[1]?.trim();
  const schemaPath = /- Artifact Schema Path:\s*`([^`]+)`/.exec(block)?.[1]?.trim();
  const artifactPathCi = /- Artifact CI Output Path:\s*`([^`]+)`/.exec(block)?.[1]?.trim();
  if (!owner || !sla || !schemaPath || !artifactPathCi) {
    throw new Error('state-of-world governance section missing required fields');
  }
  return { owner, refreshSlaHours: Number(sla), schemaPath, artifactPathCi };
}

const governance = parseGovernanceBinding(readFileSync(STATE_OF_WORLD, 'utf8'));

beforeAll(() => {
  if (existsSync(TMP_BASE)) rmSync(TMP_BASE, { recursive: true, force: true });
  mkdirSync(TMP_BASE, { recursive: true });
});

afterAll(() => {
  if (existsSync(TMP_BASE)) rmSync(TMP_BASE, { recursive: true, force: true });
});

function writeFixture(name: string, mutate?: (artifact: Record<string, unknown>) => void): string {
  const dir = join(TMP_BASE, name);
  mkdirSync(dir, { recursive: true });

  const now = new Date().toISOString();
  const artifact: Record<string, unknown> = {
    schemaVersion: 1,
    artifactType: 'c3-coverage-evidence',
    generatedAt: now,
    commitSha: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    ref: 'local',
    runId: 'local',
    suiteResults: [
      { key: 'lint', label: 'Lint', required: true, status: 'success' },
    ],
    routeCoverageSummary: {
      manifestPath: '.github/safety-route-integration-manifest.json',
      totalRequiredRoutes: 1,
      coveredRoutes: 1,
      uncoveredRoutes: 0,
      mappingViolations: 0,
    },
    allowlistDebt: {
      filesScanned: 1,
      totalEntries: 1,
      entriesWithExpiry: 1,
      entriesPermanent: 0,
      expiredOrInvalidEntries: 0,
    },
    nonCriticalBackfill: {
      manifestPath: '.github/c3-noncritical-coverage-backfill.json',
      inventoryStatus: 'baseline_pending',
      policy: {
        maxRoutesPerBatchPr: 5,
        minCoveredRoutesDelta: 3,
        minCoverageGainPercent: 2,
        maxBatchesBeforeRetriage: 4,
      },
      batchCount: 0,
      batches: [],
      residualThreshold: null,
      residualUncoveredCount: null,
      residualRoutes: [],
      retriagePerformed: false,
    },
    gateVerdicts: {
      lint: 'success',
      typecheck: 'success',
      'test-unit': 'success',
      'test-integration': 'success',
      'e2e-smoke': 'success',
      a11y: 'success',
      'claude-discipline-guard': 'success',
      'integration-url-guard': 'success',
      'safety-route-coverage-guard': 'success',
      'c3-noncritical-backfill-guard': 'success',
    },
    overallVerdict: 'green',
    stateOfWorldGovernance: {
      stateFilePath: 'docs/quality/remediation/state-of-world.md',
      owner: governance.owner,
      refreshSlaHours: governance.refreshSlaHours,
      schemaPath: governance.schemaPath,
      artifactPathCi: governance.artifactPathCi,
      lastReviewedDate: '2026-05-11',
    },
  };

  mutate?.(artifact);
  const artifactPath = join(dir, 'artifact.json');
  writeFileSync(artifactPath, `${JSON.stringify(artifact, null, 2)}\n`, 'utf8');
  return artifactPath;
}

function runGuard(artifactPath: string, env: Record<string, string> = {}): { ok: boolean; output: string } {
  try {
    const output = execFileSync(
      'npx',
      ['tsx', SCRIPT, artifactPath],
      {
        cwd: process.cwd(),
        env: { ...process.env, ...env },
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
      },
    );
    return { ok: true, output };
  } catch (error) {
    const out = error instanceof Error && 'stdout' in error ? String((error as { stdout?: string }).stdout ?? '') : '';
    const err = error instanceof Error && 'stderr' in error ? String((error as { stderr?: string }).stderr ?? '') : '';
    return { ok: false, output: `${out}\n${err}` };
  }
}

describe('check-c3-coverage-artifact', () => {
  it('passes on a valid artifact', () => {
    const artifactPath = writeFixture('pass');
    const res = runGuard(artifactPath, {
      GITHUB_SHA: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    });
    expect(res.ok).toBe(true);
    expect(res.output).toContain('✓ check-c3-coverage-artifact');
  });

  it('fails when schema-required field is missing', () => {
    const artifactPath = writeFixture('missing-field', (artifact) => {
      delete artifact.routeCoverageSummary;
    });
    const res = runGuard(artifactPath, {
      GITHUB_SHA: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    });
    expect(res.ok).toBe(false);
    expect(res.output).toContain("missing required key 'routeCoverageSummary'");
  });

  it('fails when commit SHA does not match expected SHA', () => {
    const artifactPath = writeFixture('sha-mismatch');
    const res = runGuard(artifactPath, {
      GITHUB_SHA: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
    });
    expect(res.ok).toBe(false);
    expect(res.output).toContain('does not match expected SHA');
  });
});
