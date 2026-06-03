import { randomUUID } from 'crypto';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import app from '../../src/server';
import { dbAdmin } from '../../src/db/db';
import { isIntegrationReady, loginAsAdmin } from './_helpers';

const READY = await isIntegrationReady();
const TEST_TAG = `RFDH-${Date.now().toString(36)}`;

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

async function seedReferral(suffix: string): Promise<{ referralId: string; episodeId: string }> {
  const patientId = randomUUID();
  const episodeId = randomUUID();
  const referralId = randomUUID();

  createdPatientIds.push(patientId);
  createdEpisodeIds.push(episodeId);
  createdReferralIds.push(referralId);

  await dbAdmin('patients').insert({
    id: patientId,
    clinic_id: session.clinicId,
    given_name: 'BugRFDecide',
    family_name: `${TEST_TAG}-${suffix}`,
    emr_number: `${TEST_TAG}-${suffix}`,
    date_of_birth: '1991-01-01',
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
    referral_date: '2026-05-16',
    source: 'gp',
    from_service: 'BUG-RF decision hardening test',
    from_provider_email: 'referrer@example.test',
    reason: 'Decision command hardening proof',
    urgency: 'routine',
    status: 'received',
    task_status: 'received',
    created_by_staff_id: session.userId,
    created_at: new Date(),
    updated_at: new Date(),
  });

  return { referralId, episodeId };
}

beforeAll(async () => {
  if (!READY) return;
  session = await loginAsAdmin();
});

afterAll(async () => {
  if (!READY) return;
  if (createdReferralIds.length > 0) {
    await dbAdmin('referral_workflow_events')
      .where({ clinic_id: session.clinicId })
      .whereIn('referral_id', createdReferralIds)
      .del()
      .catch(() => undefined);
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

describe.skipIf(!READY)('BUG-RF decision command hardening', () => {
  it('requires explicit confirmation for accepted decision', async () => {
    const { referralId } = await seedReferral('confirm-required');

    const res = await request(app)
      .post(`/api/v1/referrals/${referralId}/decision`)
      .set(authHeaders(session.token))
      .send({
        decision: 'accepted',
        isExternalTarget: true,
      });

    expect(res.status).toBe(400);
    expect(res.body?.code).toBe('VALIDATION_ERROR');
  });

  it('accepted decision sets status and task_status to accepted', async () => {
    const { referralId } = await seedReferral('accepted-sync');

    const res = await request(app)
      .post(`/api/v1/referrals/${referralId}/decision`)
      .set(authHeaders(session.token))
      .send({
        decision: 'accepted',
        confirmDecision: true,
        isExternalTarget: true,
        notes: 'Accepted to external target after intake review.',
      });

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('accepted');
    expect(res.body.taskStatus).toBe('accepted');

    const persisted = await dbAdmin('referrals')
      .where({ id: referralId, clinic_id: session.clinicId })
      .first('status', 'task_status');
    expect(persisted?.status).toBe('accepted');
    expect(persisted?.task_status).toBe('accepted');
  });

  it('declined alias canonicalizes to rejected and blocks re-decision', async () => {
    const { referralId } = await seedReferral('declined-alias');

    const first = await request(app)
      .post(`/api/v1/referrals/${referralId}/decision`)
      .set(authHeaders(session.token))
      .send({
        decision: 'declined',
        confirmDecision: true,
        decisionReasonCategory: 'capacity',
        declineReason: 'No psychiatrist capacity this week.',
      });

    expect(first.status).toBe(200);
    expect(first.body.status).toBe('rejected');
    expect(first.body.taskStatus).toBe('rejected');

    const persisted = await dbAdmin('referrals')
      .where({ id: referralId, clinic_id: session.clinicId })
      .first('status', 'task_status', 'rejection_reason');
    expect(persisted?.status).toBe('rejected');
    expect(persisted?.task_status).toBe('rejected');
    expect(String(persisted?.rejection_reason ?? '')).toContain('No psychiatrist capacity this week.');

    const second = await request(app)
      .post(`/api/v1/referrals/${referralId}/decision`)
      .set(authHeaders(session.token))
      .send({
        decision: 'accepted',
        confirmDecision: true,
        isExternalTarget: true,
      });

    expect([409, 422]).toContain(second.status);
    expect(second.body?.code).toBe('INVALID_STATE_TRANSITION');
  });
});
