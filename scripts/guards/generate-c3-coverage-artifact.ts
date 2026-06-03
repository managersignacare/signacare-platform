#!/usr/bin/env tsx
/**
 * C3-3 / BUG-429:
 * Generates machine-readable C3 coverage evidence artifact.
 *
 * Output default:
 *   artifacts/c3/c3-coverage-evidence.json
 */

import { execSync } from 'node:child_process';
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { runGuard as runSafetyRouteCoverageGuard } from './check-safety-route-integration-coverage';

const ROOT = resolve(__dirname, '..', '..');
const DEFAULT_OUTPUT = resolve(ROOT, 'artifacts', 'c3', 'c3-coverage-evidence.json');
const SAFETY_ROUTE_MANIFEST = resolve(ROOT, '.github', 'safety-route-integration-manifest.json');
const C3_NONCRITICAL_BACKFILL_MANIFEST = resolve(ROOT, '.github', 'c3-noncritical-coverage-backfill.json');
const STATE_OF_WORLD = resolve(ROOT, 'docs', 'quality', 'remediation', 'state-of-world.md');
const ALLOWLIST_DIR = resolve(ROOT, 'scripts', 'guards');

type SuiteStatus = 'success' | 'failure' | 'cancelled' | 'skipped' | 'unknown';

interface SafetyRouteManifest {
  entries: Array<Record<string, unknown>>;
}

type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' | 'HEAD';
type InventoryStatus = 'baseline_pending' | 'active' | 'ready_for_closure';

interface BackfillBatch {
  batchId: string;
  date: string;
  prRef: string;
  owner: string;
  routesAdded: Array<{ method: HttpMethod; route: string }>;
  coveredRoutesDelta: number;
  coverageGainPercent: number;
  nonCriticalUncoveredAfter: number;
}

interface NonCriticalBackfillManifest {
  version: number;
  bugId: string;
  inventoryStatus: InventoryStatus;
  policy: {
    maxRoutesPerBatchPr: number;
    minCoveredRoutesDelta: number;
    minCoverageGainPercent: number;
    maxBatchesBeforeRetriage: number;
  };
  batches: BackfillBatch[];
  residualInventory: {
    agreedThreshold: number | null;
    currentUncoveredCount: number | null;
    routes: Array<{
      method: HttpMethod;
      route: string;
      owner: string;
      deadline: string;
      note: string;
    }>;
  };
  retriage: {
    requiredAfterBatch: number;
    performed: boolean;
    evidenceRef: string;
  };
}

interface GovernanceBinding {
  owner: string;
  refreshSlaHours: number;
  schemaPath: string;
  artifactPathCi: string;
  lastReviewedDate: string;
}

function nowIso(): string {
  return new Date().toISOString();
}

function normalizeStatus(v: string | undefined): SuiteStatus {
  switch ((v ?? '').toLowerCase()) {
    case 'success':
      return 'success';
    case 'failure':
      return 'failure';
    case 'cancelled':
      return 'cancelled';
    case 'skipped':
      return 'skipped';
    default:
      return 'unknown';
  }
}

function gitSha(): string {
  if (process.env.GITHUB_SHA && /^[0-9a-f]{40}$/i.test(process.env.GITHUB_SHA)) {
    return process.env.GITHUB_SHA.toLowerCase();
  }
  return execSync('git rev-parse HEAD', { cwd: ROOT, encoding: 'utf8' }).trim().toLowerCase();
}

