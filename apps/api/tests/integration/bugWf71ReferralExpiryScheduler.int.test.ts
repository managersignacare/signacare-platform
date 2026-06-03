import { randomUUID } from 'crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { dbAdmin } from '../../src/db/db';
import { isIntegrationReady, loginAsAdmin } from './_helpers';
import { withTenantContext } from '../../src/shared/tenantContext';

const READY = await isIntegrationReady();
const TAG = `BUG-WF71-EXP-${Date.now()}`;

type Session = { token: string; clinicId: string; userId: string };
let session: Session;
let patientId = '';
let staleReferralId = '';
let terminalReferralId = '';
let staleReferralNumber = '';
let terminalReferralNumber = '';

beforeAll(async () => {
  if (!READY) return;
  session = await loginAsAdmin();

  patientId = randomUUID();
  staleReferralId = randomUUID();
  terminalReferralId = randomUUID();
  staleReferralNumber = `${TAG}-STALE`;
  terminalReferralNumber = `${TAG}-TERM`;

  await withTenantContext(session.clinicId, async () => {
    await dbAdmin('patients').insert({
      id: patientId,
      clinic_id: session.clinicId,
      given_name: 'Referral',
      family_name: 'ExpiryProbe',
      emr_number: `${TAG}-EMR`,
      date_of_birth: '1992-06-01',
      created_at: new Date(),
      updated_at: new Date(),
    });

    await dbAdmin('referrals').insert([
      {
        id: staleReferralId,
        clinic_id: session.clinicId,
        patient_id: patientId,
        referral_number: staleReferralNumber,
        referral_date: '2024-01-01',
        source: 'gp',
        from_service: 'GP Practice',
        from_provider_email: `${TAG.toLowerCase()}@example.test`,
        reason: `${TAG} stale referral`,
        urgency: 'routine',
        status: 'under_review',
        task_status: 'in_progress',
        referral_mode: 'team',
        target_specialty_code: 'mental_health',
        service_request_status: 'active',
        created_by_staff_id: session.userId,
        created_at: new Date('2024-01-01T00:00:00.000Z'),
        updated_at: new Date('2024-01-01T00:00:00.000Z'),
      },
      {
        id: terminalReferralId,
        clinic_id: session.clinicId,
        patient_id: patientId,
        referral_number: terminalReferralNumber,
        referral_date: '2024-01-01',
        source: 'gp',
        from_service: 'GP Practice',
        reason: `${TAG} terminal referral`,
        urgency: 'routine',
        status: 'appointment_booked',
        task_status: 'completed',
        referral_mode: 'team',
        target_specialty_code: 'mental_health',
        service_request_status: 'completed',
        created_by_staff_id: session.userId,
        created_at: new Date('2024-01-01T00:00:00.000Z'),
        updated_at: new Date('2024-01-01T00:00:00.000Z'),
      },
    ]);
  });
});

afterAll(async () => {
  if (!READY) return;
  await withTenantContext(session.clinicId, async () => {
    await dbAdmin('tasks')
      .where({ clinic_id: session.clinicId, assigned_by_id: session.userId })
      .where('title', 'like', `%${TAG}%`)
      .del();
    await dbAdmin('message_threads')
      .where({ clinic_id: session.clinicId, patient_id: patientId })
      .where('subject', 'like', `%${TAG}%`)
      .del();
    await dbAdmin('referral_workflow_events')
      .whereIn('referral_id', [staleReferralId, terminalReferralId])
      .del();
    await dbAdmin('referral_state_transitions')
      .whereIn('referral_id', [staleReferralId, terminalReferralId])
      .del();
    await dbAdmin('referrals')
      .whereIn('id', [staleReferralId, terminalReferralId])
      .del();
    if (patientId) {
      await dbAdmin('patients').where({ id: patientId }).del();
    }
  });
});

describe.skipIf(!READY)('BUG-WF71-EXPIRY-SCHEDULER-MISSING — referral 12-month expiry', () => {
  it('auto-expires stale non-terminal referrals and emits workflow evidence', async () => {
    const { processReferralReminders } = await import('../../src/jobs/schedulers/referralSlaScheduler');
    await withTenantContext(session.clinicId, () => processReferralReminders());

    const stale = await withTenantContext(session.clinicId, async () =>
      dbAdmin('referrals')
        .where({ id: staleReferralId, clinic_id: session.clinicId })
        .first('status', 'task_status', 'status_changed_at'),
    );
    expect(stale).toBeTruthy();
    expect(stale?.status).toBe('expired');
    expect(stale?.task_status).toBe('completed');
    expect(stale?.status_changed_at).toBeTruthy();

    const stateTransition = await withTenantContext(session.clinicId, async () =>
      dbAdmin('referral_state_transitions')
        .where({
          referral_id: staleReferralId,
          clinic_id: session.clinicId,
          to_task_status: 'completed',
        })
        .orderBy('created_at', 'desc')
        .first('id', 'from_task_status'),
    );
    expect(stateTransition?.id).toBeTruthy();
    expect(stateTransition?.from_task_status).toBe('in_progress');

    const expiredEvent = await withTenantContext(session.clinicId, async () =>
      dbAdmin('referral_workflow_events')
        .where({
          referral_id: staleReferralId,
          clinic_id: session.clinicId,
          event_type: 'expired',
        })
        .first('id'),
    );
    expect(expiredEvent?.id).toBeTruthy();
  });

  it('does not mutate already-terminal stale referrals', async () => {
    const terminal = await withTenantContext(session.clinicId, async () =>
      dbAdmin('referrals')
        .where({ id: terminalReferralId, clinic_id: session.clinicId })
        .first('status', 'task_status'),
    );
    expect(terminal).toBeTruthy();
    expect(terminal?.status).toBe('appointment_booked');
    expect(terminal?.task_status).toBe('completed');

    const terminalExpiredEvent = await withTenantContext(session.clinicId, async () =>
      dbAdmin('referral_workflow_events')
        .where({
          referral_id: terminalReferralId,
          clinic_id: session.clinicId,
          event_type: 'expired',
        })
        .first('id'),
    );
    expect(terminalExpiredEvent).toBeUndefined();
  });
});
