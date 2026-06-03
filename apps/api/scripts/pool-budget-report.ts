#!/usr/bin/env tsx
import 'dotenv/config';
import { evaluatePoolBudgetFromEnv } from '../src/shared/poolBudget';

function asPositiveInt(raw: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(raw ?? '', 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return parsed;
}

function resolveRuntimeConfig(env: NodeJS.ProcessEnv) {
  const isPgBouncer = Boolean(env.PGBOUNCER_HOST || env.DB_PORT === '6432');
  const appPoolMax = asPositiveInt(env.DB_POOL_MAX, isPgBouncer ? 20 : 50);
  const adminPoolMax = 5;
  const replicaPoolMax = asPositiveInt(env.DB_REPLICA_POOL_MAX, 30);
  const hasReplica = Boolean(env.DB_REPLICA_HOST && env.DB_REPLICA_HOST.trim().length > 0);
  const apiProcessCount = asPositiveInt(env.API_PROCESS_COUNT ?? env.API_INSTANCES, 1);
  return {
    apiProcessCount,
    appPoolMax,
    adminPoolMax,
    replicaPoolMax,
    hasReplica,
  };
}

function main(): number {
  const runtime = resolveRuntimeConfig(process.env);
  const evaluation = evaluatePoolBudgetFromEnv(process.env, runtime);

  console.log('Signacare Pool Budget Report');
  console.log('----------------------------');
  console.log(`Mode: ${evaluation.mode}`);
  console.log(`Runtime: ${JSON.stringify(runtime)}`);

  if (evaluation.skippedReason) {
    console.log(`Status: skipped`);
    console.log(`Reason: ${evaluation.skippedReason}`);
    console.log('Hint: set DB_USABLE_BACKEND_CONNECTIONS and related worksheet variables.');
    return 0;
  }

  if (!evaluation.projection || !evaluation.inputs) {
    console.error('Pool budget evaluation failed: projection not available');
    return 1;
  }

  const { projection, inputs } = evaluation;
  console.log(`Verdict: ${projection.verdict}`);
  console.log(`Headroom ratio: ${projection.headroomRatio.toFixed(3)}`);
  console.log(`Primary pressure: ${projection.primaryPressure}`);
  console.log(`Safe primary cap: ${projection.safePrimaryCap}`);
  console.log(`Replica pressure: ${projection.replicaPressure}`);
  console.log(`Client socket ceiling: ${projection.clientSocketCeiling}`);
  console.log(`Inputs: ${JSON.stringify(inputs)}`);

  if (projection.verdict === 'risky') {
    console.log('Action: reduce pool/process counts or increase DB capacity before rollout.');
  } else if (projection.verdict === 'caution') {
    console.log('Action: proceed with caution; watch burst traffic and pool pending metrics.');
  } else {
    console.log('Action: capacity posture is healthy under declared worksheet inputs.');
  }

  return 0;
}

process.exitCode = main();
