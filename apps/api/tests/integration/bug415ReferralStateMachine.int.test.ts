import { randomUUID } from 'crypto';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import app from '../../src/server';
import { dbAdmin } from '../../src/db/db';
import { isIntegrationReady, loginAsAdmin } from './_helpers';

const READY = await isIntegrationReady();
const TEST_TAG = `BUG-415-${Date.now()}`;

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

async function seedReferral(status: string, suffix: string): Promise<{ referralId: string; episodeId: string }> {
  const patientId = randomUUID();
  const episodeId = randomUUID();
  const referralId = randomUUID();

  createdPatientIds.push(patientId);
  createdEpisodeIds.push(episodeId);
  createdReferralIds.push(referralId);

  await dbAdmin('patients').insert({
    id: patientId,
    clinic_id: session.clinicId,
    given_name: 'Bug415',
    family_name: `${TEST_TAG}-${suffix}`,
    emr_number: `${TEST_TAG}-${suffix}`,
    date_of_birth: '1990-01-01',
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
    from_service: 'BUG-415 Regression Test',
    reason: 'State machine transition test',
    urgency: 'routine',
    status,
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

describe.skipIf(!READY)('BUG-415 — referral status state machine regression guard', () => {
  it('allows forward transition on PATCH /referrals/:id (received -> under_review)', async () => {
    const { referralId } = await seedReferral('received', 'forward-route');
    const res = await request(app)
      .patch(`/api/v1/referrals/${referralId}`)
      .set(authHeaders(session.token))
      .send({ status: 'under_review' });

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('under_review');
  });

  it('rejects terminal regression on PATCH /referrals/:id (accepted -> under_review)', async () => {
    const { referralId } = await seedReferral('accepted', 'regress-route');
    const res = await request(app)
      .patch(`/api/v1/referrals/${referralId}`)
      .set(authHeaders(session.token))
      .send({ status: 'under_review' });

    expect(res.status).toBe(422);
    expect(res.body.code).toBe('INVALID_STATE_TRANSITION');

    const persisted = await dbAdmin('referrals')
      .where({ id: referralId, clinic_id: session.clinicId })
      .first('status');
    expect(persisted?.status).toBe('accepted');
  });

  it('rejects terminal regression on PATCH /referrals/by-episode/:episodeId', async () => {
    const { referralId, episodeId } = await seedReferral('accepted', 'regress-by-episode');
    const res = await request(app)
      .patch(`/api/v1/referrals/by-episode/${episodeId}`)
      .set(authHeaders(session.token))
      .send({ status: 'under_review' });

    expect(res.status).toBe(422);
    expect(res.body.code).toBe('INVALID_STATE_TRANSITION');

    const persisted = await dbAdmin('referrals')
      .where({ id: referralId, clinic_id: session.clinicId })
      .first('status');
    expect(persisted?.status).toBe('accepted');
  });

  it('allows canonical post-decision progression (accepted -> appointment_booked)', async () => {
    const { referralId } = await seedReferral('accepted', 'appointment-booked');
    const res = await request(app)
      .patch(`/api/v1/referrals/${referralId}`)
      .set(authHeaders(session.token))
      .send({ status: 'appointment_booked' });

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('appointment_booked');
  });
});

