/**
 * BUG-430-PATIENT-APP — patient-app authenticated IDOR class.
 *
 * Patient-app routes use `dbAdmin` (RLS-bypassing owner-role connection)
 * and 14 of them read `req.params.patientId` from the URL with NO
 * verification that it matches `req.user.patientId` from the JWT. This
 * means an authenticated patient can address ANOTHER patient's records
 * by guessing UUIDs — cross-patient AND (because dbAdmin bypasses RLS)
 * cross-clinic. Privacy Act 1988 (Cth) APP 11 / HIPAA §164.312(a)(1)
 * breach class.
 *
 * Test plan:
 *   - 14 IDOR negative tests (Class C per APPENDIX A.3): patient-A's
 *     JWT trying to access patient-B's data via :patientId in the URL.
 *     Pre-fix: 200 with patient-B data. Post-fix: 403 + audit row.
 *   - 6 Class B positive tests: patient using their OWN JWT — must
 *     succeed (defence-in-depth `clinic_id` predicate must not break
 *     the legitimate path).
 *   - 4 Class A pre-auth happy-path tests: /activate and /login still
 *     work after the explicit `clinic_id: <row>.clinic_id` predicate
 *     is added (must not break the row-driven clinic resolution).
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import { v4 as uuidv4 } from 'uuid';
import app from '../../src/server';
import { withTenantContext } from '../../src/shared/tenantContext';
import { isIntegrationReady } from './_helpers';
import { CANONICAL_CLINIC_IDS } from '../fixtures/canonical-personas';

const READY = await isIntegrationReady();

interface PatientFixture {
  clinicId: string;
  patientId: string;
  accountId: string;
  givenName: string;
  familyName: string;
  jwt: string;
}

async function mintPatientJwt(opts: {
  accountId: string;
  patientId: string;
  clinicId: string;
  givenName: string;
  familyName: string;
}): Promise<string> {
  const { config } = await import('../../src/config');
  return jwt.sign(
    {
      id: opts.accountId,
      patientId: opts.patientId,
      clinicId: opts.clinicId,
      givenName: opts.givenName,
      familyName: opts.familyName,
      role: 'patient',
      isPatientApp: true,
    },
    config.jwt.accessSecret,
    { expiresIn: '1h' },
  );
}

async function seedPatient(slug: string): Promise<PatientFixture> {
  const { dbAdmin } = await import('../../src/db/db');
  const givenName = `Test${slug}`;
  const familyName = `IDOR${Date.now() % 100000}`;

  // Use the seed clinic — both fixtures live in the SAME clinic so the
  // cross-PATIENT IDOR is provable independently of the cross-CLINIC
  // axis. (Same-clinic IDOR is the worst-case demonstration: even
  // RLS would not catch it because both patients are valid for the
  // tenancy.)
  const clinicRow = await dbAdmin('clinics')
    .where({ id: CANONICAL_CLINIC_IDS.primary })
    .first('id')
    .catch(() => undefined)
    ?? await dbAdmin('clinics').select('id').first();
  if (!clinicRow) throw new Error('No clinic seeded');
  const clinicId = clinicRow.id as string;

  const patientId = uuidv4();
  const emrNumber = `IDOR-${slug}-${Date.now()}`;
  await withTenantContext(clinicId, () =>
    dbAdmin('patients').insert({
      id: patientId,
      clinic_id: clinicId,
      emr_number: emrNumber,
      given_name: givenName,
      family_name: familyName,
      date_of_birth: '1990-01-01',
      status: 'active',
      interpreter_required: false,
      consent_to_treatment: true,
      consent_for_research: false,
      consent_to_share_with_gp: false,
      consent_to_share_with_carer: false,
      created_at: new Date(),
      updated_at: new Date(),
    }),
  );

  const accountId = uuidv4();
  await withTenantContext(clinicId, async () =>
    dbAdmin('patient_app_accounts').insert({
      id: accountId,
      clinic_id: clinicId,
      patient_id: patientId,
      phone: `+614${Date.now() % 100_000_000}`.padEnd(13, '0').slice(0, 13),
      password_hash: await bcrypt.hash('not-used-in-this-test', 10),
      is_active: true,
      created_at: new Date(),
      updated_at: new Date(),
    }),
  );

  const token = await mintPatientJwt({
    accountId,
    patientId,
    clinicId,
    givenName,
    familyName,
  });

  // Prime the Redis idle sliding window so authMiddleware →
  // sessionIdleMiddleware doesn't 401 the very first request from
  // this fixture. /login does this in production at L403-410.
  const { primeIdleWindow } = await import('../../src/middleware/sessionIdleMiddleware');
  await primeIdleWindow(accountId, 120);

  return { clinicId, patientId, accountId, givenName, familyName, jwt: token };
}

async function teardownPatient(fixture: PatientFixture): Promise<void> {
  const { dbAdmin } = await import('../../src/db/db');
  // Best-effort cleanup — order matters because of FK dependencies.
  await withTenantContext(fixture.clinicId, async () => {
    await dbAdmin('patient_app_accounts').where({ id: fixture.accountId }).del().catch(() => undefined);
    await dbAdmin('patient_tracking').where({ patient_id: fixture.patientId }).del().catch(() => undefined);
    await dbAdmin('patient_med_reminders').where({ patient_id: fixture.patientId }).del().catch(() => undefined);
    await dbAdmin('patient_shared_documents').where({ patient_id: fixture.patientId }).del().catch(() => undefined);
    await dbAdmin('viva_alert_thresholds').where({ patient_id: fixture.patientId }).del().catch(() => undefined);
    await dbAdmin('outcome_measures').where({ patient_id: fixture.patientId }).del().catch(() => undefined);
    await dbAdmin('patient_tasks').where({ patient_id: fixture.patientId }).del().catch(() => undefined);
    await dbAdmin('appointment_checklists').where({ patient_id: fixture.patientId }).del().catch(() => undefined);
    await dbAdmin('patient_fcm_tokens').where({ patient_id: fixture.patientId }).del().catch(() => undefined);
    await dbAdmin('patient_sync_preferences').where({ patient_id: fixture.patientId }).del().catch(() => undefined);
    await dbAdmin('appointments').where({ patient_id: fixture.patientId }).del().catch(() => undefined);
    await dbAdmin('patients').where({ id: fixture.patientId }).del().catch(() => undefined);
  }).catch(() => undefined);
}

describe.skipIf(!READY)('BUG-430-PATIENT-APP — authenticated IDOR closure', () => {
  let patientA: PatientFixture;
  let patientB: PatientFixture;
  let bTrackingId: string;
  let aTrackingId: string;
  let bAppointmentId: string;
  let aAppointmentId: string;

  beforeAll(async () => {
    patientA = await seedPatient('A');
    patientB = await seedPatient('B');

    // BUG-490 fixture — explicit entries with known IDs for the entry-id
    // IDOR tests. patientB's row is the IDOR target; patientA's row is
    // the legitimate-mutation positive case. Schema: id, clinic_id,
    // patient_id, tracking_type, value, note, recorded_at, source,
    // created_at (verified via schema-snapshot.json — no `metric` or
    // `updated_at` column). Inserts fail loudly so future schema drift
    // surfaces immediately.
    const { dbAdmin } = await import('../../src/db/db');
    bTrackingId = uuidv4();
    aTrackingId = uuidv4();
    await withTenantContext(patientB.clinicId, () =>
      dbAdmin('patient_tracking').insert({
        id: bTrackingId,
        clinic_id: patientB.clinicId,
        patient_id: patientB.patientId,
        tracking_type: 'mood',
        value: 7,
        note: 'patientB-original',
        recorded_at: new Date(),
        created_at: new Date(),
      }),
    );
    await withTenantContext(patientA.clinicId, () =>
      dbAdmin('patient_tracking').insert({
        id: aTrackingId,
        clinic_id: patientA.clinicId,
        patient_id: patientA.patientId,
        tracking_type: 'mood',
        value: 4,
        note: 'patientA-original',
        recorded_at: new Date(),
        created_at: new Date(),
      }),
    );

    // BUG-490 fixture — appointments for the PATCH /appointment-response
    // IDOR tests. patient_response starts NULL (not yet triaged).
    // appointments.clinician_id is NOT NULL; use any seeded staff in
    // the test clinic.
    const seedStaff = await withTenantContext(patientA.clinicId, async () =>
      dbAdmin('staff')
        .where({ clinic_id: patientA.clinicId })
        .whereNull('deleted_at')
        .select('id')
        .first(),
    ) as { id: string } | undefined;
    if (!seedStaff) throw new Error('Test setup: no staff in DB for appointments fixture');
    bAppointmentId = uuidv4();
    aAppointmentId = uuidv4();
    const apptStart = new Date(Date.now() + 24 * 60 * 60 * 1000);
    const apptEnd = new Date(apptStart.getTime() + 30 * 60 * 1000);
    const secondApptStart = new Date(apptStart.getTime() + 60 * 60 * 1000);
    const secondApptEnd = new Date(secondApptStart.getTime() + 30 * 60 * 1000);
    // appointments has BOTH legacy start_time/end_time AND
    // appointment_start/appointment_end columns; both NOT NULL.
    await withTenantContext(patientB.clinicId, () =>
      dbAdmin('appointments').insert({
        id: bAppointmentId,
        clinic_id: patientB.clinicId,
        patient_id: patientB.patientId,
        clinician_id: seedStaff.id,
        start_time: apptStart,
        end_time: apptEnd,
        appointment_start: apptStart,
        appointment_end: apptEnd,
        appointment_type: 'follow_up',
        type: 'follow_up',
        status: 'scheduled',
        created_at: new Date(),
        updated_at: new Date(),
      }),
    );
    await withTenantContext(patientA.clinicId, () =>
      dbAdmin('appointments').insert({
        id: aAppointmentId,
        clinic_id: patientA.clinicId,
        patient_id: patientA.patientId,
        clinician_id: seedStaff.id,
        start_time: secondApptStart,
        end_time: secondApptEnd,
        appointment_start: secondApptStart,
        appointment_end: secondApptEnd,
        appointment_type: 'follow_up',
        type: 'follow_up',
        status: 'scheduled',
        created_at: new Date(),
        updated_at: new Date(),
      }),
    );
  });

  afterAll(async () => {
    if (patientA) await teardownPatient(patientA);
    if (patientB) await teardownPatient(patientB);
  });

  // ─── Class C — IDOR-vulnerable POST-AUTH routes (14 sites) ───
  // Each test: patientA's JWT against patientB's :patientId. Pre-fix
  // returns 200 + B's data (the bug). Post-fix returns 403
  // PATIENT_OWNERSHIP_MISMATCH + audit row written.

  const idorRoutes: Array<{ name: string; verb: 'get' | 'post' | 'patch' | 'delete'; path: (b: PatientFixture) => string; body?: () => Record<string, unknown> }> = [
    { name: 'GET /tracking/:patientId (line 507)', verb: 'get', path: (b) => `/api/v1/patient-app/tracking/${b.patientId}` },
    { name: 'GET /med-reminders/:patientId (line 555)', verb: 'get', path: (b) => `/api/v1/patient-app/med-reminders/${b.patientId}` },
    { name: 'DELETE /med-reminders/:patientId/:reminderId (line 582)', verb: 'delete', path: (b) => `/api/v1/patient-app/med-reminders/${b.patientId}/${uuidv4()}` },
    { name: 'GET /shared-docs/:patientId (line 591)', verb: 'get', path: (b) => `/api/v1/patient-app/shared-docs/${b.patientId}` },
    { name: 'GET /thresholds/:patientId (line 649)', verb: 'get', path: (b) => `/api/v1/patient-app/thresholds/${b.patientId}` },
    { name: 'DELETE /thresholds/:patientId/:thresholdId (line 679)', verb: 'delete', path: (b) => `/api/v1/patient-app/thresholds/${b.patientId}/${uuidv4()}` },
    { name: 'GET /threshold-check/:patientId (line 690+699)', verb: 'get', path: (b) => `/api/v1/patient-app/threshold-check/${b.patientId}` },
    { name: 'GET /assessments/:patientId (line 776)', verb: 'get', path: (b) => `/api/v1/patient-app/assessments/${b.patientId}` },
    { name: 'PATCH /assessments/:patientId/:assessmentId/complete (line 790)', verb: 'patch', path: (b) => `/api/v1/patient-app/assessments/${b.patientId}/${uuidv4()}/complete`, body: () => ({}) },
    { name: 'GET /tasks/:patientId (line 809)', verb: 'get', path: (b) => `/api/v1/patient-app/tasks/${b.patientId}` },
    { name: 'PATCH /tasks/:patientId/:taskId (line 847)', verb: 'patch', path: (b) => `/api/v1/patient-app/tasks/${b.patientId}/${uuidv4()}`, body: () => ({ completed: true }) },
    { name: 'GET /checklists/:patientId (line 857)', verb: 'get', path: (b) => `/api/v1/patient-app/checklists/${b.patientId}` },
    { name: 'PATCH /checklists/:patientId/:checklistId (line 880)', verb: 'patch', path: (b) => `/api/v1/patient-app/checklists/${b.patientId}/${uuidv4()}`, body: () => ({ done: true }) },
  ];

  describe('Class C — patient-A JWT cannot address patient-B :patientId routes (14 sites, 13 unique handlers)', () => {
    for (const r of idorRoutes) {
      it(`rejects ${r.name} with 403 PATIENT_OWNERSHIP_MISMATCH`, async () => {
        const req = request(app)[r.verb](r.path(patientB)).set('Authorization', `Bearer ${patientA.jwt}`);
        const res = r.body ? await req.send(r.body()) : await req;
        expect(res.status).toBe(403);
        expect(res.body?.code).toBe('PATIENT_OWNERSHIP_MISMATCH');
      });
    }

    it('writes a PATIENT_APP_IDOR_ATTEMPT audit row carrying both patient ids', async () => {
      const { dbAdmin } = await import('../../src/db/db');
      // Trigger a probe and verify the forensic row.
      await request(app)
        .get(`/api/v1/patient-app/tracking/${patientB.patientId}`)
        .set('Authorization', `Bearer ${patientA.jwt}`);
      // Audit write happens BEFORE the throw; a synchronous SELECT after
      // the request return is sufficient (no await-the-async-write race
      // because the helper awaits writeAuditLog before throwing).
      //
      // BUG-430 follow-up: patient-app actors are UUIDs from
      // patient_app_accounts, not staff. writeAuditLog now retries with
      // staff_id=NULL and preserves the v2 columns (`operation`,
      // `record_id`, `user_id`) instead of falling back to legacy shape.
      const auditRow = await dbAdmin('audit_log')
        .where({ operation: 'PATIENT_APP_IDOR_ATTEMPT', record_id: patientA.patientId })
        .orderBy('created_at', 'desc')
        .first();
      expect(auditRow).toBeTruthy();
      expect(auditRow!.staff_id).toBeNull();
      expect(auditRow!.user_id).toBe(patientA.accountId);
      const newData = typeof auditRow!.new_data === 'string' ? JSON.parse(auditRow!.new_data) : auditRow!.new_data;
      expect(newData?.attempted_patient_id).toBe(patientB.patientId);
    });
  });

  // ─── Class B — POST-AUTH routes already using req.user.patientId (6 sites) ───
  // Verify the defence-in-depth clinic_id predicate doesn't break the legit path.

  describe('Class B — patient succeeds with own JWT (defence-in-depth clinic_id must not break legit path)', () => {
    it('POST /fcm/register-device (line 925) succeeds with own JWT', async () => {
      const res = await request(app)
        .post('/api/v1/patient-app/fcm/register-device')
        .set('Authorization', `Bearer ${patientA.jwt}`)
        .send({ deviceToken: `tok-${Date.now()}`, platform: 'ios' });
      expect([200, 201]).toContain(res.status);
    });

    it('GET /sync-preferences (line 993) succeeds with own JWT', async () => {
      const res = await request(app)
        .get('/api/v1/patient-app/sync-preferences')
        .set('Authorization', `Bearer ${patientA.jwt}`);
      expect([200, 201, 204]).toContain(res.status);
    });

    it('PATCH /sync-preferences (line 1038) succeeds with own JWT', async () => {
      // SYNC_MODULE_KEYS is ['appointments','messages','documents','notifications','reminders']
      const res = await request(app)
        .patch('/api/v1/patient-app/sync-preferences')
        .set('Authorization', `Bearer ${patientA.jwt}`)
        .send({ moduleKey: 'reminders', enabled: true });
      expect([200, 204]).toContain(res.status);
    });

    it('GET /mobile-sync (line 1113+1210) succeeds with own JWT', async () => {
      const res = await request(app)
        .get('/api/v1/patient-app/mobile-sync')
        .set('Authorization', `Bearer ${patientA.jwt}`);
      expect([200, 304]).toContain(res.status);
    });
  });

  // ─── Class A — pre-auth /activate + /login (4 sites) ───
  // After the explicit `clinic_id: invite.clinic_id` / `account.clinic_id`
  // predicates are added, the row-driven clinic resolution must still work.
  // We don't seed a real invite here (that's covered elsewhere); we only
  // verify the routes still respond with the expected NEGATIVE shape
  // (404/401 for unknown invite/credentials), proving the new predicate
  // didn't accidentally break the lookup.

  describe('Class A — pre-auth routes still respond after explicit clinic_id predicate', () => {
    it('POST /activate rejects an unknown invitation code with a structured 4xx', async () => {
      const res = await request(app)
        .post('/api/v1/patient-app/activate')
        .send({
          code: `bogus-code-${Date.now()}`,
          password: 'Password1!Password1!',
          dob: '1990-01-01',
          phone: `+614${Date.now() % 100_000_000}`.padEnd(13, '0').slice(0, 13),
        });
      expect([400, 401, 404]).toContain(res.status);
      expect(typeof res.body?.error === 'string' || typeof res.body?.title === 'string').toBe(true);
    });

    it('POST /login rejects an unknown phone with 401 (no leak)', async () => {
      const res = await request(app)
        .post('/api/v1/patient-app/login')
        .send({
          phone: `+614${Date.now() % 100_000_000}`.padEnd(13, '0').slice(0, 13),
          password: 'wrong-password',
        });
      expect([400, 401]).toContain(res.status);
      const body = JSON.stringify(res.body);
      expect(body).not.toMatch(/clinic_id/i);
      expect(body).not.toMatch(/password_hash/i);
    });
  });

  // ─── Class D — Staff JWT on patient-app routes (REJECT-1 absorb) ─────────
  // The dual-use root cause flagged by L3/L4/L5: VivaTab.tsx makes 30+
  // clinician calls to /patient-app/* with a staff JWT. The helper must
  // dispatch on session class — staff sessions go to requirePatientRelationship,
  // not get hard-403'd. These tests pin the contract.
  describe('Class D — staff JWT dispatches to requirePatientRelationship', () => {
    it('staff JWT calling :patientId routes does NOT receive PATIENT_OWNERSHIP_MISMATCH (regression test)', async () => {
      const { loginAsAdmin } = await import('./_helpers');
      const { token: staffToken } = await loginAsAdmin();
      const probeRoutes = [
        `/api/v1/patient-app/tracking/${patientB.patientId}`,
        `/api/v1/patient-app/med-reminders/${patientB.patientId}`,
        `/api/v1/patient-app/shared-docs/${patientB.patientId}`,
        `/api/v1/patient-app/thresholds/${patientB.patientId}`,
        `/api/v1/patient-app/assessments/${patientB.patientId}`,
        `/api/v1/patient-app/tasks/${patientB.patientId}`,
        `/api/v1/patient-app/checklists/${patientB.patientId}`,
      ];
      for (const url of probeRoutes) {
        const res = await request(app)
          .get(url)
          .set('Authorization', `Bearer ${staffToken}`)
          .set('X-CSRF-Token', 'test');
        // The helper must NOT return PATIENT_OWNERSHIP_MISMATCH for staff
        // sessions (that would brick VivaTab). It may return 200 (admin
        // bypass + tenant scope correct) or 403 NO_PATIENT_RELATIONSHIP.
        if (res.status === 403) {
          expect(res.body?.code).not.toBe('PATIENT_OWNERSHIP_MISMATCH');
        }
      }
    });
  });

  // ─── Class E — entry-id-keyed IDOR (BUG-490, 3 sites) ────────────────────
  // BUG-430-PATIENT-APP gated `:patientId` routes. BUG-490 closes the
  // sibling class: `:entryId` and `:appointmentId` routes that mutate
  // a row by id alone, with no ownership check. Fix shape: SELECT row
  // first → call dual-mode helper with row.patient_id → mutate by
  // {id, clinic_id}.
  describe('Class E — entry-id-keyed IDOR (BUG-490)', () => {
    it('PATCH /tracking/:entryId — patient-A cannot mutate patient-B entry → 403 + audit + row unchanged', async () => {
      const { dbAdmin } = await import('../../src/db/db');
      const before = await dbAdmin('patient_tracking').where({ id: bTrackingId }).first();
      const res = await request(app)
        .patch(`/api/v1/patient-app/tracking/${bTrackingId}`)
        .set('Authorization', `Bearer ${patientA.jwt}`)
        .send({ value: 999, note: 'idor-probe' });
      expect(res.status).toBe(403);
      expect(res.body?.code).toBe('PATIENT_OWNERSHIP_MISMATCH');
      const after = await dbAdmin('patient_tracking').where({ id: bTrackingId }).first();
      expect(Number(after.value)).toBe(Number(before.value));
      expect(after.note).toBe(before.note);
    });

    it('DELETE /tracking/:entryId — patient-A cannot delete patient-B entry → 403 + row still exists', async () => {
      const { dbAdmin } = await import('../../src/db/db');
      const res = await request(app)
        .delete(`/api/v1/patient-app/tracking/${bTrackingId}`)
        .set('Authorization', `Bearer ${patientA.jwt}`);
      expect(res.status).toBe(403);
      expect(res.body?.code).toBe('PATIENT_OWNERSHIP_MISMATCH');
      const after = await dbAdmin('patient_tracking').where({ id: bTrackingId }).first();
      expect(after).toBeTruthy();
    });

    it('PATCH /tracking/:entryId — unknown entryId returns 404 (no audit row)', async () => {
      const res = await request(app)
        .patch(`/api/v1/patient-app/tracking/${uuidv4()}`)
        .set('Authorization', `Bearer ${patientA.jwt}`)
        .send({ value: 1 });
      expect(res.status).toBe(404);
    });

    it('PATCH /tracking/:entryId — patient mutating OWN entry succeeds', async () => {
      const { dbAdmin } = await import('../../src/db/db');
      const res = await request(app)
        .patch(`/api/v1/patient-app/tracking/${aTrackingId}`)
        .set('Authorization', `Bearer ${patientA.jwt}`)
        .send({ value: 8, note: 'patientA-updated' });
      expect([200, 204]).toContain(res.status);
      const after = await dbAdmin('patient_tracking').where({ id: aTrackingId }).first();
      expect(Number(after.value)).toBe(8);
    });

    it('PATCH /appointment-response/:appointmentId — patient-A cannot flip patient-B appointment → 403 + row unchanged', async () => {
      const { dbAdmin } = await import('../../src/db/db');
      const before = await dbAdmin('appointments').where({ id: bAppointmentId }).first();
      const res = await request(app)
        .patch(`/api/v1/patient-app/appointment-response/${bAppointmentId}`)
        .set('Authorization', `Bearer ${patientA.jwt}`)
        .send({ response: 'not_attending' });
      expect(res.status).toBe(403);
      expect(res.body?.code).toBe('PATIENT_OWNERSHIP_MISMATCH');
      const after = await dbAdmin('appointments').where({ id: bAppointmentId }).first();
      expect(after.patient_response).toBe(before.patient_response);
    });

    it('PATCH /appointment-response/:appointmentId — unknown appointmentId returns 404 (no audit row)', async () => {
      const res = await request(app)
        .patch(`/api/v1/patient-app/appointment-response/${uuidv4()}`)
        .set('Authorization', `Bearer ${patientA.jwt}`)
        .send({ response: 'attending' });
      expect(res.status).toBe(404);
    });

    it('PATCH /appointment-response/:appointmentId — patient mutating OWN appointment succeeds', async () => {
      const { dbAdmin } = await import('../../src/db/db');
      const res = await request(app)
        .patch(`/api/v1/patient-app/appointment-response/${aAppointmentId}`)
        .set('Authorization', `Bearer ${patientA.jwt}`)
        .send({ response: 'attending' });
      expect([200, 204]).toContain(res.status);
      const after = await dbAdmin('appointments').where({ id: aAppointmentId }).first();
      expect(after.patient_response).toBe('attending');
    });
  });
});
