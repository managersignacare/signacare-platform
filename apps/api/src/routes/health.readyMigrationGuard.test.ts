import express from 'express';
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const dbRawMock = vi.fn();
const dbAdminFirstMock = vi.fn();
const dbAdminMaxMock = vi.fn(() => ({ first: dbAdminFirstMock }));
const dbAdminMock = vi.fn(() => ({ max: dbAdminMaxMock }));
const redisPingMock = vi.fn();
const readReleaseMetadataMock = vi.fn();
const loggerWarnMock = vi.fn();

vi.mock('../db/db', () => ({
  db: {
    raw: dbRawMock,
  },
  dbAdmin: dbAdminMock,
}));

vi.mock('../config/redis', () => ({
  redis: {
    ping: redisPingMock,
  },
}));

vi.mock('../shared/releaseMetadata', () => ({
  readReleaseMetadata: readReleaseMetadataMock,
  ReleaseMetadataSchema: {
    parse: (value: unknown) => value,
  },
}));

vi.mock('../shared/gracefulShutdown', () => ({
  isReady: () => true,
}));

vi.mock('../utils/logger', () => ({
  logger: {
    info: vi.fn(),
    warn: loggerWarnMock,
    error: vi.fn(),
  },
}));

describe('GET /ready migration guard', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    dbRawMock.mockResolvedValue([{ '?column?': 1 }]);
    redisPingMock.mockResolvedValue('PONG');
    dbAdminFirstMock.mockResolvedValue({
      migration_head: '20260701000106_bug_286_llm_interactions_fk_restrict.ts',
    });
    readReleaseMetadataMock.mockReturnValue({
      status: 'versioned',
      source: { commitSha: 'test-sha' },
      contracts: {
        releaseManifestSha256: 'sha256:test',
        openapiSha256: 'sha256:test-openapi',
        configContractSha256: 'sha256:test-config',
        migrationHead: '20260701000106_bug_286_llm_interactions_fk_restrict.ts',
      },
    });
  });

  it('reports schema_migrations: ok when the database matches the deployed release', async () => {
    const { default: healthRoutes } = await import('./health');
    const app = express();
    app.use(healthRoutes);

    const res = await request(app).get('/ready');

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      status: 'ready',
      checks: {
        postgres: 'ok',
        redis: 'ok',
        schema_migrations: 'ok',
      },
    });
    expect(dbAdminMock).toHaveBeenCalledWith('knex_migrations');
  });

  it('fails readiness when the database migration head lags the deployed release', async () => {
    dbAdminFirstMock.mockResolvedValueOnce({
      migration_head: '20260701000098_bug_arch_s0_4_force_rls_behavioral_pathways.ts',
    });

    const { default: healthRoutes } = await import('./health');
    const app = express();
    app.use(healthRoutes);

    const res = await request(app).get('/ready');

    expect(res.status).toBe(503);
    expect(res.body).toMatchObject({
      status: 'not_ready',
      checks: {
        postgres: 'ok',
        redis: 'ok',
        schema_migrations: 'error',
      },
    });
    expect(loggerWarnMock).toHaveBeenCalledWith(
      expect.objectContaining({
        expectedMigrationHead: '20260701000106_bug_286_llm_interactions_fk_restrict.ts',
        actualMigrationHead: '20260701000098_bug_arch_s0_4_force_rls_behavioral_pathways.ts',
        check: 'schema_migrations',
      }),
      'Readiness check: database migration head does not match deployed release',
    );
  });
});
