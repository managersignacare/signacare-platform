import { beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import app from '../../src/server';
import { isIntegrationReady, loginAsAdmin, loginAsManager } from './_helpers';

const READY = await isIntegrationReady();

function withAuth(token: string, req: request.Test): request.Test {
  return req
    .set('Authorization', `Bearer ${token}`)
    .set('X-CSRF-Token', 'test');
}

describe.skipIf(!READY)('staging contract remediation routes', () => {
  let adminToken = '';
  let managerToken = '';
  let patientId: string | null = null;

  beforeAll(async () => {
    ({ token: adminToken } = await loginAsAdmin());
    ({ token: managerToken } = await loginAsManager());
  });

  async function ensurePatient(): Promise<string> {
    if (patientId) return patientId;

    const unique = Date.now();
    const create = await withAuth(
      adminToken,
      request(app)
        .post('/api/v1/patients')
        .send({
          givenName: `QA${unique}`,
          familyName: 'Outcome Contract',
          dateOfBirth: '1988-04-09',
        }),
    );

    expect(create.status).toBe(201);
    patientId = create.body.id as string;
    return patientId;
  }

  it('lets managers list patients without the risk-assessments module gate bleeding across /patients', async () => {
    const res = await withAuth(
      managerToken,
      request(app).get('/api/v1/patients?limit=1'),
    );

    expect(res.status).toBe(200);
    expect(res.body?.code).not.toBe('MODULE_READ_DENIED');
  });

  it('honours pageSize as a patient-list alias for limit', async () => {
    const res = await withAuth(
      adminToken,
      request(app).get('/api/v1/patients?page=1&pageSize=1'),
    );

    expect(res.status).toBe(200);
    expect(res.body?.pagination?.limit).toBe(1);
  });

  it('accepts date-only appointment range filters', async () => {
    const res = await withAuth(
      adminToken,
      request(app).get('/api/v1/appointments?from=2026-06-06&to=2026-06-08'),
    );

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
  });

  it('exposes the full outcome-measure definitions catalogue on the legacy route', async () => {
    const res = await withAuth(
      adminToken,
      request(app).get('/api/v1/outcomes/definitions'),
    );

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('honos');
    expect(res.body).toHaveProperty('honos65');
    expect(res.body).toHaveProperty('honosca');
    expect(res.body).toHaveProperty('k10');
    expect(res.body).toHaveProperty('k10plus');
    expect(res.body).toHaveProperty('lsp16');
  });

  it('returns numeric totalScore on create and preserves snake_case latestByFamily keys on measurement summary', async () => {
    const id = await ensurePatient();

    const createOutcome = await withAuth(
      adminToken,
      request(app)
        .post('/api/v1/outcomes')
        .send({
          patientId: id,
          measureType: 'k10',
          collectionOccasion: 'review',
          items: {
            1: 1,
            2: 1,
            3: 1,
            4: 1,
            5: 1,
            6: 1,
            7: 1,
            8: 1,
            9: 1,
            10: 1,
          },
        }),
    );

    expect(createOutcome.status).toBe(201);
    expect(createOutcome.body.totalScore).toBe(10);
    expect(typeof createOutcome.body.totalScore).toBe('number');

    const summary = await withAuth(
      adminToken,
      request(app).get(`/api/v1/assessments/patient/${id}/measurement-summary?family=outcome_measure`),
    );

    expect(summary.status).toBe(200);
    expect(summary.body.latestByFamily).toBeDefined();
    expect(summary.body.latestByFamily.outcome_measure).toBeDefined();
    expect(summary.body.latestByFamily.clinician_rating_scale).toBeDefined();
    expect(summary.body.latestByFamily.self_rated_scale).toBeDefined();
    expect(summary.body.latestByFamily.outcomeMeasure).toBeUndefined();
  });

  it('does not return 200 [] for unknown outcome patients', async () => {
    const res = await withAuth(
      adminToken,
      request(app).get('/api/v1/outcomes/patient/00000000-0000-0000-0000-000000000001'),
    );

    expect([403, 404]).toContain(res.status);
    expect(Array.isArray(res.body)).toBe(false);
  });
});
