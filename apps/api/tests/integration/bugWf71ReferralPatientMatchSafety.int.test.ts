import { randomUUID } from 'crypto';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import app from '../../src/server';
import { dbAdmin } from '../../src/db/db';
import { isIntegrationReady, loginAsAdmin } from './_helpers';

const READY = await isIntegrationReady();
const TEST_TAG = `WF71-${Date.now().toString(36)}`;

type Session = {
  token: string;
  clinicId: string;
  userId: string;
};

let session: Session;
let otherClinicId: string;
const createdPatientIds: string[] = [];
const createdReferralIds: string[] = [];
const createdEpisodeIds: string[] = [];

function authHeaders(token: string): Record<string, string> {
  return {
    Authorization: `Bearer ${token}`,
    'X-CSRF-Token': 'test',
    'X-Client': 'mobile',
  };
}

async function withClinicContext<T>(
  clinicId: string,
  work: (trx: Awaited<ReturnType<typeof dbAdmin.transaction>>) => Promise<T>,
): Promise<T> {
  return dbAdmin.transaction(async (trx) => {
    await trx.raw("SELECT set_config('app.clinic_id', ?, true)", [clinicId]);
    return work(trx);
  });
}

async function seedPatient(params: {
  clinicId: string;
  givenName: string;
  familyName: string;
  dob: string;
}): Promise<string> {
  const patientId = randomUUID();
  createdPatientIds.push(patientId);
  await withClinicContext(params.clinicId, async (trx) => {
    await trx('patients').insert({
      id: patientId,
      clinic_id: params.clinicId,
      given_name: params.givenName,
      family_name: params.familyName,
      emr_number: `${TEST_TAG}-${Math.random().toString(36).slice(2, 8).toUpperCase()}`,
      date_of_birth: params.dob,
      created_at: new Date(),
      updated_at: new Date(),
    });
  });
  return patientId;
}

async function seedReferral(params: {
  patientId: string;
  suffix: string;
}): Promise<{ referralId: string; episodeId: string }> {
  const episodeId = randomUUID();
  const referralId = randomUUID();
  createdEpisodeIds.push(episodeId);
  createdReferralIds.push(referralId);
  await withClinicContext(session.clinicId, async (trx) => {
    await trx('episodes').insert({
      id: episodeId,
      clinic_id: session.clinicId,
      patient_id: params.patientId,
      primary_clinician_id: session.userId,
      episode_type: 'intake',
      status: 'open',
      start_date: new Date(),
      presenting_problem: `${TEST_TAG}-${params.suffix}`,
      created_at: new Date(),
      updated_at: new Date(),
    });

    await trx('referrals').insert({
      id: referralId,
      clinic_id: session.clinicId,
      patient_id: params.patientId,
      linked_episode_id: episodeId,
      referral_number: `${TEST_TAG}-${params.suffix}`,
      referral_date: '2026-05-24',
      source: 'gp',
      from_service: `WF71 ${params.suffix}`,
      reason: 'Referral intake safety test',
      urgency: 'routine',
      status: 'received',
      task_status: 'received',
      service_request_status: 'active',
      target_specialty_code: 'mental_health',
      created_by_staff_id: session.userId,
      created_at: new Date(),
      updated_at: new Date(),
    });
  });

  return { referralId, episodeId };
}

beforeAll(async () => {
  if (!READY) return;
  session = await loginAsAdmin();
  const otherClinic = await dbAdmin('clinics')
    .whereNot('id', session.clinicId)
    .whereNull('deleted_at')
    .first('id');
  if (!otherClinic?.id) {
    throw new Error('WF71 test requires a second clinic row for cross-clinic safety assertions.');
  }
  otherClinicId = String(otherClinic.id);
});

