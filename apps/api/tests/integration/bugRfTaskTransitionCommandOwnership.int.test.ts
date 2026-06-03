import { randomUUID } from 'crypto';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import app from '../../src/server';
import { dbAdmin } from '../../src/db/db';
import { isIntegrationReady, loginAsAdmin } from './_helpers';

const READY = await isIntegrationReady();
const TEST_TAG = `BUG-RF-TASK-CMD-${Date.now()}`;

type Session = {
  token: string;
  clinicId: string;
  userId: string;
};

let session: Session;
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

async function seedReferral(suffix: string, taskStatus: string): Promise<{ referralId: string }> {
  const patientId = randomUUID();
  const episodeId = randomUUID();
  const referralId = randomUUID();

  createdPatientIds.push(patientId);
  createdEpisodeIds.push(episodeId);
  createdReferralIds.push(referralId);

  await dbAdmin('patients').insert({
    id: patientId,
    clinic_id: session.clinicId,
    given_name: 'BugRFTask',
    family_name: `${TEST_TAG}-${suffix}`,
    emr_number: `${TEST_TAG}-${suffix}`,
    date_of_birth: '1992-03-03',
    created_at: new Date(),
    updated_at: new Date(),
  });

  await dbAdmin('episodes').insert({
    id: episodeId,
    clinic_id: session.clinicId,
    patient_id: patientId,
    primary_clinician_id: session.userId,
    episode_type: 'intake',
    presenting_problem: TEST_TAG,
    status: 'open',
    start_date: new Date(),
    created_at: new Date(),
    updated_at: new Date(),
  });

  await dbAdmin('referrals').insert({
    id: referralId,
    clinic_id: session.clinicId,
    patient_id: patientId,
    linked_episode_id: episodeId,
    referral_number: `${TEST_TAG}-${suffix}`,
    referral_date: '2026-05-14',
    source: 'gp',
    from_service: 'BUG-RF task command ownership test',
    from_provider_email: 'referrer@example.test',
    reason: 'Task command ownership proof',
    urgency: 'routine',
    status: 'received',
    task_status: taskStatus,
    created_by_staff_id: session.userId,
    created_at: new Date(),
    updated_at: new Date(),
  });

  return { referralId };
}

beforeAll(async () => {
  if (!READY) return;
  session = await loginAsAdmin();
});

afterAll(async () => {
  if (!READY) return;
  if (createdReferralIds.length > 0) {
    await dbAdmin('referral_state_transitions')
      .where({ clinic_id: session.clinicId })
      .whereIn('referral_id', createdReferralIds)
      .del()
      .catch(() => undefined);
    await dbAdmin('referrals')
      .where({ clinic_id: session.clinicId })
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

describe.skipIf(!READY)('BUG-RF task-transition command ownership', () => {
  it('POST /referrals/:id/triage transitions task to received and records coordinator metadata', async () => {
    const { referralId } = await seedReferral('triage', 'requested');

    const res = await request(app)
      .post(`/api/v1/referrals/${referralId}/triage`)
      .set(authHeaders(session.token))
      .send({ reason: 'Front desk triage complete.' });

    expect(res.status).toBe(200);
    expect(res.body.id).toBe(referralId);

    const referral = await dbAdmin('referrals')
      .where({ id: referralId, clinic_id: session.clinicId })
      .first('task_status', 'coordinator_id', 'triaged_by');

    expect(referral?.task_status).toBe('received');
    expect(referral?.coordinator_id).toBe(session.userId);
    expect(referral?.triaged_by).toBe(session.userId);
  });

  it('POST /referrals/:id/assign transitions task to in_progress and stores assignment', async () => {
    const { referralId } = await seedReferral('assign', 'received');

    const res = await request(app)
      .post(`/api/v1/referrals/${referralId}/assign`)
      .set(authHeaders(session.token))
      .send({
        assignedToStaffId: session.userId,
        reason: 'Assigning to on-call psychiatrist.',
      });

    expect(res.status).toBe(200);
    expect(res.body.id).toBe(referralId);

    const referral = await dbAdmin('referrals')
      .where({ id: referralId, clinic_id: session.clinicId })
      .first('task_status', 'status', 'assigned_to_staff_id');

    expect(referral?.task_status).toBe('in_progress');
    expect(referral?.status).toBe('received');
    expect(referral?.assigned_to_staff_id).toBe(session.userId);
  });

  it('POST /referrals/:id/accept and /decline synchronize status with task_status', async () => {
    const { referralId: acceptReferralId } = await seedReferral('accept-sync', 'received');

    const acceptRes = await request(app)
      .post(`/api/v1/referrals/${acceptReferralId}/accept`)
      .set(authHeaders(session.token))
      .send({ confirmDecision: true, reason: 'Intake accepted after review.' });

    expect(acceptRes.status).toBe(200);
    const accepted = await dbAdmin('referrals')
      .where({ id: acceptReferralId, clinic_id: session.clinicId })
      .first('status', 'task_status');
    expect(accepted?.status).toBe('accepted');
    expect(accepted?.task_status).toBe('accepted');

    const { referralId: declineReferralId } = await seedReferral('decline-sync', 'received');
    const declineRes = await request(app)
      .post(`/api/v1/referrals/${declineReferralId}/decline`)
      .set(authHeaders(session.token))
      .send({
        confirmDecision: true,
        decisionReasonCategory: 'capacity',
        reason: 'No current program capacity.',
      });

    expect(declineRes.status).toBe(200);
    const declined = await dbAdmin('referrals')
      .where({ id: declineReferralId, clinic_id: session.clinicId })
      .first('status', 'task_status', 'rejection_reason');
    expect(declined?.status).toBe('rejected');
    expect(declined?.task_status).toBe('rejected');
    expect(String(declined?.rejection_reason ?? '')).toContain('capacity');
  });
});
