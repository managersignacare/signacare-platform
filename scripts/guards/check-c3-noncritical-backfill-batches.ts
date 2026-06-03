#!/usr/bin/env tsx
/**
 * C3-4 / BUG-453 guard:
 * Enforce explicit non-critical coverage backfill batch boundaries.
 *
 * Contract:
 * - max 5 routes per batch PR
 * - each batch must gain +3 covered routes OR +2% coverage
 * - hard stop after 4 batches unless re-triage is marked performed
 * - safety-critical routes (C3-2 manifest) cannot appear in this backlog
 * - residual routes require owner + deadline
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const ROOT = resolve(__dirname, '..', '..');
const DEFAULT_MANIFEST = resolve(ROOT, '.github', 'c3-noncritical-coverage-backfill.json');
const SAFETY_MANIFEST = resolve(ROOT, '.github', 'safety-route-integration-manifest.json');

type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' | 'HEAD';
type InventoryStatus = 'baseline_pending' | 'active' | 'ready_for_closure';

interface RouteRef {
  method: HttpMethod;
  route: string;
}

interface BatchEntry {
  batchId: string;
  date: string;
  prRef: string;
  owner: string;
  routesAdded: RouteRef[];
  coveredRoutesDelta: number;
  coverageGainPercent: number;
  nonCriticalUncoveredAfter: number;
}

interface ResidualRoute extends RouteRef {
  owner: string;
  deadline: string;
  note: string;
}

interface BackfillManifest {
  version: number;
  bugId: string;
  inventoryStatus: InventoryStatus;
  policy: {
    maxRoutesPerBatchPr: number;
    minCoveredRoutesDelta: number;
    minCoverageGainPercent: number;
    maxBatchesBeforeRetriage: number;
  };
  batches: BatchEntry[];
  residualInventory: {
    agreedThreshold: number | null;
    currentUncoveredCount: number | null;
    routes: ResidualRoute[];
  };
  retriage: {
    requiredAfterBatch: number;
    performed: boolean;
    evidenceRef: string;
  };
}

interface SafetyManifest {
  entries: Array<{ method: HttpMethod; route: string }>;
}

function isIsoDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const d = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value;
}

function canonicalRoute(route: string): string {
  return route.trim().replace(/\/+$/, '') || '/';
}

function routeKey(method: HttpMethod, route: string): string {
  return `${method} ${canonicalRoute(route)}`;
}

function main(): number {
  const manifestPath = process.argv[2] ? resolve(ROOT, process.argv[2]) : DEFAULT_MANIFEST;
  const violations: string[] = [];

  let manifest: BackfillManifest;
  let safety: SafetyManifest;
  try {
    manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as BackfillManifest;
  } catch (error) {
    console.error(`✗ failed to load ${manifestPath}: ${error instanceof Error ? error.message : String(error)}`);
    return 1;
  }

  try {
    safety = JSON.parse(readFileSync(SAFETY_MANIFEST, 'utf8')) as SafetyManifest;
  } catch (error) {
    console.error(`✗ failed to load ${SAFETY_MANIFEST}: ${error instanceof Error ? error.message : String(error)}`);
    return 1;
  }

  if (manifest.version !== 1) {
    violations.push('version must be 1');
  }
  if (manifest.bugId !== 'BUG-453') {
    violations.push('bugId must be BUG-453');
  }

  const expectedPolicy = {
    maxRoutesPerBatchPr: 5,
    minCoveredRoutesDelta: 3,
    minCoverageGainPercent: 2,
    maxBatchesBeforeRetriage: 4,
  };
  if (manifest.policy.maxRoutesPerBatchPr !== expectedPolicy.maxRoutesPerBatchPr) {
    violations.push('policy.maxRoutesPerBatchPr must be 5');
  }
  if (manifest.policy.minCoveredRoutesDelta !== expectedPolicy.minCoveredRoutesDelta) {
    violations.push('policy.minCoveredRoutesDelta must be 3');
  }
  if (manifest.policy.minCoverageGainPercent !== expectedPolicy.minCoverageGainPercent) {
    violations.push('policy.minCoverageGainPercent must be 2');
  }
  if (manifest.policy.maxBatchesBeforeRetriage !== expectedPolicy.maxBatchesBeforeRetriage) {
    violations.push('policy.maxBatchesBeforeRetriage must be 4');
  }
  if (manifest.retriage.requiredAfterBatch !== manifest.policy.maxBatchesBeforeRetriage) {
    violations.push('retriage.requiredAfterBatch must equal policy.maxBatchesBeforeRetriage');
  }

  const safetyKeys = new Set(safety.entries.map((e) => routeKey(e.method, e.route)));
  const batchIds = new Set<string>();

  for (const [idx, batch] of manifest.batches.entries()) {
    const p = `batches[${idx}]`;
    if (!batch.batchId) violations.push(`${p}.batchId is required`);
    if (batch.batchId && batchIds.has(batch.batchId)) violations.push(`${p}.batchId must be unique`);
    if (batch.batchId) batchIds.add(batch.batchId);
    if (!isIsoDate(batch.date)) violations.push(`${p}.date must be YYYY-MM-DD`);
    if (!batch.owner) violations.push(`${p}.owner is required`);
    if (!batch.prRef) violations.push(`${p}.prRef is required`);
    if (!Array.isArray(batch.routesAdded) || batch.routesAdded.length === 0) {
      violations.push(`${p}.routesAdded must include at least one route`);
    }
    if (batch.routesAdded.length > manifest.policy.maxRoutesPerBatchPr) {
      violations.push(`${p} exceeds maxRoutesPerBatchPr (${manifest.policy.maxRoutesPerBatchPr})`);
    }
    if (
      batch.coveredRoutesDelta < manifest.policy.minCoveredRoutesDelta
      && batch.coverageGainPercent < manifest.policy.minCoverageGainPercent
    ) {
      violations.push(
        `${p} must satisfy +${manifest.policy.minCoveredRoutesDelta} routes OR +${manifest.policy.minCoverageGainPercent}% coverage`,
      );
    }
    if (!Number.isInteger(batch.nonCriticalUncoveredAfter) || batch.nonCriticalUncoveredAfter < 0) {
      violations.push(`${p}.nonCriticalUncoveredAfter must be a non-negative integer`);
    }

    for (const [routeIdx, route] of batch.routesAdded.entries()) {
      const routePath = `${p}.routesAdded[${routeIdx}]`;
      const key = routeKey(route.method, route.route);
      if (safetyKeys.has(key)) {
        violations.push(`${routePath} (${key}) is safety-critical and must stay in C3-2`);
      }
    }
  }

  if (
    manifest.batches.length > manifest.policy.maxBatchesBeforeRetriage
    && !manifest.retriage.performed
  ) {
    violations.push(
      `hard stop breached: ${manifest.batches.length} batches > ${manifest.policy.maxBatchesBeforeRetriage} without retriage.performed=true`,
    );
  }

  for (const [idx, route] of manifest.residualInventory.routes.entries()) {
    const p = `residualInventory.routes[${idx}]`;
    if (!route.owner) violations.push(`${p}.owner is required`);
    if (!route.note) violations.push(`${p}.note is required`);
    if (!isIsoDate(route.deadline)) violations.push(`${p}.deadline must be YYYY-MM-DD`);
    const key = routeKey(route.method, route.route);
    if (safetyKeys.has(key)) {
      violations.push(`${p} (${key}) is safety-critical and cannot be relegated to C3-4 backlog`);
    }
  }

  if (manifest.inventoryStatus === 'baseline_pending') {
    if (manifest.batches.length !== 0) {
      violations.push('inventoryStatus=baseline_pending requires zero batches');
    }
    if (manifest.residualInventory.routes.length !== 0) {
      violations.push('inventoryStatus=baseline_pending requires empty residualInventory.routes');
    }
    if (manifest.residualInventory.agreedThreshold !== null) {
      violations.push('inventoryStatus=baseline_pending requires agreedThreshold=null');
    }
    if (manifest.residualInventory.currentUncoveredCount !== null) {
      violations.push('inventoryStatus=baseline_pending requires currentUncoveredCount=null');
    }
  } else {
    if (
      manifest.residualInventory.agreedThreshold === null
      || manifest.residualInventory.currentUncoveredCount === null
    ) {
      violations.push('active/ready_for_closure requires agreedThreshold and currentUncoveredCount');
    }
  }

  if (violations.length > 0) {
    console.error('✗ check-c3-noncritical-backfill-batches');
    for (const violation of violations) {
      console.error(`  - ${violation}`);
    }
    return 1;
  }

  console.log('✓ check-c3-noncritical-backfill-batches');
  console.log(`  manifest: ${manifestPath}`);
  console.log(`  inventoryStatus: ${manifest.inventoryStatus}`);
  console.log(`  batches: ${manifest.batches.length}`);
  return 0;
}

if (require.main === module) {
  process.exitCode = main();
}
