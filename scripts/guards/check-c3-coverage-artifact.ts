#!/usr/bin/env tsx
/**
 * C3-3 / BUG-429 consumer guard:
 * - validates generated coverage artifact against C3 schema contract
 * - validates commit/ref freshness constraints
 * - validates state-of-world governance binding + SLA freshness gate
 */

import { execSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const ROOT = resolve(__dirname, '..', '..');
const DEFAULT_ARTIFACT = resolve(ROOT, 'artifacts', 'c3', 'c3-coverage-evidence.json');
const DEFAULT_SCHEMA = resolve(ROOT, 'docs', 'quality', 'remediation', 'schemas', 'c3-coverage-evidence.schema.json');
const DEFAULT_STATE_OF_WORLD = resolve(ROOT, 'docs', 'quality', 'remediation', 'state-of-world.md');

type Status = 'success' | 'failure' | 'cancelled' | 'skipped' | 'unknown';

interface Violation {
  reason: string;
}

interface SchemaObject {
  type?: string | string[];
  required?: string[];
  properties?: Record<string, SchemaObject>;
  items?: SchemaObject;
  enum?: string[];
  const?: unknown;
  minimum?: number;
  pattern?: string;
  minLength?: number;
  minItems?: number;
  additionalProperties?: boolean | SchemaObject;
}

interface GovernanceBinding {
  owner: string;
  refreshSlaHours: number;
  schemaPath: string;
  artifactPathCi: string;
}

function isIsoDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const d = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value;
}

function parseJson(path: string): unknown {
  return JSON.parse(readFileSync(path, 'utf8'));
}

function nowMs(): number {
  return Date.now();
}

function parseDateMs(v: string): number {
  return new Date(v).getTime();
}

function normalizeStatus(v: unknown): Status {
  switch (String(v ?? '').toLowerCase()) {
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

function getLocalSha(): string {
  try {
    return execSync('git rev-parse HEAD', { cwd: ROOT, encoding: 'utf8' }).trim().toLowerCase();
  } catch {
    return '';
  }
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
    throw new Error('governance section missing required fields (owner/sla/schema/artifact path)');
  }

  return {
    owner,
    refreshSlaHours: Number(sla),
    schemaPath,
    artifactPathCi,
  };
}

function validateBySchema(
  value: unknown,
  schema: SchemaObject,
  at: string,
  violations: Violation[],
): void {
  if (Array.isArray(schema.type)) {
    const candidateTypes = schema.type;
    for (const candidateType of candidateTypes) {
      const probeViolations: Violation[] = [];
      validateBySchema(value, { ...schema, type: candidateType }, at, probeViolations);
      if (probeViolations.length === 0) {
        return;
      }
    }
    violations.push({
      reason: `${at}: value does not satisfy any allowed type [${candidateTypes.join(', ')}]`,
    });
    return;
  }

  if (schema.const !== undefined && value !== schema.const) {
    violations.push({ reason: `${at}: expected const ${JSON.stringify(schema.const)}; got ${JSON.stringify(value)}` });
    return;
  }

  if (schema.enum && !schema.enum.includes(String(value))) {
    violations.push({ reason: `${at}: value '${String(value)}' not in enum [${schema.enum.join(', ')}]` });
    return;
  }

  if (schema.type === 'object') {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      violations.push({ reason: `${at}: expected object` });
      return;
    }
    const obj = value as Record<string, unknown>;
    for (const key of schema.required ?? []) {
      if (!(key in obj)) violations.push({ reason: `${at}: missing required key '${key}'` });
    }
    if (schema.properties) {
      for (const [k, childSchema] of Object.entries(schema.properties)) {
        if (k in obj) validateBySchema(obj[k], childSchema, `${at}.${k}`, violations);
      }
    }
    if (schema.additionalProperties === false && schema.properties) {
      for (const key of Object.keys(obj)) {
        if (!(key in schema.properties)) {
          violations.push({ reason: `${at}: unexpected key '${key}'` });
        }
      }
    }
    return;
  }

  if (schema.type === 'array') {
    if (!Array.isArray(value)) {
      violations.push({ reason: `${at}: expected array` });
      return;
    }
    if (schema.minItems !== undefined && value.length < schema.minItems) {
      violations.push({ reason: `${at}: expected minItems ${schema.minItems}, got ${value.length}` });
    }
    if (schema.items) {
      value.forEach((item, idx) => validateBySchema(item, schema.items as SchemaObject, `${at}[${idx}]`, violations));
    }
    return;
  }

  if (schema.type === 'string') {
    if (typeof value !== 'string') {
      violations.push({ reason: `${at}: expected string` });
      return;
    }
    if (schema.minLength !== undefined && value.length < schema.minLength) {
      violations.push({ reason: `${at}: expected minLength ${schema.minLength}, got ${value.length}` });
    }
    if (schema.pattern && !(new RegExp(schema.pattern).test(value))) {
      violations.push({ reason: `${at}: value '${value}' does not match pattern ${schema.pattern}` });
    }
    return;
  }

  if (schema.type === 'integer') {
    if (typeof value !== 'number' || !Number.isInteger(value)) {
      violations.push({ reason: `${at}: expected integer` });
      return;
    }
    if (schema.minimum !== undefined && value < schema.minimum) {
      violations.push({ reason: `${at}: expected minimum ${schema.minimum}, got ${value}` });
    }
    return;
  }

  if (schema.type === 'number') {
    if (typeof value !== 'number' || Number.isNaN(value)) {
      violations.push({ reason: `${at}: expected number` });
      return;
    }
    if (schema.minimum !== undefined && value < schema.minimum) {
      violations.push({ reason: `${at}: expected minimum ${schema.minimum}, got ${value}` });
    }
    return;
  }

  if (schema.type === 'boolean' && typeof value !== 'boolean') {
    violations.push({ reason: `${at}: expected boolean` });
  }
}