function parseGovernanceBinding(source: string): GovernanceBinding {
  const sectionMatch = /## Coverage Artifact Governance \(C3-3 \/ BUG-429\)([\s\S]*?)(?:\n## |\n# |$)/.exec(source);
  if (!sectionMatch) {
    throw new Error('state-of-world is missing "Coverage Artifact Governance (C3-3 / BUG-429)" section');
  }
  const block = sectionMatch[1];

  const owner = /- Owner:\s*(.+)/.exec(block)?.[1]?.trim();
  const sla = /- Refresh SLA Hours:\s*(\d+)/.exec(block)?.[1]?.trim();
  const schemaPath = /- Artifact Schema Path:\s*`([^`]+)`/.exec(block)?.[1]?.trim();
  const artifactPathCi = /- Artifact CI Output Path:\s*`([^`]+)`/.exec(block)?.[1]?.trim();
  const lastReviewedDate = /- Last Reviewed Date:\s*(\d{4}-\d{2}-\d{2})/.exec(block)?.[1]?.trim();

  if (!owner) throw new Error('state-of-world governance missing Owner');
  if (!sla) throw new Error('state-of-world governance missing Refresh SLA Hours');
  if (!schemaPath) throw new Error('state-of-world governance missing Artifact Schema Path');
  if (!artifactPathCi) throw new Error('state-of-world governance missing Artifact CI Output Path');
  if (!lastReviewedDate) throw new Error('state-of-world governance missing Last Reviewed Date');

  return {
    owner,
    refreshSlaHours: Number(sla),
    schemaPath,
    artifactPathCi,
    lastReviewedDate,
  };
}

function summarizeAllowlistDebt(): {
  filesScanned: number;
  totalEntries: number;
  entriesWithExpiry: number;
  entriesPermanent: number;
  expiredOrInvalidEntries: number;
} {
  const today = new Date();
  const files = readdirSync(ALLOWLIST_DIR).filter((f) => f.endsWith('.allowlist'));
  let totalEntries = 0;
  let entriesWithExpiry = 0;
  let entriesPermanent = 0;
  let expiredOrInvalidEntries = 0;

  for (const file of files) {
    const content = readFileSync(join(ALLOWLIST_DIR, file), 'utf8');
    const lines = content.split('\n');
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      totalEntries++;
      const expires = /\|\s*expires:\s*(\d{4}-\d{2}-\d{2})/i.exec(line);
      const permanent = /\|\s*permanent:/i.test(line);
      const needsReview = /\|\s*expires:\s*needs-review/i.test(line);

      if (needsReview) {
        expiredOrInvalidEntries++;
        continue;
      }
      if (permanent) {
        entriesPermanent++;
        continue;
      }
      if (!expires) {
        expiredOrInvalidEntries++;
        continue;
      }

      entriesWithExpiry++;
      const expiryDate = new Date(`${expires[1]}T00:00:00.000Z`);
      if (Number.isNaN(expiryDate.getTime()) || expiryDate < today) {
        expiredOrInvalidEntries++;
      }
    }
  }

  return {
    filesScanned: files.length,
    totalEntries,
    entriesWithExpiry,
    entriesPermanent,
    expiredOrInvalidEntries,
  };
}

