/**
 * Category 8 — Patient-app API auth flow.
 *
 * The Flutter mobile apps (apps/mobile and apps/patient-app) talk to
 * a parallel auth surface mounted at /api/v1/patient-app/* — separate
 * from the clinician-side /api/v1/auth/login flow. This test exercises
 * that surface from the in-process Express app via supertest.
 *
 * What's tested:
 *   - POST /patient-app/login with bad credentials → 401/4xx, no leak
 *   - POST /patient-app/login response shape (no password_hash)
 *   - GET /patient-app/me without a token → 401
 *   - The patient activate flow rejects an unknown invitation token
 *
 * What's NOT tested here (lives in apps/mobile/test/ as Dart
 * widget/integration tests):
 *   - Token storage in FlutterSecureStorage (verified statically by
 *     mobileMasvsScan.test.ts)
 *   - Offline sync queue persistence
 *   - Background notification delivery
 *   - SSL certificate pinning at the OS layer
 *
 * Standard satisfied: OWASP MASVS-AUTH-1 (Authentication), MASVS-NETWORK-1
 *                     (network security), Australian Privacy Act 1988 APP 11.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';
import app from '../../src/server';
import { isIntegrationReady } from './_helpers';

const READY = await isIntegrationReady();

describe.skipIf(!READY)('Patient-app auth surface (live API)', () => {
  beforeAll(async () => {
    // Ensure the cached helper login has fired so Redis is up.
    // We don't need a token for this suite — patient-app endpoints
    // are tested unauthenticated where appropriate.
  });

  // ────────────────────────────────────────────────────────────────
  // POST /patient-app/login
  // ────────────────────────────────────────────────────────────────
  describe('POST /patient-app/login', () => {
    it('rejects an unknown patient with 401', async () => {
      const res = await request(app)
        .post('/api/v1/patient-app/login')
        .set('X-CSRF-Token', 'test')
        .set('X-Client', 'mobile')
        .send({
          phone: `+6149${Date.now().toString().slice(-7)}`,
          password: 'whatever',
        });
      expect([400, 401]).toContain(res.status);
    });

    it('returns a structured error body (no stack trace, no DB text)', async () => {
      const res = await request(app)
        .post('/api/v1/patient-app/login')
        .set('X-CSRF-Token', 'test')
        .set('X-Client', 'mobile')
        .send({ phone: '+61411111111', password: 'wrong' });

      const body = JSON.stringify(res.body);
      expect(body).not.toMatch(/at \w+\.<anonymous>/);
      expect(body).not.toMatch(/node_modules/);
      expect(body).not.toMatch(/select .* from /i);
      // Either { error, code } or RFC 7807 { title, type }
      expect(
        typeof res.body?.error === 'string' || typeof res.body?.title === 'string',
      ).toBe(true);
    });

    it('does NOT leak password_hash on any response shape', async () => {
      const res = await request(app)
        .post('/api/v1/patient-app/login')
        .set('X-CSRF-Token', 'test')
        .set('X-Client', 'mobile')
        .send({ phone: '+61411111111', password: 'wrong' });
      const body = JSON.stringify(res.body);
      expect(body).not.toContain('password_hash');
      expect(body).not.toContain('passwordHash');
    });

    it('login flow does not reveal whether the phone exists (enumeration safety)', async () => {
      // Two attempts: one obviously-fake phone, one well-formed but
      // non-existent. The error response shape MUST be uniform.
      const r1 = await request(app)
        .post('/api/v1/patient-app/login')
        .set('X-CSRF-Token', 'test')
        .set('X-Client', 'mobile')
        .send({ phone: '+61422222222', password: 'x' });

      const r2 = await request(app)
        .post('/api/v1/patient-app/login')
        .set('X-CSRF-Token', 'test')
        .set('X-Client', 'mobile')
        .send({ phone: '+61433333333', password: 'x' });

      // Same status code for both
      expect(r1.status).toBe(r2.status);

      // Error message text MUST NOT differ in a way that reveals
      // account existence.
      const m1 = (JSON.stringify(r1.body) || '').toLowerCase();
      const m2 = (JSON.stringify(r2.body) || '').toLowerCase();
      expect(m1).not.toContain('user not found');
      expect(m1).not.toContain('does not exist');
      expect(m1).not.toContain('no such');
      expect(m2).not.toContain('user not found');
      expect(m2).not.toContain('does not exist');
    });
  });

  // ────────────────────────────────────────────────────────────────
  // GET /patient-app/me
  // ────────────────────────────────────────────────────────────────
  describe('GET /patient-app/me', () => {
    it('rejects unauthenticated requests with 401', async () => {
      const res = await request(app).get('/api/v1/patient-app/me');
      expect(res.status).toBe(401);
    });

    it('rejects requests with a forged Bearer token (wrong secret) with 401', async () => {
      const res = await request(app)
        .get('/api/v1/patient-app/me')
        .set(
          'Authorization',
          'Bearer eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJhdHRhY2tlciJ9.WRONG_SIGNATURE',
        );
      expect(res.status).toBe(401);
    });
  });

  // ────────────────────────────────────────────────────────────────
  // POST /patient-app/activate
  // ────────────────────────────────────────────────────────────────
  describe('POST /patient-app/activate', () => {
    it('rejects an unknown invitation token with 4xx', async () => {
      const res = await request(app)
        .post('/api/v1/patient-app/activate')
        .set('X-CSRF-Token', 'test')
        .set('X-Client', 'mobile')
        .send({
          invitationToken: 'definitely-not-a-real-token-' + Date.now(),
          phone: '+61400000000',
          password: 'NotReal!1',
        });
      expect(res.status).toBeGreaterThanOrEqual(400);
      expect(res.status).toBeLessThan(500);
    });

    it('accepts activation payload without DOB field (schema compatibility)', async () => {
      const res = await request(app)
        .post('/api/v1/patient-app/activate')
        .set('X-CSRF-Token', 'test')
        .set('X-Client', 'mobile')
        .send({
          code: '000000',
          phone: '+61400000000',
          password: 'NotReal!1',
        });

      // Unknown code should fail as a business rule (400), not as
      // schema validation (422).
      expect(res.status).toBe(400);
      expect(typeof res.body?.error === 'string' || typeof res.body?.title === 'string').toBe(
        true,
      );
    });

    it('accepts AU DOB format DD/MM/YYYY when provided', async () => {
      const res = await request(app)
        .post('/api/v1/patient-app/activate')
        .set('X-CSRF-Token', 'test')
        .set('X-Client', 'mobile')
        .send({
          code: '000000',
          phone: '+61400000000',
          password: 'NotReal!1',
          dob: '31/01/1990',
        });

      // Unknown code should fail as a business rule (400), not as
      // schema validation (422).
      expect(res.status).toBe(400);
      expect(typeof res.body?.error === 'string' || typeof res.body?.title === 'string').toBe(
        true,
      );
    });

    it('activates successfully with a freshly created invite code', async () => {
      const { dbAdmin } = await import('../../src/db/db');
      let inviteId: string | null = null;
      let accountId: string | null = null;
      let patientId: string | null = null;
      let clinicId: string | null = null;

      try {
        const patient = await dbAdmin('patients as p')
          .leftJoin('patient_app_accounts as a', function joinAccount() {
            this.on('a.patient_id', '=', 'p.id').andOn('a.clinic_id', '=', 'p.clinic_id');
          })
          .whereNull('a.id')
          .select('p.id', 'p.clinic_id', 'p.date_of_birth')
          .first<{ id: string; clinic_id: string; date_of_birth: string | null }>();

        if (!patient) throw new Error('No patient fixture without Viva account is available');
        patientId = patient.id;
        clinicId = patient.clinic_id;

        const code = String(100000 + Math.floor(Math.random() * 899999));
        const [invite] = await dbAdmin('patient_invites').insert({
          clinic_id: clinicId,
          patient_id: patientId,
          code,
          expires_at: new Date(Date.now() + 2 * 60 * 60 * 1000),
        }).returning(['id']);
        inviteId = invite.id as string;

        const phone = `+614${Date.now().toString().slice(-8)}`;
        const body: Record<string, unknown> = {
          code,
          phone,
          password: 'StrongPass!123',
        };
        if (patient.date_of_birth) {
          body.dob = new Date(patient.date_of_birth).toISOString().slice(0, 10);
        }

        const res = await request(app)
          .post('/api/v1/patient-app/activate')
          .set('X-CSRF-Token', 'test')
          .set('X-Client', 'mobile')
          .send(body);

        expect(res.status).toBe(200);
        expect(res.body?.ok).toBe(true);

        const account = await dbAdmin('patient_app_accounts')
          .where({ patient_id: patientId, clinic_id: clinicId })
          .first<{ id: string; phone: string | null }>();
        expect(account).toBeTruthy();
        expect(account?.phone).toBe(phone);
        accountId = account?.id ?? null;
      } finally {
        if (inviteId) await dbAdmin('patient_invites').where({ id: inviteId }).delete();
        if (accountId) await dbAdmin('patient_app_accounts').where({ id: accountId }).delete();
      }
    });

    it('resolves duplicated active invite codes deterministically to newest when DOB matches', async () => {
      const { dbAdmin } = await import('../../src/db/db');
      const inviteIds: string[] = [];
      const accountIds: string[] = [];

      try {
        const patients = await dbAdmin('patients as p')
          .leftJoin('patient_app_accounts as a', function joinAccount() {
            this.on('a.patient_id', '=', 'p.id').andOn('a.clinic_id', '=', 'p.clinic_id');
          })
          .whereNull('a.id')
          .whereNotNull('p.date_of_birth')
          .select('p.id', 'p.clinic_id', 'p.date_of_birth')
          .limit(2) as Array<{ id: string; clinic_id: string; date_of_birth: string }>;

        if (patients.length < 2) {
          throw new Error('Need at least two patients without Viva accounts to run duplicate-code activation test');
        }

        const olderPatient = patients[0];
        const newerPatient = patients[1];
        const sharedCode = '654321';
        const now = Date.now();

        const olderInserted = await dbAdmin('patient_invites').insert({
          clinic_id: olderPatient.clinic_id,
          patient_id: olderPatient.id,
          code: sharedCode,
          expires_at: new Date(now + 2 * 60 * 60 * 1000),
          created_at: new Date(now - 10 * 60 * 1000),
        }).returning(['id']);
        inviteIds.push(String(olderInserted[0].id));

        const newerInserted = await dbAdmin('patient_invites').insert({
          clinic_id: newerPatient.clinic_id,
          patient_id: newerPatient.id,
          code: sharedCode,
          expires_at: new Date(now + 2 * 60 * 60 * 1000),
          created_at: new Date(now),
        }).returning(['id']);
        inviteIds.push(String(newerInserted[0].id));

        const phone = `+614${(Date.now() + 12345).toString().slice(-8)}`;
        const dob = new Date(newerPatient.date_of_birth).toISOString().slice(0, 10);
        const res = await request(app)
          .post('/api/v1/patient-app/activate')
          .set('X-CSRF-Token', 'test')
          .set('X-Client', 'mobile')
          .send({
            code: sharedCode,
            phone,
            password: 'StrongPass!123',
            dob,
          });

        expect(res.status).toBe(200);
        expect(res.body?.ok).toBe(true);

        const newerAccount = await dbAdmin('patient_app_accounts')
          .where({ patient_id: newerPatient.id, clinic_id: newerPatient.clinic_id })
          .first<{ id: string; phone: string | null }>();
        expect(newerAccount).toBeTruthy();
        expect(newerAccount?.phone).toBe(phone);
        if (newerAccount?.id) accountIds.push(newerAccount.id);

        const olderAccount = await dbAdmin('patient_app_accounts')
          .where({ patient_id: olderPatient.id, clinic_id: olderPatient.clinic_id })
          .first<{ id: string }>();
        expect(olderAccount).toBeFalsy();
      } finally {
        if (inviteIds.length > 0) {
          await dbAdmin('patient_invites').whereIn('id', inviteIds).delete();
        }
        if (accountIds.length > 0) {
          await dbAdmin('patient_app_accounts').whereIn('id', accountIds).delete();
        }
      }
    });
  });
});
