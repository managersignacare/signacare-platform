import { randomUUID } from 'crypto';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import app from '../../src/server';
import { dbAdmin } from '../../src/db/db';
import { isIntegrationReady } from './_helpers';
import { CANONICAL_PASSWORD, CANONICAL_PERSONAS } from '../fixtures/canonical-personas';

const READY = await isIntegrationReady();
const TEST_TAG = `BUG-RF-RBAC-${Date.now()}`;

type Session = {
  token: string;
  clinicId: string;
  userId: string;
};

let superadminSession: Session;
let clinicianSession: Session;
let coordinatorSession: Session;
let receptionistSession: Session;

const createdReferralIds: string[] = [];
const createdEpisodeIds: string[] = [];
const createdPatientIds: string[] = [];

function authHeaders(token: string): Record<string, string> {
  return {
    Authorization: `Bearer ${token}`,
    'X-CSRF-Token': 'test',
    'X-Client': 'mobile',
  };
}

async function loginAs(email: string): Promise<Session> {
  const res = await request(app)
    .post('/api/v1/auth/login')
    .set('X-CSRF-Token', 'test')
    .set('X-Client', 'mobile')
    .send({ email, password: CANONICAL_PASSWORD });

  if (res.status !== 200 || !res.body?.accessToken) {
    throw new Error(`Login failed for ${email}: ${res.status} ${JSON.stringify(res.body)}`);
  }

  return {
    token: res.body.accessToken,
    clinicId: res.body.user.clinicId,
    userId: res.body.user.id,
  };
}

async function seedReferral(taskStatus: string, suffix: string): Promise<{ referralId: string }> {
  const patientId = randomUUID();
  const episodeId = randomUUID();
  const referralId = randomUUID();

  createdPatientIds.push(patientId);
  createdEpisodeIds.push(episodeId);
  createdReferralIds.push(referralId);

  await dbAdmin('patients').insert({
    id: patientId,
    clinic_id: superadminSession.clinicId,
    given_name: 'BugRFRbac',
    family_name: `${TEST_TAG}-${suffix}`,
    emr_number: `${TEST_TAG}-${suffix}`,
    date_of_birth: '1990-01-02',
    created_at: new Date(),
    updated_at: new Date(),
  });

  await dbAdmin('episodes').insert({
    id: episodeId,
    clinic_id: superadminSession.clinicId,
    patient_id: patientId,
    primary_clinician_id: clinicianSession.userId,
    episode_type: 'intake',
    presenting_problem: TEST_TAG,
    status: 'open',
    start_date: new Date(),
    created_at: new Date(),
    updated_at: new Date(),
  });

  await dbAdmin('referrals').insert({
    id: referralId,
    clinic_id: superadminSession.clinicId,
    patient_id: patientId,
    linked_episode_id: episodeId,
    referral_number: `${TEST_TAG}-${suffix}`,
    referral_date: '2026-05-14',
    source: 'gp',
    from_service: 'BUG-RF RBAC matrix test',
    from_provider_email: 'referrer@example.test',
    reason: 'RBAC matrix proof',
    urgency: 'routine',
    status: 'received',
    task_status: taskStatus,
    created_by_staff_id: superadminSession.userId,
    created_at: new Date(),
    updated_at: new Date(),
  });

  return { referralId };
}

beforeAll(async () => {
  if (!READY) return;
  superadminSession = await loginAs(CANONICAL_PERSONAS.superadmin.email);
  clinicianSession = await loginAs(CANONICAL_PERSONAS.clinician.email);
  coordinatorSession = await loginAs(CANONICAL_PERSONAS.referralCoordinator.email);
  receptionistSession = await loginAs(CANONICAL_PERSONAS.receptionist.email);
});

afterAll(async () => {
  if (!READY) return;
  if (createdReferralIds.length > 0) {
    await dbAdmin('referral_state_transitions')
      .where({ clinic_id: superadminSession.clinicId })
      .whereIn('referral_id', createdReferralIds)
      .del()
      .catch(() => undefined);
    await dbAdmin('referrals')
      .where({ clinic_id: superadminSession.clinicId })
      .whereIn('id', createdReferralIds)
      .del()
      .catch(() => undefined);
  }
  if (createdEpisodeIds.length > 0) {
    await dbAdmin('episodes').whereIn('id', createdEpisodeIds).del().catch(() => undefined);
  }
  if (createdPatientIds.length > 0) {
    await dbAdmin('patients').whereIn('id', createdPatientIds).del().catch(() => undefined);
  }
});

describe.skipIf(!READY)('BUG-RF RBAC permission matrix', () => {
  it('enforces referral:triage (receptionist denied, clinician allowed)', async () => {
    const { referralId } = await seedReferral('requested', 'triage');

    const receptionistAttempt = await request(app)
      .post(`/api/v1/referrals/${referralId}/triage`)
      .set(authHeaders(receptionistSession.token))
      .send({ reason: 'Front desk triage attempt' });

    expect(receptionistAttempt.status).toBe(403);
    expect(receptionistAttempt.body?.code).toBe('FORBIDDEN');

    const clinicianAttempt = await request(app)
      .post(`/api/v1/referrals/${referralId}/triage`)
      .set(authHeaders(clinicianSession.token))
      .send({ reason: 'Clinical triage' });

    expect(clinicianAttempt.status).toBe(200);
    expect(clinicianAttempt.body.id).toBe(referralId);
  });

  it('enforces referral:assign (clinician denied, referral coordinator allowed)', async () => {
    const { referralId } = await seedReferral('received', 'assign');

    const clinicianAttempt = await request(app)
      .post(`/api/v1/referrals/${referralId}/assign`)
      .set(authHeaders(clinicianSession.token))
      .send({ assignedToStaffId: clinicianSession.userId, reason: 'Clinician self-assign attempt' });

    expect(clinicianAttempt.status).toBe(403);
    expect(clinicianAttempt.body?.code).toBe('FORBIDDEN');

    const coordinatorAttempt = await request(app)
      .post(`/api/v1/referrals/${referralId}/assign`)
      .set(authHeaders(coordinatorSession.token))
      .send({ assignedToStaffId: clinicianSession.userId, reason: 'Coordinator assignment' });

    expect(coordinatorAttempt.status).toBe(200);
    expect(coordinatorAttempt.body.id).toBe(referralId);
  });
});