afterAll(async () => {
  if (!READY) return;
  if (createdReferralIds.length > 0) {
    await withClinicContext(session.clinicId, async (trx) => {
      await trx('referral_state_transitions')
        .where({ clinic_id: session.clinicId })
        .whereIn('referral_id', createdReferralIds)
        .del()
        .catch(() => undefined);
      await trx('referral_workflow_events')
        .where({ clinic_id: session.clinicId })
        .whereIn('referral_id', createdReferralIds)
        .del()
        .catch(() => undefined);
      await trx('referrals')
        .where({ clinic_id: session.clinicId })
        .whereIn('id', createdReferralIds)
        .del()
        .catch(() => undefined);
    });
  }
  if (createdEpisodeIds.length > 0) {
    await withClinicContext(session.clinicId, async (trx) => {
      await trx('episodes').whereIn('id', createdEpisodeIds).del().catch(() => undefined);
    });
  }
  if (createdPatientIds.length > 0) {
    await withClinicContext(session.clinicId, async (trx) => {
      await trx('patients').whereIn('id', createdPatientIds).del().catch(() => undefined);
    });
    await withClinicContext(otherClinicId, async (trx) => {
      await trx('patients').whereIn('id', createdPatientIds).del().catch(() => undefined);
    });
  }
});

describe.skipIf(!READY)('BUG-WF71 referral patient-match safety', () => {
  it('blocks intake quick-registration when duplicate candidates exist and demands explicit patient selection', async () => {
    await seedPatient({
      clinicId: session.clinicId,
      givenName: 'Noah',
      familyName: `Bennett-${TEST_TAG}`,
      dob: '1988-02-10',
    });

    const res = await request(app)
      .post('/api/v1/referrals')
      .set(authHeaders(session.token))
      .send({
        direction: 'intake',
        referralDate: '2026-05-24',
        receivedDate: '2026-05-24',
        source: 'gp',
        fromService: `WF71 duplicate test ${TEST_TAG}`,
        reason: 'Needs urgent psychiatric review',
        urgency: 'urgent',
        patientGivenName: 'Noah',
        patientFamilyName: `Bennett-${TEST_TAG}`,
        patientDob: '1988-02-10',
      });

    expect(res.status).toBe(409);
    expect(res.body?.code).toBe('REFERRAL_PATIENT_MATCH_REVIEW_REQUIRED');
    expect(Array.isArray(res.body?.details?.candidates)).toBe(true);
    expect((res.body?.details?.candidates ?? []).length).toBeGreaterThan(0);
  });

  it('rejects referral create when patientId belongs to another clinic', async () => {
    const foreignPatientId = await seedPatient({
      clinicId: otherClinicId,
      givenName: 'Cross',
      familyName: `Tenant-${TEST_TAG}`,
      dob: '1990-03-01',
    });

    const res = await request(app)
      .post('/api/v1/referrals')
      .set(authHeaders(session.token))
      .send({
        direction: 'intake',
        referralDate: '2026-05-24',
        receivedDate: '2026-05-24',
        source: 'gp',
        fromService: `WF71 cross-clinic ${TEST_TAG}`,
        reason: 'Cross-clinic patient reference should fail',
        urgency: 'routine',
        patientId: foreignPatientId,
      });

    expect(res.status).toBe(422);
    expect(res.body?.code).toBe('REFERRAL_PATIENT_NOT_FOUND_IN_CLINIC');
  });

  it('forbids relinking an existing referral to a different patient via decision endpoint', async () => {
    const originalPatientId = await seedPatient({
      clinicId: session.clinicId,
      givenName: 'Amelia',
      familyName: `Carter-${TEST_TAG}`,
      dob: '1985-07-07',
    });
    const otherPatientId = await seedPatient({
      clinicId: session.clinicId,
      givenName: 'Rachel',
      familyName: `Moore-${TEST_TAG}`,
      dob: '1987-04-20',
    });

    const { referralId } = await seedReferral({
      patientId: originalPatientId,
      suffix: 'relink-forbidden',
    });

    const res = await request(app)
      .post(`/api/v1/referrals/${referralId}/decision`)
      .set(authHeaders(session.token))
      .send({
        decision: 'accepted',
        confirmDecision: true,
        isExternalTarget: true,
        patientId: otherPatientId,
      });

    expect(res.status).toBe(409);
    expect(res.body?.code).toBe('REFERRAL_PATIENT_RELINK_FORBIDDEN');

    const persisted = await withClinicContext(session.clinicId, async (trx) => (
      trx('referrals')
        .where({ id: referralId, clinic_id: session.clinicId })
        .first('patient_id', 'status')
    ));
    expect(String(persisted?.patient_id ?? '')).toBe(originalPatientId);
    expect(String(persisted?.status ?? '')).toBe('received');
  });
});
