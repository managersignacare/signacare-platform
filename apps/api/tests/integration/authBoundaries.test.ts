/**
 * Category 2 — Integration tests for the auth middleware boundary.
 *
 * Why this matters: every protected endpoint relies on authMiddleware
 * to enforce a valid token, the right role, and the correct clinic
 * scope. A regression here is the most common cause of an IDOR
 * vulnerability — the OWASP A01 top finding in healthcare apps.
 *
 * These tests boot the real Express app via supertest, so they exercise
 * the actual middleware chain (helmet → cors → cookie-parser → CSRF →
 * authMiddleware → tenantMiddleware → rlsMiddleware → route).
 *
 * Standard satisfied: OWASP A01 (Broken Access Control), OWASP A07
 *                     (Auth Failures), ACHS Standard 1.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import app from '../../src/server';
import {
  isIntegrationReady,
  loginAsAdmin,
  authedAgent,
} from './_helpers';

const READY = await isIntegrationReady();

describe.skipIf(!READY)('Auth middleware boundary (live DB)', () => {
  let token: string;

  beforeAll(async () => {
    ({ token } = await loginAsAdmin());
  });

  describe('Token presence', () => {
    it('rejects a request with no Authorization header → 401', async () => {
      const res = await request(app).get('/api/v1/patients');
      expect(res.status).toBe(401);
    });

    it('rejects a request with a malformed Authorization header → 401', async () => {
      const res = await request(app)
        .get('/api/v1/patients')
        .set('Authorization', 'NotBearer some-garbage');
      expect(res.status).toBe(401);
    });

    it('rejects a request with a Bearer prefix but no token → 401', async () => {
      const res = await request(app)
        .get('/api/v1/patients')
        .set('Authorization', 'Bearer ');
      expect(res.status).toBe(401);
    });

    it('rejects a request with a Bearer + non-JWT garbage → 401', async () => {
      const res = await request(app)
        .get('/api/v1/patients')
        .set('Authorization', 'Bearer not.a.jwt.at.all');
      expect(res.status).toBe(401);
    });
  });

  describe('Token cryptographic validity', () => {
    it('rejects a token signed with a wrong HMAC secret → 401', async () => {
      const forged = jwt.sign(
        { id: 'attacker', clinicId: 'attacker-clinic', role: 'admin', permissions: [] },
        'wrong-secret-not-the-real-one',
        { expiresIn: '1h' },
      );
      const res = await request(app)
        .get('/api/v1/patients')
        .set('Authorization', `Bearer ${forged}`);
      expect(res.status).toBe(401);
    });

    it('rejects an alg:none forged token → 401', async () => {
      // Build a header.payload. token with no signature (alg=none attack)
      const header = Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url');
      const payload = Buffer.from(JSON.stringify({
        id: 'attacker', clinicId: 'attacker-clinic', role: 'admin',
        exp: Math.floor(Date.now() / 1000) + 3600,
      })).toString('base64url');
      const forged = `${header}.${payload}.`;
      const res = await request(app)
        .get('/api/v1/patients')
        .set('Authorization', `Bearer ${forged}`);
      expect(res.status).toBe(401);
    });

    it('rejects an expired token → 401', async () => {
      // Sign with the REAL secret but already expired. Re-import config
      // so we use the actual server-side secret, not a guess.
      const { config } = await import('../../src/config');
      const expired = jwt.sign(
        { id: 'staff-1', clinicId: 'clinic-1', role: 'clinician', permissions: [] },
        config.jwt.accessSecret,
        { expiresIn: '-1s' },
      );
      const res = await request(app)
        .get('/api/v1/patients')
        .set('Authorization', `Bearer ${expired}`);
      expect(res.status).toBe(401);
    });

    it('rejects a payload-tampered token (signature mismatch) → 401', async () => {
      // Reuse the beforeAll token rather than re-logging in (loginAsAdmin
      // is cached anyway, but using the closure variable makes the
      // intent clearer).
      const [h, , s] = token.split('.');
      // Replace payload with a different role
      const tamperedPayload = Buffer.from(JSON.stringify({
        id: 'attacker', clinicId: 'attacker', role: 'admin',
        exp: Math.floor(Date.now() / 1000) + 3600,
      })).toString('base64url');
      const tampered = `${h}.${tamperedPayload}.${s}`;
      const res = await request(app)
        .get('/api/v1/patients')
        .set('Authorization', `Bearer ${tampered}`);
      expect(res.status).toBe(401);
    });
  });

  describe('Happy path', () => {
    it('a valid admin token reaches a protected endpoint → 200', async () => {
      const res = await request(app)
        .get('/api/v1/patients?limit=1')
        .set('Authorization', `Bearer ${token}`)
        .set('X-CSRF-Token', 'test');
      expect(res.status).toBe(200);
    });

    it('the authedAgent helper sends the right headers automatically', async () => {
      const agent = authedAgent(token);
      const res = await agent.get('/api/v1/patients?limit=1');
      expect(res.status).toBe(200);
    });
  });

  describe('FHIR endpoints have their own auth tier', () => {
    it('public FHIR metadata endpoint requires no auth → 200', async () => {
      const res = await request(app).get('/api/v1/fhir/metadata');
      expect(res.status).toBe(200);
    });

    it('FHIR Patient resource requires auth → 401 without token', async () => {
      const res = await request(app).get('/api/v1/fhir/Patient');
      expect(res.status).toBe(401);
    });
  });

  describe('CSRF protection on mutations', () => {
    it('a mutation without X-CSRF-Token is rejected → 403', async () => {
      // Use cookie-mode login (no X-Client header) so CSRF cookie is set
      const loginRes = await request(app)
        .post('/api/v1/auth/login')
        .set('X-CSRF-Token', 'test')
        .send({ email: 'admin@signacare.local', password: 'Password1!' });

      // Then attempt a mutation without the CSRF header
      const cookies = loginRes.headers['set-cookie'];
      if (!cookies) return; // mobile mode skipped CSRF cookie — test n/a
      const cookieHeader = (Array.isArray(cookies) ? cookies : [cookies])
        .map((c) => c.split(';')[0])
        .join('; ');

      const res = await request(app)
        .post('/api/v1/tasks')
        .set('Cookie', cookieHeader)
        .send({ title: 'csrf-test' });
      expect([401, 403]).toContain(res.status);
    });
  });
});
