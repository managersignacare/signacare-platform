/**
 * Break-glass emergency access audit trail (two-person workflow).
 *
 * Current contract:
 *   1. POST /api/v1/auth/break-glass/request     (credential + reason)
 *   2. POST /api/v1/auth/break-glass/:id/approve (admin/superadmin)
 *
 * This test asserts:
 *   - token issuance only after explicit approval,
 *   - breakGlass JWT claim + bounded TTL,
 *   - immutable audit footprints for both request + approval.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'crypto';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import app from '../../src/server';
import { isIntegrationReady, loginAsAdmin } from './_helpers';
import { CANONICAL_PASSWORD, CANONICAL_PERSONAS } from '../fixtures/canonical-personas';

const READY = await isIntegrationReady();
const RUN_TAG = `BGT_${process.pid}_${Date.now().toString(36)}`;
const REQUESTER = CANONICAL_PERSONAS.clinician;

describe.skipIf(!READY)('Break-Glass emergency access', () => {
  let adminSession: { token: string; clinicId: string; userId: string };
  /* eslint-disable @typescript-eslint/no-explicit-any */
  let dbAdmin: any;
  /* eslint-enable @typescript-eslint/no-explicit-any */

  beforeAll(async () => {
    adminSession = await loginAsAdmin();
    ({ dbAdmin } = await import('../../src/db/db'));
  });

  afterAll(async () => {
    if (!READY || !dbAdmin) return;
    await dbAdmin('break_glass_sessions')
      .where({
        clinic_id: adminSession.clinicId,
        staff_id: REQUESTER.id,
        status: 'pending',
      })
      .update({
        status: 'denied',
        denied_reason: `${RUN_TAG} cleanup`,
        approver_id: adminSession.userId,
      })
      .catch(() => undefined);
  });

  async function requestBreakGlass(reason: string): Promise<string> {
    // Defuse stale pending requests from interrupted runs.
    await dbAdmin('break_glass_sessions')
      .where({
        clinic_id: adminSession.clinicId,
        staff_id: REQUESTER.id,
        status: 'pending',
      })
      .update({
        status: 'denied',
        denied_reason: `${RUN_TAG} pre-cleanup`,
        approver_id: adminSession.userId,
      });

    const requestRes = await request(app)
      .post('/api/v1/auth/break-glass/request')
      .set('X-CSRF-Token', 'test')
      .set('X-Client', 'mobile')
      .set('User-Agent', 'breakglass-request-test/1.0')
      .send({
        email: REQUESTER.email,
        password: CANONICAL_PASSWORD,
        reason,
      });
    expect(requestRes.status).toBe(201);
    expect(typeof requestRes.body?.sessionId).toBe('string');
    return requestRes.body.sessionId as string;
  }

  async function approveBreakGlass(sessionId: string) {
    return request(app)
      .post(`/api/v1/auth/break-glass/${sessionId}/approve`)
      .set('Authorization', `Bearer ${adminSession.token}`)
      .set('X-CSRF-Token', 'test')
      .set('X-Client', 'mobile')
      .set('User-Agent', 'breakglass-approve-test/1.0')
      .send({});
  }

  async function invokeBreakGlassPatientRead(token: string, patientId: string) {
    return request(app)
      .get(`/api/v1/patients/${patientId}`)
      .set('Authorization', `Bearer ${token}`)
      .set('X-CSRF-Token', 'test')
      .set('X-Client', 'mobile')
      .set('User-Agent', 'breakglass-sensitive-read-test/1.0');
  }

  describe('break-glass request + approval lifecycle', () => {
    it('issues a time-limited token only after approval', async () => {
      const sessionId = await requestBreakGlass(
        `${RUN_TAG} — code black, patient unresponsive in outpatient clinic`,
      );
      const approveRes = await approveBreakGlass(sessionId);
      expect(approveRes.status).toBe(200);

      const tokenValue = approveRes.body?.token ?? approveRes.body?.accessToken;
      expect(typeof tokenValue).toBe('string');
      expect(tokenValue.split('.').length).toBe(3);
    });

    it('approved break-glass JWT has breakGlass=true and ~30 minute TTL', async () => {
      const sessionId = await requestBreakGlass(`${RUN_TAG} — emergency access TTL check`);
      const approveRes = await approveBreakGlass(sessionId);
      expect(approveRes.status).toBe(200);

      const token = (approveRes.body.accessToken ?? approveRes.body.token) as string;
      const decoded = jwt.decode(token) as {
        iat: number;
        exp: number;
        breakGlass?: boolean;
        breakGlassSessionId?: string;
      };

      expect(decoded).toBeTruthy();
      expect(decoded.breakGlass).toBe(true);
      expect(decoded.breakGlassSessionId).toBe(sessionId);
      expect(decoded.exp - decoded.iat).toBeGreaterThanOrEqual(1740);
      expect(decoded.exp - decoded.iat).toBeLessThanOrEqual(1860);
    });

    it('writes both BREAK_GLASS_REQUESTED and BREAK_GLASS_APPROVED audit rows', async () => {
      const reason = `${RUN_TAG} — audit assertion run ${Date.now()}`;
      const sessionId = await requestBreakGlass(reason);
      const approveRes = await approveBreakGlass(sessionId);
      expect(approveRes.status).toBe(200);

      const requested = await dbAdmin('audit_log')
        .where({
          clinic_id: adminSession.clinicId,
          record_id: sessionId,
          operation: 'BREAK_GLASS_REQUESTED',
        })
        .orderBy('created_at', 'desc')
        .first('staff_id', 'new_data');

      expect(requested).toBeTruthy();
      const requestData =
        typeof requested.new_data === 'string'
          ? JSON.parse(requested.new_data)
          : requested.new_data;
      expect(requested.staff_id).toBe(REQUESTER.id);
      expect(requestData.reason).toBe(reason);
      expect(typeof requestData.ip).toBe('string');
      expect(typeof requestData.userAgent).toBe('string');

      const approved = await dbAdmin('audit_log')
        .where({
          clinic_id: adminSession.clinicId,
          record_id: sessionId,
          operation: 'BREAK_GLASS_APPROVED',
        })
        .orderBy('created_at', 'desc')
        .first('staff_id', 'new_data');

      expect(approved).toBeTruthy();
      const approvedData =
        typeof approved.new_data === 'string'
          ? JSON.parse(approved.new_data)
          : approved.new_data;
      expect(approved.staff_id).toBe(adminSession.userId);
      expect(approvedData.requesterId).toBe(REQUESTER.id);
      expect(typeof approvedData.expiresAt).toBe('string');
    });

    it('tags break-glass patient-route actions with a sensitive-access flag', async () => {
      const sessionId = await requestBreakGlass(`${RUN_TAG} — sensitive flag assertion`);
      const approveRes = await approveBreakGlass(sessionId);
      expect(approveRes.status).toBe(200);
      const token = (approveRes.body.accessToken ?? approveRes.body.token) as string;

      // Route outcome can be 200/403/404 depending on seeded relationships,
      // but break-glass middleware runs before route handlers.
      const patientRes = await invokeBreakGlassPatientRead(token, randomUUID());
      expect([200, 403, 404]).toContain(patientRes.status);

      const row = await dbAdmin('break_glass_sessions')
        .where({ id: sessionId })
        .first('actions_performed');
      const actionsRaw = row?.actions_performed;
      const actions = Array.isArray(actionsRaw)
        ? actionsRaw
        : typeof actionsRaw === 'string'
          ? JSON.parse(actionsRaw)
          : [];
      const latest = actions[actions.length - 1] as
        | { path?: string; sensitiveAccess?: boolean; sensitiveFlag?: string | null }
        | undefined;

      expect(latest).toBeTruthy();
      expect(String(latest?.path ?? '')).toContain('/api/v1/patients/');
      expect(latest?.sensitiveAccess).toBe(true);
      expect(latest?.sensitiveFlag).toBe('mental_health_sensitive_record');
    });

    it('revokes break-glass token when requester account becomes inactive', async () => {
      const sessionId = await requestBreakGlass(`${RUN_TAG} — inactive account revoke assertion`);
      const approveRes = await approveBreakGlass(sessionId);
      expect(approveRes.status).toBe(200);
      const token = (approveRes.body.accessToken ?? approveRes.body.token) as string;

      await dbAdmin('staff')
        .where({ id: REQUESTER.id, clinic_id: adminSession.clinicId })
        .update({ is_active: false, updated_at: new Date() });

      try {
        const res = await invokeBreakGlassPatientRead(token, randomUUID());
        expect(res.status).toBe(401);
        expect(res.body?.code).toBe('BREAK_GLASS_INACTIVE_ACCOUNT');

        const session = await dbAdmin('break_glass_sessions')
          .where({ id: sessionId })
          .first('status', 'revoked_at');
        expect(session?.status).toBe('revoked');
        expect(session?.revoked_at).toBeTruthy();
      } finally {
        await dbAdmin('staff')
          .where({ id: REQUESTER.id, clinic_id: adminSession.clinicId })
          .update({ is_active: true, updated_at: new Date() });
      }
    });
  });

  describe('validation guards on request endpoint', () => {
    it('rejects when reason is missing', async () => {
      const res = await request(app)
        .post('/api/v1/auth/break-glass/request')
        .set('X-CSRF-Token', 'test')
        .set('X-Client', 'mobile')
        .send({ email: REQUESTER.email, password: CANONICAL_PASSWORD });
      expect([422, 400]).toContain(res.status);
    });

    it('rejects when reason is shorter than 10 chars', async () => {
      const res = await request(app)
        .post('/api/v1/auth/break-glass/request')
        .set('X-CSRF-Token', 'test')
        .set('X-Client', 'mobile')
        .send({
          email: REQUESTER.email,
          password: CANONICAL_PASSWORD,
          reason: 'short',
        });
      expect([422, 400]).toContain(res.status);
    });

    it('rejects whitespace-only reason text', async () => {
      const res = await request(app)
        .post('/api/v1/auth/break-glass/request')
        .set('X-CSRF-Token', 'test')
        .set('X-Client', 'mobile')
        .send({
          email: REQUESTER.email,
          password: CANONICAL_PASSWORD,
          reason: '          ',
        });
      expect([422, 400]).toContain(res.status);
    });

    it('uses one consistent auth-reject status for wrong password and unknown email (no account enumeration)', async () => {
      const res1 = await request(app)
        .post('/api/v1/auth/break-glass/request')
        .set('X-CSRF-Token', 'test')
        .send({
          email: REQUESTER.email,
          password: 'wrong-password',
          reason: 'emergency access attempt with wrong password',
        });
      const res2 = await request(app)
        .post('/api/v1/auth/break-glass/request')
        .set('X-CSRF-Token', 'test')
        .send({
          email: 'nobody@nowhere.test',
          password: 'wrong',
          reason: 'emergency access attempt with unknown email',
        });
      // Same status code for both → no account enumeration
      expect(res1.status).toBe(res2.status);
      expect([401, 403]).toContain(res1.status);
    });

    it('does not allow inactive staff to request break-glass access', async () => {
      await dbAdmin('staff')
        .where({ id: REQUESTER.id, clinic_id: adminSession.clinicId })
        .update({ is_active: false, updated_at: new Date() });

      try {
        const res = await request(app)
          .post('/api/v1/auth/break-glass/request')
          .set('X-CSRF-Token', 'test')
          .set('X-Client', 'mobile')
          .send({
            email: REQUESTER.email,
            password: CANONICAL_PASSWORD,
            reason: 'inactive requester must not be allowed break-glass',
          });
        expect(res.status).toBe(401);
        expect(res.body?.code).toBe('INVALID_CREDENTIALS');
      } finally {
        await dbAdmin('staff')
          .where({ id: REQUESTER.id, clinic_id: adminSession.clinicId })
          .update({ is_active: true, updated_at: new Date() });
      }
    });
  });
});
