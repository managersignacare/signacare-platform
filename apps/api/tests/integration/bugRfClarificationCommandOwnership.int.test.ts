import { randomUUID } from 'crypto';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import app from '../../src/server';
import { dbAdmin } from '../../src/db/db';
import { isIntegrationReady, loginAsAdmin } from './_helpers';

const READY = await isIntegrationReady();
const TEST_TAG = `BUG-RF-CLAR-${Date.now()}`;

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

async function seedReferral(status: string, suffix: string): Promise<{ referralId: string }> {
  const patientId = randomUUID();
  const episodeId = randomUUID();
  const referralId = randomUUID();

  createdPatientIds.push(patientId);
  createdEpisodeIds.push(episodeId);
  createdReferralIds.push(referralId);

  await dbAdmin('patients').insert({
    id: patientId,
    clinic_id: session.clinicId,
    given_name: 'BugRFClar',
    family_name: `${TEST_TAG}-${suffix}`,
    emr_number: `${TEST_TAG}-${suffix}`,
    date_of_birth: '1991-02-02',
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
    from_service: 'BUG-RF Clarification Regression Test',
    from_provider_email: 'referrer@example.test',
    reason: 'Clarification command ownership',
    urgency: 'routine',
    status,
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
    await dbAdmin('referral_workflow_events')
      .where({ clinic_id: session.clinicId })
      .whereIn('referral_id', createdReferralIds)
      .del()
      .catch(() => undefined);
    await dbAdmin('referral_feedback_log')
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

describe.skipIf(!READY)('BUG-RF clarification command ownership', () => {
  it('POST /referrals/:id/clarification transitions to info_requested and logs workflow event', async () => {
    const { referralId } = await seedReferral('received', 'clar-request');
    const question = 'Please share baseline risk history and recent medication changes.';

    const res = await request(app)
      .post(`/api/v1/referrals/${referralId}/clarification`)
      .set(authHeaders(session.token))
      .send({ question });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });

    const referral = await dbAdmin('referrals')
      .where({ id: referralId, clinic_id: session.clinicId })
      .first('status');
    expect(referral?.status).toBe('info_requested');

    const event = await dbAdmin('referral_workflow_events')
      .where({ referral_id: referralId, clinic_id: session.clinicId, event_type: 'clarification_requested' })
      .orderBy('event_at', 'desc')
      .first('notes');
    expect(event?.notes).toBe(question);
  });

  it('PATCH /referrals/:id/clarification-response transitions to under_review and persists notes', async () => {
    const { referralId } = await seedReferral('info_requested', 'clar-response');
    const notes = 'Updated referral notes: safety plan attached and recent pathology uploaded.';

    const res = await request(app)
      .patch(`/api/v1/referrals/${referralId}/clarification-response`)
      .set(authHeaders(session.token))
      .send({ notes });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });

    const referral = await dbAdmin('referrals')
      .where({ id: referralId, clinic_id: session.clinicId })
      .first('status', 'clarification_notes');
    expect(referral?.status).toBe('under_review');
    expect(referral?.clarification_notes).toBe(notes);

    const event = await dbAdmin('referral_workflow_events')
      .where({ referral_id: referralId, clinic_id: session.clinicId, event_type: 'clarification_received' })
      .orderBy('event_at', 'desc')
      .first('notes');
    expect(event?.notes).toBe('Clarification received and added to referral');
  });
});

