import { beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import {
  AdminReportDetailsResponseSchema,
  AdminReportMetadataResponseSchema,
  AdminReportOverviewResponseSchema,
  AdminReportTrendsResponseSchema,
} from '@signacare/shared';
import app from '../../src/server';
import { dbAdmin } from '../../src/db/db';
import { CANONICAL_PASSWORD, CANONICAL_PERSONAS } from '../fixtures/canonical-personas';
import { isIntegrationReady } from './_helpers';

const ready = await isIntegrationReady();

async function loginAs(email: string): Promise<string> {
  const response = await request(app)
    .post('/api/v1/auth/login')
    .set('X-CSRF-Token', 'test')
    .set('X-Client', 'mobile')
    .send({ email, password: CANONICAL_PASSWORD });
  expect(response.status).toBe(200);
  expect(typeof response.body?.accessToken).toBe('string');
  return response.body.accessToken as string;
}

function authedGet(token: string, path: string) {
  return request(app)
    .get(path)
    .set('Authorization', `Bearer ${token}`)
    .set('X-Client', 'mobile')
    .set('X-CSRF-Token', 'test');
}

describe.skipIf(!ready)('admin report routes', () => {
  let adminToken = '';
  let clinicianToken = '';
  let managerToken = '';
  let receptionistToken = '';

  beforeAll(async () => {
    adminToken = await loginAs(CANONICAL_PERSONAS.admin.email);
    clinicianToken = await loginAs(CANONICAL_PERSONAS.clinician.email);
    managerToken = await loginAs(CANONICAL_PERSONAS.manager.email);
    receptionistToken = await loginAs(CANONICAL_PERSONAS.receptionist.email);
  });

  it('GET /api/v1/reports/admin-report/overview returns schema-validated payload for admin', async () => {
    const response = await authedGet(adminToken, '/api/v1/reports/admin-report/overview?period=month');
    expect(response.status).toBe(200);
    const parsed = AdminReportOverviewResponseSchema.safeParse(response.body);
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.cards.length).toBeGreaterThan(0);
    }
  });

  it('GET /api/v1/reports/admin-report/metadata returns schema-validated payload', async () => {
    const response = await authedGet(adminToken, '/api/v1/reports/admin-report/metadata');
    expect(response.status).toBe(200);
    const parsed = AdminReportMetadataResponseSchema.safeParse(response.body);
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.metrics.length).toBeGreaterThan(0);
    }
  });

  it('GET /api/v1/reports/admin-report/details returns schema-validated payload', async () => {
    const response = await authedGet(
      adminToken,
      '/api/v1/reports/admin-report/details?period=month&metricKey=total_consumers&limit=50',
    );
    expect(response.status).toBe(200);
    const parsed = AdminReportDetailsResponseSchema.safeParse(response.body);
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.metricKey).toBe('total_consumers');
    }
  });

  it('GET /api/v1/reports/admin-report/trends returns schema-validated payload', async () => {
    const response = await authedGet(
      adminToken,
      '/api/v1/reports/admin-report/trends?period=month&metrics=total_consumers,new_consumer&granularity=week',
    );
    expect(response.status).toBe(200);
    const parsed = AdminReportTrendsResponseSchema.safeParse(response.body);
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.series.length).toBeGreaterThan(0);
    }
  });

  it('GET /api/v1/reports/admin-report/export returns CSV download payload', async () => {
    const response = await authedGet(
      adminToken,
      '/api/v1/reports/admin-report/export?period=month&view=overview&format=csv',
    );
    expect(response.status).toBe(200);
    expect(response.headers['content-type']).toContain('text/csv');
    expect(String(response.text).length).toBeGreaterThan(0);
  });

  it('clinician without reports module grant is denied access', async () => {
    const response = await authedGet(
      clinicianToken,
      `/api/v1/reports/admin-report/overview?period=month&clinicianId=${CANONICAL_PERSONAS.clinician2.id}`,
    );
    expect(response.status).toBe(403);
    expect(typeof response.body?.code).toBe('string');
  });

  it('receptionist is denied access to admin report routes', async () => {
    const response = await authedGet(receptionistToken, '/api/v1/reports/admin-report/overview?period=month');
    expect(response.status).toBe(403);
  });

  it('reports-bi explicit deny does not block /reports/admin-report routes', async () => {
    const now = new Date();
    const managerId = CANONICAL_PERSONAS.manager.id;
    const clinicId = CANONICAL_PERSONAS.manager.clinicId;
    const denyRowId = '7f5da50d-f7a0-4f03-b0f7-48247ab21d5f';

    await dbAdmin('staff_module_access')
      .where({ staff_id: managerId, clinic_id: clinicId, module: 'reports-bi' })
      .delete();

    await dbAdmin('staff_module_access').insert({
      id: denyRowId,
      staff_id: managerId,
      clinic_id: clinicId,
      module: 'reports-bi',
      access_level: 'none',
      granted_by_id: CANONICAL_PERSONAS.admin.id,
      can_delegate_this: false,
      created_at: now,
      updated_at: now,
    });

    const complianceResponse = await authedGet(managerToken, '/api/v1/reports/compliance/summary');
    expect(complianceResponse.status).toBe(403);
    expect(String(complianceResponse.body?.error ?? '')).toContain('reports-bi');

    const adminReportResponse = await authedGet(managerToken, '/api/v1/reports/admin-report/overview?period=month');
    expect(adminReportResponse.status).toBe(200);
    const parsed = AdminReportOverviewResponseSchema.safeParse(adminReportResponse.body);
    expect(parsed.success).toBe(true);

    await dbAdmin('staff_module_access').where({ id: denyRowId }).delete();
  });
});