function main(): number {
  const artifactPath = process.argv[2] ? resolve(ROOT, process.argv[2]) : DEFAULT_ARTIFACT;
  const schemaPath = DEFAULT_SCHEMA;
  const statePath = DEFAULT_STATE_OF_WORLD;
  const violations: Violation[] = [];

  if (!existsSync(artifactPath)) {
    console.error(`✗ coverage artifact missing: ${artifactPath}`);
    return 1;
  }
  if (!existsSync(schemaPath)) {
    console.error(`✗ schema missing: ${schemaPath}`);
    return 1;
  }
  if (!existsSync(statePath)) {
    console.error(`✗ state-of-world missing: ${statePath}`);
    return 1;
  }

  const artifact = parseJson(artifactPath) as Record<string, unknown>;
  const schema = parseJson(schemaPath) as SchemaObject;
  const stateSource = readFileSync(statePath, 'utf8');

  validateBySchema(artifact, schema, 'artifact', violations);

  const governance = (() => {
    try {
      return parseGovernanceBinding(stateSource);
    } catch (error) {
      violations.push({ reason: `state-of-world governance parse failed: ${error instanceof Error ? error.message : String(error)}` });
      return null;
    }
  })();

  const generatedAt = String(artifact.generatedAt ?? '');
  const generatedAtMs = parseDateMs(generatedAt);
  if (!Number.isFinite(generatedAtMs)) {
    violations.push({ reason: 'artifact.generatedAt is not a valid timestamp' });
  }

  const sha = String(artifact.commitSha ?? '').toLowerCase();
  const expectedSha = (process.env.GITHUB_SHA ?? getLocalSha()).toLowerCase();
  if (expectedSha && sha !== expectedSha) {
    violations.push({ reason: `artifact.commitSha (${sha}) does not match expected SHA (${expectedSha})` });
  }

  if (governance) {
    const artifactGov = artifact.stateOfWorldGovernance as Record<string, unknown> | undefined;
    if (!artifactGov || typeof artifactGov !== 'object') {
      violations.push({ reason: 'artifact.stateOfWorldGovernance missing' });
    } else {
      if (String(artifactGov.owner ?? '') !== governance.owner) {
        violations.push({ reason: 'artifact.stateOfWorldGovernance.owner does not match state-of-world owner' });
      }
      if (Number(artifactGov.refreshSlaHours ?? -1) !== governance.refreshSlaHours) {
        violations.push({ reason: 'artifact.stateOfWorldGovernance.refreshSlaHours does not match state-of-world SLA' });
      }
      if (String(artifactGov.schemaPath ?? '') !== governance.schemaPath) {
        violations.push({ reason: 'artifact.stateOfWorldGovernance.schemaPath does not match state-of-world schema path' });
      }
      if (String(artifactGov.artifactPathCi ?? '') !== governance.artifactPathCi) {
        violations.push({ reason: 'artifact.stateOfWorldGovernance.artifactPathCi does not match state-of-world artifact path' });
      }
    }

    if (Number.isFinite(generatedAtMs)) {
      const ageMs = nowMs() - generatedAtMs;
      const maxAgeMs = governance.refreshSlaHours * 60 * 60 * 1000;
      if (ageMs > maxAgeMs) {
        violations.push({
          reason: `artifact freshness SLA breached: age=${Math.floor(ageMs / 3600000)}h > ${governance.refreshSlaHours}h`,
        });
      }
    }
  }

  const gateVerdicts = (artifact.gateVerdicts ?? {}) as Record<string, unknown>;
  const requiredGateKeys = [
    'lint',
    'typecheck',
    'test-unit',
    'test-integration',
    'e2e-smoke',
    'a11y',
    'claude-discipline-guard',
    'integration-url-guard',
    'safety-route-coverage-guard',
    'c3-noncritical-backfill-guard',
  ];
  for (const key of requiredGateKeys) {
    if (!(key in gateVerdicts)) {
      violations.push({ reason: `artifact.gateVerdicts missing key '${key}'` });
      continue;
    }
    const status = normalizeStatus(gateVerdicts[key]);
    if (status === 'unknown') {
      violations.push({ reason: `artifact.gateVerdicts['${key}'] has unknown status` });
    }
  }

  const overallVerdict = String(artifact.overallVerdict ?? '');
  const hasFailure = requiredGateKeys.some((k) => normalizeStatus(gateVerdicts[k]) !== 'success');
  if (hasFailure && overallVerdict !== 'red') {
    violations.push({ reason: 'artifact.overallVerdict must be red when required gate has non-success status' });
  }
  if (!hasFailure && overallVerdict !== 'green') {
    violations.push({ reason: 'artifact.overallVerdict must be green when required gates are all success' });
  }

  const nonCriticalBackfill = artifact.nonCriticalBackfill as Record<string, unknown> | undefined;
  if (!nonCriticalBackfill || typeof nonCriticalBackfill !== 'object') {
    violations.push({ reason: 'artifact.nonCriticalBackfill missing' });
  } else {
    const inventoryStatus = String(nonCriticalBackfill.inventoryStatus ?? '');
    const policy = nonCriticalBackfill.policy as Record<string, unknown> | undefined;
    const batches = Array.isArray(nonCriticalBackfill.batches)
      ? (nonCriticalBackfill.batches as Array<Record<string, unknown>>)
      : null;
    const batchCount = Number(nonCriticalBackfill.batchCount ?? -1);
    const retriagePerformed = Boolean(nonCriticalBackfill.retriagePerformed ?? false);

    if (!['baseline_pending', 'active', 'ready_for_closure'].includes(inventoryStatus)) {
      violations.push({ reason: 'artifact.nonCriticalBackfill.inventoryStatus invalid' });
    }
    if (!policy || typeof policy !== 'object') {
      violations.push({ reason: 'artifact.nonCriticalBackfill.policy missing' });
    }
    if (!batches) {
      violations.push({ reason: 'artifact.nonCriticalBackfill.batches must be an array' });
    }
    if (batches && Number.isInteger(batchCount) && batchCount !== batches.length) {
      violations.push({ reason: 'artifact.nonCriticalBackfill.batchCount does not match batches.length' });
    }

    if (policy && typeof policy === 'object' && batches) {
      const maxRoutesPerBatchPr = Number(policy.maxRoutesPerBatchPr ?? -1);
      const minCoveredRoutesDelta = Number(policy.minCoveredRoutesDelta ?? -1);
      const minCoverageGainPercent = Number(policy.minCoverageGainPercent ?? -1);
      const maxBatchesBeforeRetriage = Number(policy.maxBatchesBeforeRetriage ?? -1);

      for (const [idx, batch] of batches.entries()) {
        const routeCount = Number(batch.routeCount ?? -1);
        const coveredRoutesDelta = Number(batch.coveredRoutesDelta ?? -1);
        const coverageGainPercent = Number(batch.coverageGainPercent ?? -1);
        const date = String(batch.date ?? '');
        if (!isIsoDate(date)) {
          violations.push({ reason: `artifact.nonCriticalBackfill.batches[${idx}].date must be YYYY-MM-DD` });
        }
        if (routeCount > maxRoutesPerBatchPr) {
          violations.push({ reason: `artifact.nonCriticalBackfill.batches[${idx}] exceeds maxRoutesPerBatchPr` });
        }
        if (coveredRoutesDelta < minCoveredRoutesDelta && coverageGainPercent < minCoverageGainPercent) {
          violations.push({
            reason: `artifact.nonCriticalBackfill.batches[${idx}] fails minimum delta contract (+${minCoveredRoutesDelta} routes or +${minCoverageGainPercent}%)`,
          });
        }
      }

      if (batches.length > maxBatchesBeforeRetriage && !retriagePerformed) {
        violations.push({ reason: 'artifact.nonCriticalBackfill breached max batches without retriagePerformed=true' });
      }
    }

    const residualThreshold = nonCriticalBackfill.residualThreshold as number | null;
    const residualUncoveredCount = nonCriticalBackfill.residualUncoveredCount as number | null;
    if (inventoryStatus === 'baseline_pending') {
      if (batches && batches.length !== 0) {
        violations.push({ reason: 'baseline_pending requires zero backfill batches' });
      }
      if (residualThreshold !== null || residualUncoveredCount !== null) {
        violations.push({ reason: 'baseline_pending requires residualThreshold/residualUncoveredCount to be null' });
      }
    } else if (residualThreshold == null || residualUncoveredCount == null) {
      violations.push({ reason: 'active/ready_for_closure requires residualThreshold and residualUncoveredCount' });
    }
  }

  if (violations.length > 0) {
    console.error('✗ check-c3-coverage-artifact');
    for (const v of violations) {
      console.error(`  - ${v.reason}`);
    }
    return 1;
  }

  console.log('✓ check-c3-coverage-artifact');
  console.log(`  artifact: ${artifactPath}`);
  console.log(`  schema:   ${schemaPath}`);
  return 0;
}

if (require.main === module) {
  process.exitCode = main();
}
