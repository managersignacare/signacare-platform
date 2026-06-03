#!/usr/bin/env tsx
/**
 * check-pool-budget-contract
 *
 * Enforces that pool-budget worksheet inputs are executable and drift-safe:
 * 1) required capacity keys are present in API env templates
 * 2) production template carries numeric values for projection inputs
 * 3) projected primary pressure is not in the "risky" band
 */

import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { evaluatePoolBudgetFromEnv, type PoolBudgetRuntimeEvaluation } from '../../apps/api/src/shared/poolBudget';

const ROOT = resolve(__dirname, '..', '..');
const API_ENV_EXAMPLE = resolve(ROOT, 'apps', 'api', '.env.example');
const API_ENV_PROD_TEMPLATE = resolve(ROOT, 'apps', 'api', '.env.production.template');
const API_ECOSYSTEM_CONFIG = resolve(ROOT, 'apps', 'api', 'ecosystem.config.js');
const WORKSHEET_DOC = resolve(ROOT, 'docs', 'operations', 'gold-standard-pool-budget-worksheet.md');

const REQUIRED_TEMPLATE_KEYS = [
  'API_PROCESS_COUNT',
  'DB_POOL_MAX',
  'DB_POOL_MIN',
  'DB_REPLICA_POOL_MAX',
  'DB_POOL_BUDGET_ASSERT_MODE',
  'DB_USABLE_BACKEND_CONNECTIONS',
  'DB_RESERVED_BACKEND_CONNECTIONS',
  'DB_NON_API_CONSUMERS',
  'DB_SAFE_UTILIZATION_CEILING',
  'SSE_MAX_CONNECTIONS',
  'LLM_MAX_CONCURRENT',
  'WHISPER_MAX_CONCURRENT',
] as const;

const NUMERIC_PROD_KEYS = [
  'API_PROCESS_COUNT',
  'DB_POOL_MAX',
  'DB_POOL_MIN',
  'DB_REPLICA_POOL_MAX',
  'DB_USABLE_BACKEND_CONNECTIONS',
  'DB_RESERVED_BACKEND_CONNECTIONS',
  'DB_NON_API_CONSUMERS',
  'DB_SAFE_UTILIZATION_CEILING',
] as const;

function parseTemplate(content: string): Record<string, string> {
  const out: Record<string, string> = {};
  const lines = content.split('\n');
  for (const line of lines) {
    const match = line.match(/^\s*#?\s*([A-Z][A-Z0-9_]*)\s*=\s*(.*)\s*$/);
    if (!match) continue;
    const key = match[1];
    if (!key) continue;
    out[key] = (match[2] ?? '').trim();
  }
  return out;
}

function parseIntLike(raw: string): number | null {
  if (raw.length === 0) return null;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) ? n : null;
}

function parseFloatLike(raw: string): number | null {
  if (raw.length === 0) return null;
  const n = Number.parseFloat(raw);
  return Number.isFinite(n) ? n : null;
}

function readEcosystemDefaultApiInstances(content: string): number {
  const match = content.match(/instances:\s*process\.env\.API_INSTANCES\s*\|\|\s*(\d+)/);
  const parsed = match?.[1] ? Number.parseInt(match[1], 10) : NaN;
  if (Number.isFinite(parsed) && parsed > 0) return parsed;
  return 1;
}

export interface PoolBudgetGuardResult {
  exitCode: number;
  failures: string[];
  warnings: string[];
  evaluation?: PoolBudgetRuntimeEvaluation;
}

interface GuardPaths {
  envExamplePath: string;
  envProductionTemplatePath: string;
  ecosystemConfigPath: string;
  worksheetPath: string;
}

interface RunGuardOptions {
  paths?: GuardPaths;
}

const DEFAULT_PATHS: GuardPaths = {
  envExamplePath: API_ENV_EXAMPLE,
  envProductionTemplatePath: API_ENV_PROD_TEMPLATE,
  ecosystemConfigPath: API_ECOSYSTEM_CONFIG,
  worksheetPath: WORKSHEET_DOC,
};

