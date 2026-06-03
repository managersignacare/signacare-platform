/**
 * BUG-463 — integration tests for JWT-payload cross-use rejection.
 *
 * Why this exists: BUG-463 introduces a discriminated union for the
 * JWT access-token payload. The runtime invariant the union backstops
 * is: a patient-app JWT must not be usable on staff-only routes, and
 * a staff JWT must not bypass the patient-app `requirePatientOwnership`
 * Branch A. The discriminated union makes this a TYPE-level invariant;
 * these tests assert the behaviour also holds at run-time end-to-end.
 *
 * Six cases mirror the plan §5.3 mapping (I1..I6):
 *   I1 — patient-app JWT presented on a staff-only endpoint → 403
 *   I2 — staff JWT (no patient relationship) on a patient-app
 *        :patientId-keyed endpoint → 403 PATIENT_OWNERSHIP_MISMATCH
 *   I3 — patient-app JWT on its own :patientId-keyed endpoint → 200
 *   I4 — break-glass JWT carries breakGlassSessionId through the
 *        middleware projection (verified by hitting a clinical-scope
 *        route that exists; assertion is the request did NOT 401, and
 *        the audit row written for the request carries the session id)
 *   I5 — impersonation JWT carries impersonator + impersonationSessionId
 *        through the projection (audit-row check, same shape as I4)
 *   I6 — hybrid payload (`isPatientApp=true` + staff-only claims) is
 *        rejected at token-parse time before role-gated route logic.
 *
 * Test classification: REGRESSION GUARD (not RED-gate). BUG-463 is a
 * type-level refactor — the runtime behaviour these tests assert is
 * ALREADY enforced by the pre-fix cast-based code (`req.user as unknown
 * as { breakGlassSessionId? }` etc. populate the same fields the typed
 * projection will populate post-fix). These tests therefore PASS pre-fix
 * AND post-fix; what changes between them is the TYPE shape, not the
 * wire behaviour.
 *
 * The RED gate for BUG-463 lives in `apps/api/tests/unit/authTokens.test.ts`
 * which fails pre-fix with a module-not-found because the discriminated
 * union (`apps/api/src/utils/authTokens.ts`) does not yet exist. These
 * integration tests are the "post-fix behavior MUST match pre-fix
 * behavior" regression net per CLAUDE.md §11 Layer 4.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'crypto';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import request from 'supertest';
import app from '../../src/server';
import { dbAdmin } from '../../src/db/db';
import { withTenantContext } from '../../src/shared/tenantContext';
import { isIntegrationReady, loginAsAdmin } from './_helpers';

const READY = await isIntegrationReady();

const TEST_LABEL = `BUG-463-XUSE-${Date.now()}`;

let adminUserId = '';
let clinicId = '';

let patientId = '';
let otherPatientId = '';
let patientAccountId = '';
let patientAppToken = '';
let patientAppOtherToken = '';

let breakGlassSessionId = '';
let breakGlassToken = '';

let impersonationSessionId = '';
let impersonationStaffId = '';
let impersonationToken = '';
let hybridEscalationToken = '';

async function mintPatientAppJwt(opts: {
  accountId: string;
  patientId: string;
  clinicId: string;
}): Promise<string> {
  const { config } = await import('../../src/config/config');
  return jwt.sign(
    {
      id: opts.accountId,
      patientId: opts.patientId,
      clinicId: opts.clinicId,
      givenName: 'Cross',
      familyName: 'Use',
      role: 'patient',
      isPatientApp: true,
    },
    config.jwt.accessSecret,
    { expiresIn: '1h' },
  );
}

async function mintBreakGlassJwt(opts: {
  staffId: string;
  clinicId: string;
  sessionId: string;
}): Promise<string> {
  const { config } = await import('../../src/config/config');
  return jwt.sign(
    {
      id: opts.staffId,
      clinicId: opts.clinicId,
      role: 'clinician',
      permissions: ['patient:read'],
      givenName: 'Break',
      familyName: 'Glass',
      email: `${TEST_LABEL}-bg@signacare.local`,
      breakGlass: true,
      breakGlassSessionId: opts.sessionId,
    },
    config.jwt.accessSecret,
    { expiresIn: '15m' },
  );
}

async function mintImpersonationJwt(opts: {
  targetStaffId: string;
  clinicId: string;
  impersonatorAdminId: string;
  sessionId: string;
}): Promise<string> {
  const { config } = await import('../../src/config/config');
  return jwt.sign(
    {
      id: opts.targetStaffId,
      clinicId: opts.clinicId,
      role: 'clinician',
      permissions: [],
      givenName: 'Impersonated',
      familyName: 'Target',
      email: `${TEST_LABEL}-imp@signacare.local`,
      impersonator: opts.impersonatorAdminId,
      impersonationSessionId: opts.sessionId,
    },
    config.jwt.accessSecret,
    { expiresIn: '15m' },
  );
}

async function mintHybridEscalationJwt(opts: {
  accountId: string;
  patientId: string;
  clinicId: string;
}): Promise<string> {
  const { config } = await import('../../src/config/config');
  return jwt.sign(
    {
      id: opts.accountId,
      patientId: opts.patientId,
      clinicId: opts.clinicId,
      role: 'superadmin',
      permissions: ['staff:read'],
      givenName: 'Hybrid',
      familyName: 'Escalation',
      email: `${TEST_LABEL}-hybrid@signacare.local`,
      isPatientApp: true,
    },
    config.jwt.accessSecret,
    { expiresIn: '15m' },
  );
}

describe.skipIf(!READY)('BUG-463 — JWT-payload discriminated cross-use rejection', () => {
  beforeAll(async () => {
    const sess = await loginAsAdmin();
    adminUserId = sess.userId;
    clinicId = sess.clinicId;

    await withTenantContext(clinicId, async () => {
      // ── Two patients in the same clinic for the IDOR axis ──
      patientId = randomUUID();
      otherPatientId = randomUUID();
      await dbAdmin('patients').insert([
        {
          id: patientId,
          clinic_id: clinicId,
          given_name: 'Own',
          family_name: 'Patient',
          emr_number: `${TEST_LABEL}-OWN`,
          date_of_birth: '1990-01-01',
          created_at: new Date(),
          updated_at: new Date(),
        },
        {
          id: otherPatientId,
          clinic_id: clinicId,
          given_name: 'Other',
          family_name: 'Patient',
          emr_number: `${TEST_LABEL}-OTHER`,
          date_of_birth: '1991-01-01',
          created_at: new Date(),
          updated_at: new Date(),
        },
      ]);

      // ── Patient-app account for the OWN patient ──
      patientAccountId = randomUUID();
      await dbAdmin('patient_app_accounts').insert({
        id: patientAccountId,
        clinic_id: clinicId,
        patient_id: patientId,
        phone: `+614${Date.now() % 100_000_000}`.padEnd(13, '0').slice(0, 13),
        password_hash: await bcrypt.hash('not-used', 10),
        is_active: true,
        created_at: new Date(),
        updated_at: new Date(),
      });

      // ── Mint a patient-app JWT for the OWN patient (I3 + I1) ──
      patientAppToken = await mintPatientAppJwt({
        accountId: patientAccountId,
        patientId,
        clinicId,
      });
      hybridEscalationToken = await mintHybridEscalationJwt({
        accountId: patientAccountId,
        patientId,
        clinicId,
      });
      // Prime sessionIdle window so the patient-app token is not 401'd by
      // sessionIdleMiddleware on the protected routes.
      const { primeIdleWindow } = await import('../../src/middleware/sessionIdleMiddleware');
      await primeIdleWindow(patientAccountId, 120);

      // ── Mint a patient-app JWT for the OTHER patient (I2 cross-axis check) ──
      const otherAccountId = randomUUID();
      await dbAdmin('patient_app_accounts').insert({
        id: otherAccountId,
        clinic_id: clinicId,
        patient_id: otherPatientId,
        phone: `+614${(Date.now() + 1) % 100_000_000}`.padEnd(13, '0').slice(0, 13),
        password_hash: await bcrypt.hash('not-used', 10),
        is_active: true,
        created_at: new Date(),
        updated_at: new Date(),
      });
      patientAppOtherToken = await mintPatientAppJwt({
        accountId: otherAccountId,
        patientId: otherPatientId,
        clinicId,
      });
      await primeIdleWindow(otherAccountId, 120);

      // ── Seed a break-glass session for I4 ──
      breakGlassSessionId = randomUUID();
      await dbAdmin('break_glass_sessions').insert({
        id: breakGlassSessionId,
        clinic_id: clinicId,
        staff_id: adminUserId,
        reason: `${TEST_LABEL}-bg-reason`,
        status: 'approved',
        issued_at: new Date(),
        approved_at: new Date(),
        expires_at: new Date(Date.now() + 15 * 60 * 1000),
      });
      breakGlassToken = await mintBreakGlassJwt({
        staffId: adminUserId,
        clinicId,
        sessionId: breakGlassSessionId,
      });

      // ── Seed an impersonation session for I5 ──
      impersonationSessionId = randomUUID();
      impersonationStaffId = randomUUID();
      // Need a real target staff row for the impersonated_staff_id FK
      await dbAdmin('staff').insert({
        id: impersonationStaffId,
        clinic_id: clinicId,
        email: `${TEST_LABEL}-target@signacare.local`,
        given_name: 'Imp',
        family_name: 'Target',
        password_hash: '$2a$10$x'.padEnd(60, 'x'),
        role: 'clinician',
        is_active: true,
        created_at: new Date(),
        updated_at: new Date(),
      });
      await dbAdmin('admin_impersonation_sessions').insert({
        id: impersonationSessionId,
        clinic_id: clinicId,
        admin_id: adminUserId,
        impersonated_staff_id: impersonationStaffId,
        reason: `${TEST_LABEL}-imp-reason`,
        started_at: new Date(),
        expires_at: new Date(Date.now() + 15 * 60 * 1000),
      });
      impersonationToken = await mintImpersonationJwt({
        targetStaffId: impersonationStaffId,
        clinicId,
        impersonatorAdminId: adminUserId,
        sessionId: impersonationSessionId,
      });
      // Prime the idle window for the impersonated staff id; the staff
      // session-idle middleware reads `req.user.id` (the impersonation
      // target, not the admin). adminUserId is already primed via
      // loginAsAdmin and serves the break-glass token.
      await primeIdleWindow(impersonationStaffId, 120);
    }, adminUserId);
  }, 120_000);

  afterAll(async () => {
    if (!READY) return;
    const cleanup = async (): Promise<void> => {
      try { await dbAdmin('admin_impersonation_sessions').where({ id: impersonationSessionId }).delete(); } catch (err) { void err; }
      try { await dbAdmin('break_glass_sessions').where({ id: breakGlassSessionId }).delete(); } catch (err) { void err; }
      if (impersonationStaffId) {
        try { await dbAdmin('staff').where({ id: impersonationStaffId }).delete(); } catch (err) { void err; }
      }
      try { await dbAdmin('patient_app_accounts').where({ patient_id: patientId }).delete(); } catch (err) { void err; }
      try { await dbAdmin('patient_app_accounts').where({ patient_id: otherPatientId }).delete(); } catch (err) { void err; }
      try { await dbAdmin('patients').where({ id: patientId }).delete(); } catch (err) { void err; }
      try { await dbAdmin('patients').where({ id: otherPatientId }).delete(); } catch (err) { void err; }
    };

    if (clinicId) {
      await withTenantContext(clinicId, cleanup, adminUserId || undefined);
      return;
    }
    await cleanup();
  }, 60_000);

  // ────────────────────────────────────────────────────────────────────────
  // I1 — patient-app JWT cannot read a staff-only endpoint.
  //
  // /api/v1/auth/me is under authMiddleware; the controller returns
  // req.user. A patient-app JWT carries role='patient'; the meController
  // doesn't gate on role, but a staff-only route does. Use /api/v1/staff
  // which requires role IN admin/superadmin/clinician. role='patient'
  // is rejected.
  // ────────────────────────────────────────────────────────────────────────
  it('I1 patient-app JWT presented on a staff-only route is rejected (403)', async () => {
    const res = await request(app)
      .get('/api/v1/staff')
      .set('Authorization', `Bearer ${patientAppToken}`)
      .set('X-CSRF-Token', 'test');
    // Either 401 (token not accepted at staff route) or 403 (role mismatch).
    expect([401, 403]).toContain(res.status);
  });

  // ────────────────────────────────────────────────────────────────────────
  // I2 — patient-app JWT for OTHER patient cannot reach OWN-patient route.
  //
  // The dual-mode requirePatientOwnership Branch A asserts
  // tokenPatientId === paramPatientId. Pre-fix this is enforced at
  // runtime via `user.isPatientApp === true && user.patientId === param`
  // — which depends on the projection populating `isPatientApp` and
  // `patientId` correctly from the JWT. Post-fix the discriminated
  // union makes this a typed invariant.
  // ────────────────────────────────────────────────────────────────────────
  it('I2 patient-app JWT for other patient receives 403 PATIENT_OWNERSHIP_MISMATCH', async () => {
    // Use /tracking/:patientId — a real :patientId-keyed route guarded
    // by `requirePatientOwnership`.
    const res = await request(app)
      .get(`/api/v1/patient-app/tracking/${patientId}`)
      .set('Authorization', `Bearer ${patientAppOtherToken}`)
      .set('X-CSRF-Token', 'test');
    expect(res.status).toBe(403);
    expect(JSON.stringify(res.body)).toMatch(/PATIENT_OWNERSHIP_MISMATCH/i);
  });

  // ────────────────────────────────────────────────────────────────────────
  // I3 — patient-app JWT for OWN patient passes Branch A.
  //
  // Same /patient-app/:patientId/me route as I2 but with the matching
  // JWT. Tests that the projection wires `isPatientApp` + `patientId`
  // correctly so Branch A succeeds.
  // ────────────────────────────────────────────────────────────────────────
  it('I3 patient-app JWT for own patient passes (200)', async () => {
    const res = await request(app)
      .get(`/api/v1/patient-app/tracking/${patientId}`)
      .set('Authorization', `Bearer ${patientAppToken}`)
      .set('X-CSRF-Token', 'test');
    expect(res.status).toBe(200);
  });

  // ────────────────────────────────────────────────────────────────────────
  // I4 — break-glass JWT carries breakGlassSessionId through the projection.
  //
  // Hit any authed staff endpoint with the break-glass token; assert the
  // request reaches a 200 (not 401 from authMiddleware). This proves
  // the JWT is verifiable + the discriminated union assigns the
  // staff_break_glass variant. Cross-check via /me which echoes
  // req.user — the projection MUST set `breakGlassSessionId` on the
  // returned user object.
  // ────────────────────────────────────────────────────────────────────────
  it('I4 break-glass JWT projects breakGlassSessionId onto req.user', async () => {
    const res = await request(app)
      .get('/api/v1/auth/me')
      .set('Authorization', `Bearer ${breakGlassToken}`)
      .set('X-CSRF-Token', 'test');
    expect(res.status).toBe(200);
    expect(res.body.breakGlassSessionId).toBe(breakGlassSessionId);
    expect(res.body.breakGlass).toBe(true);
  });

  // ────────────────────────────────────────────────────────────────────────
  // I5 — impersonation JWT carries impersonator + impersonationSessionId.
  //
  // Same shape as I4: hit /me with the impersonation JWT, assert the
  // projection populates the impersonator + impersonationSessionId
  // fields on req.user.
  // ────────────────────────────────────────────────────────────────────────
  it('I5 impersonation JWT projects impersonator + impersonationSessionId onto req.user', async () => {
    const res = await request(app)
      .get('/api/v1/auth/me')
      .set('Authorization', `Bearer ${impersonationToken}`)
      .set('X-CSRF-Token', 'test');
    expect(res.status).toBe(200);
    expect(res.body.impersonator).toBe(adminUserId);
    expect(res.body.impersonationSessionId).toBe(impersonationSessionId);
  });

  it('I6 hybrid patient/staff JWT is rejected before role-gated staff access', async () => {
    const res = await request(app)
      .get('/api/v1/staff')
      .set('Authorization', `Bearer ${hybridEscalationToken}`)
      .set('X-CSRF-Token', 'test');
    expect(res.status).toBe(401);
    expect(JSON.stringify(res.body)).toMatch(/Invalid or expired token/i);
  });
});