function main(): number {
  const outPath = process.argv[2] ? resolve(ROOT, process.argv[2]) : DEFAULT_OUTPUT;
  mkdirSync(dirname(outPath), { recursive: true });

  const manifest = JSON.parse(readFileSync(SAFETY_ROUTE_MANIFEST, 'utf8')) as SafetyRouteManifest;
  const c3Backfill = JSON.parse(
    readFileSync(C3_NONCRITICAL_BACKFILL_MANIFEST, 'utf8'),
  ) as NonCriticalBackfillManifest;
  const totalRequiredRoutes = manifest.entries.length;
  const safetyCoverage = runSafetyRouteCoverageGuard();
  const uncoveredRoutes = safetyCoverage.violations.filter((v) =>
    v.reason.includes('no mapped integration assertion'),
  ).length;
  const mappingViolations = safetyCoverage.violations.length - uncoveredRoutes;
  const coveredRoutes = Math.max(0, totalRequiredRoutes - uncoveredRoutes);

  const suiteResults = [
    { key: 'lint', label: 'Lint', required: true, status: normalizeStatus(process.env.GATE_LINT) },
    { key: 'typecheck', label: 'Typecheck', required: true, status: normalizeStatus(process.env.GATE_TYPECHECK) },
    { key: 'test-unit', label: 'Unit Tests', required: true, status: normalizeStatus(process.env.GATE_TEST_UNIT) },
    { key: 'test-integration', label: 'Integration Tests', required: true, status: normalizeStatus(process.env.GATE_TEST_INTEGRATION) },
    { key: 'e2e-smoke', label: 'E2E Smoke', required: true, status: normalizeStatus(process.env.GATE_E2E_SMOKE) },
    { key: 'a11y', label: 'A11y', required: true, status: normalizeStatus(process.env.GATE_A11Y) },
    { key: 'claude-discipline-guard', label: 'Discipline Guard', required: true, status: normalizeStatus(process.env.GATE_CLAUDE_DISCIPLINE) },
    { key: 'integration-url-guard', label: 'Integration URL Guard', required: true, status: normalizeStatus(process.env.GATE_INTEGRATION_URL) },
    { key: 'safety-route-coverage-guard', label: 'Safety Route Coverage Guard', required: true, status: normalizeStatus(process.env.GATE_SAFETY_ROUTE_COVERAGE) },
    { key: 'c3-noncritical-backfill-guard', label: 'C3 Non-Critical Backfill Guard', required: true, status: normalizeStatus(process.env.GATE_C3_BACKFILL_BATCH) },
  ] as const;

  const gateVerdicts = Object.fromEntries(suiteResults.map((s) => [s.key, s.status]));
  const overallVerdict = suiteResults.every((s) => !s.required || s.status === 'success') && safetyCoverage.exitCode === 0
    ? 'green'
    : 'red';

  const governance = parseGovernanceBinding(readFileSync(STATE_OF_WORLD, 'utf8'));

  const artifact = {
    schemaVersion: 1,
    artifactType: 'c3-coverage-evidence',
    generatedAt: nowIso(),
    commitSha: gitSha(),
    ref: process.env.GITHUB_REF_NAME ?? process.env.GITHUB_REF ?? 'local',
    runId: process.env.GITHUB_RUN_ID ?? 'local',
    suiteResults,
    routeCoverageSummary: {
      manifestPath: '.github/safety-route-integration-manifest.json',
      totalRequiredRoutes,
      coveredRoutes,
      uncoveredRoutes,
      mappingViolations,
    },
    allowlistDebt: summarizeAllowlistDebt(),
    nonCriticalBackfill: {
      manifestPath: '.github/c3-noncritical-coverage-backfill.json',
      inventoryStatus: c3Backfill.inventoryStatus,
      policy: c3Backfill.policy,
      batchCount: c3Backfill.batches.length,
      batches: c3Backfill.batches.map((batch) => ({
        batchId: batch.batchId,
        date: batch.date,
        prRef: batch.prRef,
        owner: batch.owner,
        routeCount: batch.routesAdded.length,
        coveredRoutesDelta: batch.coveredRoutesDelta,
        coverageGainPercent: batch.coverageGainPercent,
        nonCriticalUncoveredAfter: batch.nonCriticalUncoveredAfter,
      })),
      residualThreshold: c3Backfill.residualInventory.agreedThreshold,
      residualUncoveredCount: c3Backfill.residualInventory.currentUncoveredCount,
      residualRoutes: c3Backfill.residualInventory.routes,
      retriagePerformed: c3Backfill.retriage.performed,
    },
    gateVerdicts,
    overallVerdict,
    stateOfWorldGovernance: {
      stateFilePath: 'docs/quality/remediation/state-of-world.md',
      owner: governance.owner,
      refreshSlaHours: governance.refreshSlaHours,
      schemaPath: governance.schemaPath,
      artifactPathCi: governance.artifactPathCi,
      lastReviewedDate: governance.lastReviewedDate,
    },
  };

  writeFileSync(outPath, `${JSON.stringify(artifact, null, 2)}\n`, 'utf8');
  console.log(`Generated C3 coverage artifact: ${outPath}`);
  console.log(`overallVerdict: ${artifact.overallVerdict}`);
  return 0;
}

if (require.main === module) {
  process.exitCode = main();
}