export function runGuard(options: RunGuardOptions = {}): PoolBudgetGuardResult {
  const paths = options.paths ?? DEFAULT_PATHS;
  const failures: string[] = [];
  const warnings: string[] = [];

  for (const file of [paths.envExamplePath, paths.envProductionTemplatePath, paths.ecosystemConfigPath, paths.worksheetPath]) {
    if (!existsSync(file)) {
      failures.push(`missing required file: ${file}`);
    }
  }
  if (failures.length > 0) return { exitCode: 1, failures, warnings };

  const envExampleMap = parseTemplate(readFileSync(paths.envExamplePath, 'utf8'));
  const envProdMap = parseTemplate(readFileSync(paths.envProductionTemplatePath, 'utf8'));

  for (const key of REQUIRED_TEMPLATE_KEYS) {
    if (!(key in envExampleMap)) failures.push(`apps/api/.env.example missing key: ${key}`);
    if (!(key in envProdMap)) failures.push(`apps/api/.env.production.template missing key: ${key}`);
  }

  for (const key of NUMERIC_PROD_KEYS) {
    const raw = envProdMap[key] ?? '';
    if (raw.length === 0) {
      failures.push(`apps/api/.env.production.template key ${key} must have a numeric value`);
      continue;
    }
    if (key === 'DB_SAFE_UTILIZATION_CEILING') {
      const parsed = parseFloatLike(raw);
      if (parsed === null || parsed <= 0 || parsed > 1) {
        failures.push(`apps/api/.env.production.template key ${key} must be > 0 and <= 1`);
      }
    } else if (key === 'API_PROCESS_COUNT') {
      const parsed = parseIntLike(raw);
      if (parsed === null || parsed <= 0) {
        failures.push(`apps/api/.env.production.template key ${key} must be a positive integer`);
      }
    } else {
      const parsed = parseIntLike(raw);
      if (parsed === null || parsed < 0) {
        failures.push(`apps/api/.env.production.template key ${key} must be a non-negative integer`);
      }
    }
  }

  const assertMode = (envProdMap.DB_POOL_BUDGET_ASSERT_MODE ?? '').trim().toLowerCase();
  if (!['off', 'warn', 'fail'].includes(assertMode)) {
    failures.push('apps/api/.env.production.template key DB_POOL_BUDGET_ASSERT_MODE must be one of: off, warn, fail');
  }

  const ecosystemSource = readFileSync(paths.ecosystemConfigPath, 'utf8');
  const templateApiProcessCount = parseIntLike(envProdMap.API_PROCESS_COUNT ?? '');
  const apiProcessCount =
    templateApiProcessCount && templateApiProcessCount > 0
      ? templateApiProcessCount
      : readEcosystemDefaultApiInstances(ecosystemSource);

  const appPoolMax = parseIntLike(envProdMap.DB_POOL_MAX ?? '') ?? 0;
  const replicaPoolMax = parseIntLike(envProdMap.DB_REPLICA_POOL_MAX ?? '') ?? 0;
  const adminPoolMax = 5;
  const hasReplica = Boolean((envProdMap.DB_REPLICA_HOST ?? '').trim());

  const evaluation = evaluatePoolBudgetFromEnv(
    {
      DB_POOL_BUDGET_ASSERT_MODE: envProdMap.DB_POOL_BUDGET_ASSERT_MODE,
      DB_USABLE_BACKEND_CONNECTIONS: envProdMap.DB_USABLE_BACKEND_CONNECTIONS,
      DB_RESERVED_BACKEND_CONNECTIONS: envProdMap.DB_RESERVED_BACKEND_CONNECTIONS,
      DB_NON_API_CONSUMERS: envProdMap.DB_NON_API_CONSUMERS,
      DB_SAFE_UTILIZATION_CEILING: envProdMap.DB_SAFE_UTILIZATION_CEILING,
    },
    {
      apiProcessCount,
      appPoolMax,
      adminPoolMax,
      replicaPoolMax,
      hasReplica,
    },
  );

  if (evaluation.skippedReason) {
    failures.push(`pool-budget projection skipped: ${evaluation.skippedReason}`);
  } else if (evaluation.projection) {
    const ratio = Number(evaluation.projection.headroomRatio.toFixed(3));
    if (evaluation.projection.verdict === 'risky') {
      failures.push(
        `pool-budget projection is risky (ratio=${ratio}, primary=${evaluation.projection.primaryPressure}, safeCap=${evaluation.projection.safePrimaryCap})`,
      );
    } else if (evaluation.projection.verdict === 'caution') {
      warnings.push(
        `pool-budget projection is caution (ratio=${ratio}, primary=${evaluation.projection.primaryPressure}, safeCap=${evaluation.projection.safePrimaryCap})`,
      );
    }
  }

  return {
    exitCode: failures.length > 0 ? 1 : 0,
    failures,
    warnings,
    evaluation,
  };
}

function main(): number {
  console.log('→ check-pool-budget-contract');
  const result = runGuard();
  if (result.evaluation?.projection) {
    const { verdict, headroomRatio, primaryPressure, safePrimaryCap } = result.evaluation.projection;
    console.log(
      `  projection: verdict=${verdict} ratio=${headroomRatio.toFixed(3)} ` +
      `primary=${primaryPressure} safeCap=${safePrimaryCap}`,
    );
  }
  for (const warning of result.warnings) console.log(`  ! ${warning}`);
  if (result.failures.length > 0) {
    console.error(`✗ pool-budget contract failed (${result.failures.length} issue(s))`);
    for (const failure of result.failures) console.error(`  - ${failure}`);
    return 1;
  }
  console.log('✓ pool-budget worksheet contract is executable and non-risky.');
  return 0;
}

if (require.main === module) {
  process.exitCode = main();
}
