export type PoolBudgetVerdict = 'healthy' | 'caution' | 'risky';

export interface PoolBudgetInputs {
  apiProcessCount: number;
  appPoolMax: number;
  adminPoolMax: number;
  replicaPoolMax: number;
  hasReplica: boolean;
  dbUsableBackendConnections: number;
  reservedBackendConnections: number;
  nonApiDbConsumers: number;
  safeUtilizationCeiling: number;
}

export interface PoolBudgetProjection {
  clientSocketCeiling: number;
  primaryPressure: number;
  replicaPressure: number;
  safePrimaryCap: number;
  headroomRatio: number;
  verdict: PoolBudgetVerdict;
}

export interface RuntimePoolBudgetConfig {
  apiProcessCount: number;
  appPoolMax: number;
  adminPoolMax: number;
  replicaPoolMax: number;
  hasReplica: boolean;
}

export type PoolBudgetAssertMode = 'off' | 'warn' | 'fail';

export interface PoolBudgetRuntimeEvaluation {
  mode: PoolBudgetAssertMode;
  skippedReason?: string;
  projection?: PoolBudgetProjection;
  inputs?: PoolBudgetInputs;
}

const DEFAULT_RESERVED_CONNECTION_RATIO = 0.20;
const DEFAULT_SAFE_UTILIZATION_CEILING = 0.70;

function asPositiveInt(value: string | undefined): number | null {
  if (!value || value.trim().length === 0) return null;
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return null;
  return parsed;
}

function asNonNegativeInt(value: string | undefined): number | null {
  if (!value || value.trim().length === 0) return null;
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed < 0) return null;
  return parsed;
}

function asFraction(value: string | undefined): number | null {
  if (!value || value.trim().length === 0) return null;
  const parsed = Number.parseFloat(value);
  if (!Number.isFinite(parsed) || parsed <= 0 || parsed > 1) return null;
  return parsed;
}

export function projectPoolBudget(inputs: PoolBudgetInputs): PoolBudgetProjection {
  const clientSocketCeiling = inputs.apiProcessCount * (inputs.appPoolMax + inputs.adminPoolMax + inputs.replicaPoolMax);
  const primaryPressure = inputs.hasReplica
    ? (inputs.apiProcessCount * (inputs.appPoolMax + inputs.adminPoolMax)) + inputs.nonApiDbConsumers
    : (inputs.apiProcessCount * (inputs.appPoolMax + inputs.adminPoolMax + inputs.replicaPoolMax)) + inputs.nonApiDbConsumers;
  const replicaPressure = inputs.hasReplica
    ? inputs.apiProcessCount * inputs.replicaPoolMax
    : 0;
  const safePrimaryCap = Math.floor(
    (inputs.dbUsableBackendConnections - inputs.reservedBackendConnections) * inputs.safeUtilizationCeiling,
  );
  const headroomRatio = safePrimaryCap > 0 ? primaryPressure / safePrimaryCap : Number.POSITIVE_INFINITY;
  const verdict: PoolBudgetVerdict = headroomRatio <= 0.60
    ? 'healthy'
    : headroomRatio <= 0.80
      ? 'caution'
      : 'risky';

  return {
    clientSocketCeiling,
    primaryPressure,
    replicaPressure,
    safePrimaryCap,
    headroomRatio,
    verdict,
  };
}

export function parsePoolBudgetAssertMode(raw: string | undefined): PoolBudgetAssertMode {
  const normalized = (raw ?? 'warn').trim().toLowerCase();
  if (normalized === 'off' || normalized === 'warn' || normalized === 'fail') {
    return normalized;
  }
  return 'warn';
}

/**
 * Computes runtime budget projection from env + live pool topology.
 * If required inputs are not present, returns skippedReason (fail-loud at log level,
 * but no forced process exit unless caller chooses to enforce it).
 */
export function evaluatePoolBudgetFromEnv(
  env: NodeJS.ProcessEnv,
  runtime: RuntimePoolBudgetConfig,
): PoolBudgetRuntimeEvaluation {
  const mode = parsePoolBudgetAssertMode(env.DB_POOL_BUDGET_ASSERT_MODE);
  if (mode === 'off') {
    return { mode, skippedReason: 'DB_POOL_BUDGET_ASSERT_MODE=off' };
  }

  const usable = asPositiveInt(env.DB_USABLE_BACKEND_CONNECTIONS);
  if (usable === null) {
    return {
      mode,
      skippedReason:
        'DB_USABLE_BACKEND_CONNECTIONS is missing or invalid; cannot evaluate pool budget projection',
    };
  }

  const explicitReserved = asNonNegativeInt(env.DB_RESERVED_BACKEND_CONNECTIONS);
  const reserved = explicitReserved ?? Math.floor(usable * DEFAULT_RESERVED_CONNECTION_RATIO);
  if (reserved >= usable) {
    return {
      mode,
      skippedReason:
        `DB_RESERVED_BACKEND_CONNECTIONS (${reserved}) must be lower than DB_USABLE_BACKEND_CONNECTIONS (${usable})`,
    };
  }

  const nonApi = asNonNegativeInt(env.DB_NON_API_CONSUMERS) ?? 0;
  const ceiling = asFraction(env.DB_SAFE_UTILIZATION_CEILING) ?? DEFAULT_SAFE_UTILIZATION_CEILING;

  const inputs: PoolBudgetInputs = {
    apiProcessCount: runtime.apiProcessCount,
    appPoolMax: runtime.appPoolMax,
    adminPoolMax: runtime.adminPoolMax,
    replicaPoolMax: runtime.replicaPoolMax,
    hasReplica: runtime.hasReplica,
    dbUsableBackendConnections: usable,
    reservedBackendConnections: reserved,
    nonApiDbConsumers: nonApi,
    safeUtilizationCeiling: ceiling,
  };

  return {
    mode,
    inputs,
    projection: projectPoolBudget(inputs),
  };
}
