import { randomUUID } from 'crypto';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import app from '../../src/server';
import { dbAdmin } from '../../src/db/db';
import { isIntegrationReady, loginAsAdmin } from './_helpers';

const READY = await isIntegrationReady();
const TEST_TAG = `BUG-RF-STATE-CMD-${Date.now()}`;

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
    given_name: 'BugRFState',
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
    from_service: 'BUG-RF state command ownership test',
    from_provider_email: 'referrer@example.test',
    reason: 'Command ownership proof',
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

describe.skipIf(!READY)('BUG-RF referral state command ownership', () => {
  it('PATCH /referrals/by-episode/:episodeId applies state-machine transition via command', async () => {
    const { referralId, episodeId } = await seedReferral('received', 'by-episode');

    const res = await request(app)
      .patch(`/api/v1/referrals/by-episode/${episodeId}`)
      .set(authHeaders(session.token))
      .send({ status: 'under_review' });

    expect(res.status).toBe(200);
    expect(res.body.id).toBe(referralId);
    expect(res.body.status).toBe('under_review');

    const referral = await dbAdmin('referrals')
      .where({ id: referralId, clinic_id: session.clinicId })
      .first('status');
    expect(referral?.status).toBe('under_review');
  });

  it('POST /referrals/:id/notes appends timeline note via command', async () => {
    const { referralId } = await seedReferral('received', 'notes');
    const note = 'Clarification call completed and family collateral received.';

    const res = await request(app)
      .post(`/api/v1/referrals/${referralId}/notes`)
      .set(authHeaders(session.token))
      .send({ note });

    expect(res.status).toBe(201);
    expect(res.body.note).toBeDefined();
    expect(typeof res.body.note.id).toBe('string');
    expect(res.body.note.reason ?? res.body.note.note).toBe(note);

    const transition = await dbAdmin('referral_state_transitions')
      .where({ referral_id: referralId, clinic_id: session.clinicId })
      .orderBy('created_at', 'desc')
      .first('reason', 'from_task_status', 'to_task_status');

    expect(transition?.reason).toBe(note);
    expect(transition?.from_task_status).toBe('requested');
    expect(transition?.to_task_status).toBe('requested');
  });
});
