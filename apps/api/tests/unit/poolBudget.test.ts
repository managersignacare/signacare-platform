import { describe, expect, it } from 'vitest';
import {
  evaluatePoolBudgetFromEnv,
  parsePoolBudgetAssertMode,
  projectPoolBudget,
} from '../../src/shared/poolBudget';

describe('poolBudget', () => {
  it('projects healthy budget when replica is enabled and pressure is low', () => {
    const projection = projectPoolBudget({
      apiProcessCount: 4,
      appPoolMax: 20,
      adminPoolMax: 5,
      replicaPoolMax: 30,
      hasReplica: true,
      dbUsableBackendConnections: 730,
      reservedBackendConnections: 146,
      nonApiDbConsumers: 10,
      safeUtilizationCeiling: 0.7,
    });

    expect(projection.primaryPressure).toBe(110);
    expect(projection.safePrimaryCap).toBe(408);
    expect(projection.verdict).toBe('healthy');
  });

  it('projects risky budget when headroom exceeds threshold', () => {
    const projection = projectPoolBudget({
      apiProcessCount: 8,
      appPoolMax: 50,
      adminPoolMax: 5,
      replicaPoolMax: 30,
      hasReplica: false,
      dbUsableBackendConnections: 400,
      reservedBackendConnections: 80,
      nonApiDbConsumers: 20,
      safeUtilizationCeiling: 0.7,
    });

    expect(projection.headroomRatio).toBeGreaterThan(0.8);
    expect(projection.verdict).toBe('risky');
  });

  it('parses assert mode with safe fallback', () => {
    expect(parsePoolBudgetAssertMode('off')).toBe('off');
    expect(parsePoolBudgetAssertMode('fail')).toBe('fail');
    expect(parsePoolBudgetAssertMode('invalid')).toBe('warn');
  });

  it('skips evaluation when usable backend connections are missing', () => {
    const evaluation = evaluatePoolBudgetFromEnv(
      { DB_POOL_BUDGET_ASSERT_MODE: 'warn' },
      {
        apiProcessCount: 4,
        appPoolMax: 20,
        adminPoolMax: 5,
        replicaPoolMax: 30,
        hasReplica: true,
      },
    );

    expect(evaluation.projection).toBeUndefined();
    expect(evaluation.skippedReason).toContain('DB_USABLE_BACKEND_CONNECTIONS');
  });

  it('uses defaults for optional worksheet inputs', () => {
    const evaluation = evaluatePoolBudgetFromEnv(
      {
        DB_POOL_BUDGET_ASSERT_MODE: 'warn',
        DB_USABLE_BACKEND_CONNECTIONS: '730',
      },
      {
        apiProcessCount: 4,
        appPoolMax: 20,
        adminPoolMax: 5,
        replicaPoolMax: 30,
        hasReplica: true,
      },
    );

    expect(evaluation.projection).toBeDefined();
    expect(evaluation.inputs?.reservedBackendConnections).toBe(146);
    expect(evaluation.inputs?.safeUtilizationCeiling).toBe(0.7);
  });
});
