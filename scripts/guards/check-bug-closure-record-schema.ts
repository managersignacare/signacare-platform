#!/usr/bin/env tsx
/**
 * Closure-record schema guard (Step-1 governance lock).
 *
 * Enforces machine-validated bug closure records so catalogue flips remain
 * auditable and structurally consistent across lanes.
 */

import { existsSync, readFileSync } from 'node:fs';
import { resolve, relative } from 'node:path';

const REPO_ROOT = resolve(__dirname, '..', '..');
const DEFAULT_REGISTRY = resolve(REPO_ROOT, '.github', 'bug-closure-records.json');
const DEFAULT_SCHEMA = resolve(REPO_ROOT, 'docs', 'quality', 'remediation', 'schemas', 'bug-closure-record.schema.json');

type Violation = {
  reason: string;
};

type GuardResult = {
  exitCode: number;
  violations: Violation[];
};

type RegistryRecord = {
  bugId: string;
  lane: string;
  status: 'r0_ready' | 'r1_closure_pending' | 'closed';
  fixCommitSha: string;
  guards: string[];
  regressionTests: string[];
  evidenceArtifacts: string[];
  approvers: Array<{
    role: string;
    name: string;
    date: string;
  }>;
  lastValidatedAt: string;
  rolloutEvidence?: {
    canaryEvidenceRef: string;
    burnInEvidenceRef: string;
    postBurnInEvidenceRef: string;
  };
};

type Registry = {
  version: number;
  generatedAt: string;
  records: RegistryRecord[];
};

const BUG_ID_RE = /^BUG-[A-Z0-9._-]+$/;
const SHA_RE = /^[a-f0-9]{7,40}$/;
const GUARD_RE = /^guard:[a-z0-9:-]+$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function isIsoDateTime(value: string): boolean {
  const t = Date.parse(value);
  return !Number.isNaN(t) && value.includes('T');
}

function rel(path: string): string {
  return relative(REPO_ROOT, path).replaceAll('\\', '/');
}

function parseJson(path: string): unknown {
  return JSON.parse(readFileSync(path, 'utf8'));
}

