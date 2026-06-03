import { randomUUID } from 'crypto';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import app from '../../src/server';
import { dbAdmin } from '../../src/db/db';
import { isIntegrationReady, loginAsAdmin } from './_helpers';
import { withTenantContext } from '../../src/shared/tenantContext';

const READY = await isIntegrationReady();
const TAG = `BUG-WF71-ACK-${Date.now()}`;

type Session = {
  token: string;
  clinicId: string;
  userId: string;
};

let session: Session;
const createdPatientIds: string[] = [];
const createdReferralIds: string[] = [];

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

async function seedPatient(): Promise<string> {
  const patientId = randomUUID();
  createdPatientIds.push(patientId);
  await withClinicContext(session.clinicId, async (trx) => {
    await trx('patients').insert({
      id: patientId,
      clinic_id: session.clinicId,
      given_name: 'Ack',
      family_name: `Referral-${TAG}`,
      emr_number: `${TAG}-EMR-${Math.random().toString(36).slice(2, 6).toUpperCase()}`,
      date_of_birth: '1990-05-10',
      created_at: new Date(),
      updated_at: new Date(),
    });
  });
  return patientId;
}

beforeAll(async () => {
  if (!READY) return;
  session = await loginAsAdmin();
});

afterAll(async () => {
  if (!READY) return;
  await withClinicContext(session.clinicId, async (trx) => {
    if (createdReferralIds.length > 0) {
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
      await trx('referral_feedback_log')
        .where({ clinic_id: session.clinicId })
        .whereIn('referral_id', createdReferralIds)
        .del()
        .catch(() => undefined);
      await trx('referrals')
        .where({ clinic_id: session.clinicId })
        .whereIn('id', createdReferralIds)
        .del()
        .catch(() => undefined);
    }
    if (createdPatientIds.length > 0) {
      await trx('episodes')
        .where({ clinic_id: session.clinicId })
        .whereIn('patient_id', createdPatientIds)
        .del()
        .catch(() => undefined);
      await trx('patients').whereIn('id', createdPatientIds).del().catch(() => undefined);
    }
  });
});

describe.skipIf(!READY)('BUG-WF71-ACK-EMAIL-MISSING — referral intake acknowledgement SLA', () => {
  it('sends acknowledgement feedback on intake referral create', async () => {
    const patientId = await seedPatient();
    const res = await request(app)
      .post('/api/v1/referrals')
      .set(authHeaders(session.token))
      .send({
        direction: 'intake',
        referralDate: '2026-05-27',
        receivedDate: '2026-05-27',
        source: 'gp',
        fromService: `WF71 ACK ${TAG}`,
        fromProviderName: 'Dr Test Referrer',
        fromProviderEmail: `${TAG.toLowerCase()}@example.test`,
        reason: 'Ack SLA create-path verification',
        urgency: 'routine',
        patientId,
      });

    expect(res.status).toBe(201);
    const referralId = String(res.body?.id ?? '');
    expect(referralId).toMatch(/[0-9a-f-]{36}/);
    createdReferralIds.push(referralId);

    const feedback = await withClinicContext(session.clinicId, async (trx) =>
      trx('referral_feedback_log')
        .where({
          clinic_id: session.clinicId,
          referral_id: referralId,
          feedback_type: 'acknowledged',
        })
        .first('id', 'delivery_status'),
    );
    expect(feedback?.id).toBeTruthy();
    expect(typeof feedback?.delivery_status).toBe('string');

    const referral = await withClinicContext(session.clinicId, async (trx) =>
      trx('referrals')
        .where({ clinic_id: session.clinicId, id: referralId })
        .first('feedback_sent_at'),
    );
    expect(referral?.feedback_sent_at).toBeTruthy();
  });

  it('scheduler backfills acknowledgement for intake referrals missing feedback row after 1 hour', async () => {
    const patientId = await seedPatient();
    const referralId = randomUUID();
    createdReferralIds.push(referralId);

    await withClinicContext(session.clinicId, async (trx) => {
      await trx('referrals').insert({
        id: referralId,
        clinic_id: session.clinicId,
        patient_id: patientId,
        referral_number: `${TAG}-SCHED`,
        referral_date: '2026-05-27',
        source: 'gp',
        from_service: `WF71 ACK SCHED ${TAG}`,
        from_provider_name: 'Dr Scheduler',
        from_provider_email: `${TAG.toLowerCase()}+sched@example.test`,
        reason: 'Ack SLA scheduler-path verification',
        urgency: 'routine',
        status: 'received',
        task_status: 'received',
        referral_mode: 'team',
        target_specialty_code: 'mental_health',
        service_request_status: 'active',
        created_by_staff_id: session.userId,
        created_at: new Date(Date.now() - 2 * 60 * 60 * 1000),
        updated_at: new Date(Date.now() - 2 * 60 * 60 * 1000),
      });
    });

    const { processReferralReminders } = await import('../../src/jobs/schedulers/referralSlaScheduler');
    const seeded = await withClinicContext(session.clinicId, async (trx) =>
      trx('referrals')
        .where({ clinic_id: session.clinicId, id: referralId })
        .first('id', 'created_at', 'from_provider_email', 'source'),
    );
    expect(seeded?.id).toBe(referralId);
    expect(seeded?.from_provider_email).toBeTruthy();
    expect(seeded?.source).toBe('gp');
    expect(new Date(String(seeded?.created_at)).getTime()).toBeLessThan(Date.now() - 60 * 60 * 1000);
    const candidate = await withClinicContext(session.clinicId, async (trx) =>
      trx('referrals as r')
        .whereNull('r.deleted_at')
        .where({ 'r.id': referralId, 'r.clinic_id': session.clinicId })
        .whereNot('r.source', 'internal_outbound')
        .whereNotNull('r.from_provider_email')
        .whereRaw("r.created_at < (NOW() - INTERVAL '1 hour')")
        .whereNotExists(
          trx('referral_feedback_log as f')
            .select(trx.raw('1'))
            .whereRaw('f.referral_id = r.id')
            .andWhereRaw('f.clinic_id = r.clinic_id')
            .andWhere('f.feedback_type', 'acknowledged'),
        )
        .first('r.id'),
    );
    expect(candidate?.id).toBe(referralId);
    const result = await withTenantContext(session.clinicId, () => processReferralReminders());
    expect(result.intakeAcknowledgements).toBeGreaterThan(0);

    const feedback = await withClinicContext(session.clinicId, async (trx) =>
      trx('referral_feedback_log')
        .where({
          clinic_id: session.clinicId,
          referral_id: referralId,
          feedback_type: 'acknowledged',
        })
        .first('id'),
    );
    expect(feedback?.id).toBeTruthy();
  });
});
