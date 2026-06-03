/**
 * BUG-326 regression — governance dashboard surface for
 * LLM_ACCESS_BYPASS_ROLE audit rows.
 *
 * Required behavior:
 *   - /api/v1/reports/llm-bypass-audit exposes bypass events
 *     with filter support (date range, staff_id, endpoint).
 *   - Rolling counts (30d/90d) are visible.
 *   - Per-admin and per-endpoint breakdowns are present.
 */

import { beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'crypto';
import request from 'supertest';
import app from '../../src/server';
import { CANONICAL_PERSONAS } from '../fixtures/canonical-personas';
import { isIntegrationReady, loginAsAdmin } from './_helpers';
import { writeLlmAccessBypassAudit } from '../../src/shared/writeLlmAccessBypassAudit';

const ready = await isIntegrationReady();

describe.skipIf(!ready)('BUG-326 LLM bypass governance dashboard surface', () => {
  let token = '';
  let clinicId = '';
  let patientId = '';

  const endpointSuperadmin = `/bug-326/superadmin/${randomUUID().slice(0, 8)}`;
  const endpointAdmin = `/bug-326/admin/${randomUUID().slice(0, 8)}`;

  beforeAll(async () => {
    const session = await loginAsAdmin();
    token = session.token;
    clinicId = session.clinicId;

    const { dbAdmin } = await import('../../src/db/db');
    const patient = await dbAdmin('patients')
      .where({ clinic_id: clinicId })
      .select('id')
      .first();
    if (!patient?.id) throw new Error('BUG-326: missing seeded patient');
    patientId = patient.id as string;

    const mkReq = (
      staffId: string,
      role: 'superadmin' | 'admin',
    ): Parameters<typeof writeLlmAccessBypassAudit>[0]['req'] =>
      ({
        user: { id: staffId, role, permissions: [] },
        clinicId,
      }) as unknown as Parameters<typeof writeLlmAccessBypassAudit>[0]['req'];

    await writeLlmAccessBypassAudit({
      req: mkReq(CANONICAL_PERSONAS.superadmin.id, 'superadmin'),
      patientId,
      endpoint: endpointSuperadmin,
      feature: 'bug-326-superadmin',
    });

    await writeLlmAccessBypassAudit({
      req: mkReq(CANONICAL_PERSONAS.admin.id, 'admin'),
      patientId,
      endpoint: endpointAdmin,
      feature: 'bug-326-admin-1',
    });

    await writeLlmAccessBypassAudit({
      req: mkReq(CANONICAL_PERSONAS.admin.id, 'admin'),
      patientId,
      endpoint: endpointAdmin,
      feature: 'bug-326-admin-2',
    });
  });

  it('returns endpoint-filtered governance rows + breakdown', async () => {
    const res = await request(app)
      .get('/api/v1/reports/llm-bypass-audit')
      .query({ endpoint: endpointAdmin })
      .set('Authorization', `Bearer ${token}`)
      .set('X-Client', 'mobile')
      .set('X-CSRF-Token', 'test');

    expect(res.status).toBe(200);
    expect(res.body?.totalMatched).toBe(2);
    expect(Array.isArray(res.body?.events)).toBe(true);
    expect(res.body.events.length).toBe(2);
    expect(res.body.events.every((e: { endpoint: string }) => e.endpoint === endpointAdmin)).toBe(true);
    expect(res.body?.rollingCounts?.last30Days).toBeGreaterThanOrEqual(2);
    expect(res.body?.rollingCounts?.last90Days).toBeGreaterThanOrEqual(
      res.body?.rollingCounts?.last30Days,
    );
    expect(Array.isArray(res.body?.breakdown?.byEndpoint)).toBe(true);
    expect(res.body.breakdown.byEndpoint[0]?.endpoint).toBe(endpointAdmin);
    expect(res.body.breakdown.byEndpoint[0]?.count).toBe(2);
  });

  it('applies staff filter for per-admin governance review', async () => {
    const res = await request(app)
      .get('/api/v1/reports/llm-bypass-audit')
      .query({
        endpoint: endpointAdmin,
        staffId: CANONICAL_PERSONAS.admin.id,
      })
      .set('Authorization', `Bearer ${token}`)
      .set('X-Client', 'mobile')
      .set('X-CSRF-Token', 'test');

    expect(res.status).toBe(200);
    expect(res.body?.totalMatched).toBe(2);
    expect(Array.isArray(res.body?.breakdown?.byStaff)).toBe(true);
    expect(res.body.breakdown.byStaff.length).toBeGreaterThanOrEqual(1);
    expect(res.body.breakdown.byStaff[0]?.staffId).toBe(CANONICAL_PERSONAS.admin.id);
    expect(res.body.breakdown.byStaff[0]?.count).toBe(2);
  });

  it('rejects invalid staffId filter with VALIDATION_ERROR', async () => {
    const res = await request(app)
      .get('/api/v1/reports/llm-bypass-audit')
      .query({ staffId: 'not-a-uuid' })
      .set('Authorization', `Bearer ${token}`)
      .set('X-Client', 'mobile')
      .set('X-CSRF-Token', 'test');

    expect(res.status).toBe(400);
    expect(res.body?.code).toBe('VALIDATION_ERROR');
  });
});