export function runGuard(
  root: string = REPO_ROOT,
  registryPathOverride?: string,
  schemaPathOverride?: string,
): GuardResult {
  const violations: Violation[] = [];
  const registryPath = registryPathOverride ?? resolve(root, '.github', 'bug-closure-records.json');
  const schemaPath = schemaPathOverride ?? resolve(root, 'docs', 'quality', 'remediation', 'schemas', 'bug-closure-record.schema.json');

  if (!existsSync(schemaPath)) {
    violations.push({ reason: `schema missing: ${schemaPath}` });
    return { exitCode: 1, violations };
  }
  if (!existsSync(registryPath)) {
    violations.push({ reason: `registry missing: ${registryPath}` });
    return { exitCode: 1, violations };
  }

  // Parse schema to ensure the declared contract file itself is valid JSON
  try {
    parseJson(schemaPath);
  } catch (error) {
    violations.push({
      reason: `schema is not valid JSON: ${error instanceof Error ? error.message : String(error)}`,
    });
    return { exitCode: 1, violations };
  }

  let registry: Registry;
  try {
    registry = parseJson(registryPath) as Registry;
  } catch (error) {
    violations.push({
      reason: `registry is not valid JSON: ${error instanceof Error ? error.message : String(error)}`,
    });
    return { exitCode: 1, violations };
  }

  if (registry.version !== 1) {
    violations.push({ reason: 'registry.version must be 1' });
  }
  if (typeof registry.generatedAt !== 'string' || !isIsoDateTime(registry.generatedAt)) {
    violations.push({ reason: 'registry.generatedAt must be ISO datetime' });
  }
  if (!Array.isArray(registry.records)) {
    violations.push({ reason: 'registry.records must be an array' });
    return { exitCode: 1, violations };
  }

  const bugIds = new Set<string>();
  for (const [idx, record] of registry.records.entries()) {
    const p = `records[${idx}]`;
    if (!BUG_ID_RE.test(record.bugId)) {
      violations.push({ reason: `${p}.bugId invalid (${record.bugId})` });
    }
    if (bugIds.has(record.bugId)) {
      violations.push({ reason: `${p}.bugId duplicate (${record.bugId})` });
    } else {
      bugIds.add(record.bugId);
    }

    if (!record.lane || record.lane.trim().length < 2) {
      violations.push({ reason: `${p}.lane required` });
    }
    if (!['r0_ready', 'r1_closure_pending', 'closed'].includes(record.status)) {
      violations.push({ reason: `${p}.status must be r0_ready | r1_closure_pending | closed` });
    }
    if (!SHA_RE.test(record.fixCommitSha)) {
      violations.push({ reason: `${p}.fixCommitSha must be 7..40 lower-hex chars` });
    }

    if (!Array.isArray(record.guards) || record.guards.length === 0) {
      violations.push({ reason: `${p}.guards must be non-empty` });
    } else {
      for (const [guardIdx, guard] of record.guards.entries()) {
        if (!GUARD_RE.test(guard)) {
          violations.push({ reason: `${p}.guards[${guardIdx}] must match guard:<name>` });
        }
      }
    }

    if (!Array.isArray(record.regressionTests) || record.regressionTests.length === 0) {
      violations.push({ reason: `${p}.regressionTests must be non-empty` });
    }

    if (!Array.isArray(record.evidenceArtifacts) || record.evidenceArtifacts.length === 0) {
      violations.push({ reason: `${p}.evidenceArtifacts must be non-empty` });
    } else {
      for (const [artifactIdx, artifactPath] of record.evidenceArtifacts.entries()) {
        const absolute = resolve(root, artifactPath);
        if (!existsSync(absolute)) {
          violations.push({
            reason: `${p}.evidenceArtifacts[${artifactIdx}] does not exist (${artifactPath})`,
          });
        }
      }
    }

    if (!Array.isArray(record.approvers) || record.approvers.length === 0) {
      violations.push({ reason: `${p}.approvers must be non-empty` });
    } else {
      for (const [approverIdx, approver] of record.approvers.entries()) {
        const ap = `${p}.approvers[${approverIdx}]`;
        if (!approver.role || approver.role.trim().length < 2) violations.push({ reason: `${ap}.role required` });
        if (!approver.name || approver.name.trim().length < 2) violations.push({ reason: `${ap}.name required` });
        if (!DATE_RE.test(approver.date)) violations.push({ reason: `${ap}.date must be YYYY-MM-DD` });
      }
    }

    if (!isIsoDateTime(record.lastValidatedAt)) {
      violations.push({ reason: `${p}.lastValidatedAt must be ISO datetime` });
    }

    if (record.status === 'closed') {
      if (!record.rolloutEvidence) {
        violations.push({ reason: `${p}.rolloutEvidence required when status=closed` });
      } else {
        const refs = [
          record.rolloutEvidence.canaryEvidenceRef,
          record.rolloutEvidence.burnInEvidenceRef,
          record.rolloutEvidence.postBurnInEvidenceRef,
        ];
        for (const [refIdx, ref] of refs.entries()) {
          if (!ref || ref.trim().length < 3) {
            violations.push({
              reason: `${p}.rolloutEvidence ref index ${refIdx} must be non-empty`,
            });
          } else {
            const absolute = resolve(root, ref);
            if (!existsSync(absolute)) {
              violations.push({
                reason: `${p}.rolloutEvidence ref missing file (${ref})`,
              });
            }
          }
        }
      }
    }
  }

  return {
    exitCode: violations.length > 0 ? 1 : 0,
    violations,
  };
}

function main(): number {
  const registryPathArg = process.argv[2] ? resolve(REPO_ROOT, process.argv[2]) : DEFAULT_REGISTRY;
  const schemaPathArg = process.argv[3] ? resolve(REPO_ROOT, process.argv[3]) : DEFAULT_SCHEMA;
  const result = runGuard(REPO_ROOT, registryPathArg, schemaPathArg);
  if (result.exitCode !== 0) {
    console.error('✗ check-bug-closure-record-schema');
    for (const violation of result.violations) {
      console.error(`  - ${violation.reason}`);
    }
    return 1;
  }
  console.log('✓ check-bug-closure-record-schema');
  console.log(`  schema: ${rel(schemaPathArg)}`);
  console.log(`  registry: ${rel(registryPathArg)}`);
  return 0;
}

if (require.main === module) {
  process.exitCode = main();
}
