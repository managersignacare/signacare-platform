import { beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import app from '../../src/server';
import { isIntegrationReady, loginAsAdmin } from './_helpers';

const ready = await isIntegrationReady();

describe.skipIf(!ready)('BUG-E2E reports routes schema-aligned responses', () => {
  let session: Awaited<ReturnType<typeof loginAsAdmin>>;

  beforeAll(async () => {
    session = await loginAsAdmin();
  });

  it('GET /api/v1/reports/contacts-kpi returns 200 with array payload', async () => {
    const res = await request(app)
      .get('/api/v1/reports/contacts-kpi')
      .set('Authorization', `Bearer ${session.token}`)
      .set('X-Client', 'mobile')
      .set('X-CSRF-Token', 'test');

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body?.data)).toBe(true);
  });

  it('GET /api/v1/reports/staff-caseload returns 200 with array payload', async () => {
    const res = await request(app)
      .get('/api/v1/reports/staff-caseload')
      .set('Authorization', `Bearer ${session.token}`)
      .set('X-Client', 'mobile')
      .set('X-CSRF-Token', 'test');

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body?.data)).toBe(true);
  });

  it('GET /api/v1/reports/workload-alerts returns 200 with typed object payload', async () => {
    const res = await request(app)
      .get('/api/v1/reports/workload-alerts')
      .set('Authorization', `Bearer ${session.token}`)
      .set('X-Client', 'mobile')
      .set('X-CSRF-Token', 'test');

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body?.data?.caseloadExceeded)).toBe(true);
    expect(Array.isArray(res.body?.data?.overdueContacts)).toBe(true);
  });

  it('GET /api/v1/reports/compliance/summary returns 200 and numeric governance fields', async () => {
    const res = await request(app)
      .get('/api/v1/reports/compliance/summary')
      .set('Authorization', `Bearer ${session.token}`)
      .set('X-Client', 'mobile')
      .set('X-CSRF-Token', 'test');

    expect(res.status).toBe(200);
    expect(typeof res.body?.governance?.forbiddenAccessLast7Days).toBe('number');
    expect(typeof res.body?.governance?.breakGlassLast30Days).toBe('number');
    expect(typeof res.body?.governance?.llmBypassLast30Days).toBe('number');
    expect(typeof res.body?.governance?.llmBypassLast90Days).toBe('number');
    expect(typeof res.body?.governance?.failedLoginsLast24h).toBe('number');
    expect(typeof res.body?.governance?.lockedAccountsNow).toBe('number');
    expect(typeof res.body?.platformReliability?.shutdownRunsLast24Hours).toBe('number');
    expect(typeof res.body?.platformReliability?.shutdownHookTimeoutsLast24Hours).toBe('number');
    expect(typeof res.body?.platformReliability?.shutdownHookFailuresLast24Hours).toBe('number');
    expect(typeof res.body?.platformReliability?.maxShutdownHookDurationMsLast24Hours).toBe('number');
  });

  it('GET /api/v1/reports/llm-bypass-audit returns 200 with governance payload', async () => {
    const res = await request(app)
      .get('/api/v1/reports/llm-bypass-audit')
      .set('Authorization', `Bearer ${session.token}`)
      .set('X-Client', 'mobile')
      .set('X-CSRF-Token', 'test');

    expect(res.status).toBe(200);
    expect(typeof res.body?.rollingCounts?.last30Days).toBe('number');
    expect(typeof res.body?.rollingCounts?.last90Days).toBe('number');
    expect(Array.isArray(res.body?.breakdown?.byStaff)).toBe(true);
    expect(Array.isArray(res.body?.breakdown?.byEndpoint)).toBe(true);
    expect(Array.isArray(res.body?.events)).toBe(true);
  });

  it('GET /api/v1/reports/compliance/shutdown-observability returns 200 with typed payload', async () => {
    const res = await request(app)
      .get('/api/v1/reports/compliance/shutdown-observability')
      .set('Authorization', `Bearer ${session.token}`)
      .set('X-Client', 'mobile')
      .set('X-CSRF-Token', 'test');

    expect(res.status).toBe(200);
    expect(typeof res.body?.runCount).toBe('number');
    expect(typeof res.body?.runsLast24Hours).toBe('number');
    expect(typeof res.body?.isShuttingDown).toBe('boolean');
    expect(typeof res.body?.aggregatesLast24Hours?.hooksTimedOut).toBe('number');
    expect(Array.isArray(res.body?.perHookLast24Hours)).toBe(true);
  });
});
