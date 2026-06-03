import { randomUUID } from 'crypto';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import app from '../../src/server';
import { dbAdmin } from '../../src/db/db';
import { isIntegrationReady, loginAsAdmin } from './_helpers';

const READY = await isIntegrationReady();
const TEST_TAG = `WF41-NOTIFY-${Date.now().toString(36)}`;

type Session = {
  token: string;
  clinicId: string;
  userId: string;
};

let session: Session;
let patientId = '';
const appointmentIds: string[] = [];
let targetClinicianId = '';

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

beforeAll(async () => {
  if (!READY) return;
  session = await loginAsAdmin();
  patientId = randomUUID();

  const staffId = await withClinicContext(session.clinicId, async (trx) => {
    const row = await trx('staff')
      .where({ clinic_id: session.clinicId })
      .whereNull('deleted_at')
      .whereNot({ id: session.userId })
      .whereIn('role', ['clinician', 'psychiatrist', 'nurse', 'case_manager'])
      .first('id');
    return (row?.id as string | undefined) ?? '';
  });
  if (!staffId) {
    throw new Error('No target clinician found in seed data for appointment notification integration test');
  }
  targetClinicianId = staffId;

  await withClinicContext(session.clinicId, async (trx) => {
    await trx('patients').insert({
      id: patientId,
      clinic_id: session.clinicId,
      given_name: 'Notify',
      family_name: `Clinician-${TEST_TAG}`,
      emr_number: `${TEST_TAG}-P`,
      date_of_birth: '1991-02-20',
      created_at: new Date(),
      updated_at: new Date(),
    });
  });
});

afterAll(async () => {
  if (!READY) return;
  await withClinicContext(session.clinicId, async (trx) => {
    if (appointmentIds.length > 0) {
      await trx('notifications')
        .where({ clinic_id: session.clinicId, recipient_staff_id: targetClinicianId })
        .whereIn(
          trx.raw("payload->>'dedupe_key'"),
          appointmentIds.map((id) => `appointment-booked:${id}:${targetClinicianId}`),
        )
        .del()
        .catch(() => undefined);
      await trx('notifications')
        .where({ clinic_id: session.clinicId, recipient_staff_id: session.userId })
        .whereIn(
          trx.raw("payload->>'dedupe_key'"),
          appointmentIds.map((id) => `appointment-booked:${id}:${session.userId}`),
        )
        .del()
        .catch(() => undefined);
      await trx('appointments').whereIn('id', appointmentIds).del().catch(() => undefined);
    }
    await trx('patients').where({ id: patientId }).del().catch(() => undefined);
  });
});

describe.skipIf(!READY)('BUG-WF41 clinician notification on appointment create', () => {
  it('emits appointment-booked notification for the booked clinician', async () => {
    const start = new Date();
    start.setUTCDate(start.getUTCDate() + 1);
    start.setUTCHours(2, 0, 0, 0); // clinic-local daytime for AU timezones
    const end = new Date(start.getTime() + 30 * 60 * 1000);

    const res = await request(app)
      .post('/api/v1/appointments')
      .set(authHeaders(session.token))
      .send({
        patientId,
        clinicianId: targetClinicianId,
        startTime: start.toISOString(),
        endTime: end.toISOString(),
        type: 'follow_up',
        notes: `WF41 notification test ${TEST_TAG}`,
      });

    expect(res.status).toBe(201);
    const appointmentId = res.body?.id as string;
    expect(typeof appointmentId).toBe('string');
    appointmentIds.push(appointmentId);

    const row = await withClinicContext(session.clinicId, async (trx) =>
      trx('notifications')
        .where({ clinic_id: session.clinicId, recipient_staff_id: targetClinicianId })
        .whereRaw("payload->>'dedupe_key' = ?", [`appointment-booked:${appointmentId}:${targetClinicianId}`])
        .first('title', 'category', 'link', 'payload'),
    );

    expect(row).toBeTruthy();
    expect(row?.category).toBe('appointment');
    expect(row?.title).toBe('New appointment booked');
    expect(row?.link).toBe(`/patients/${patientId}`);
  });

  it('does not emit booking notification when creator books on own calendar', async () => {
    const start = new Date();
    start.setUTCDate(start.getUTCDate() + 2);
    start.setUTCHours(2, 45, 0, 0);
    const end = new Date(start.getTime() + 30 * 60 * 1000);

    const res = await request(app)
      .post('/api/v1/appointments')
      .set(authHeaders(session.token))
      .send({
        patientId,
        clinicianId: session.userId,
        startTime: start.toISOString(),
        endTime: end.toISOString(),
        type: 'follow_up',
        notes: `WF41 self-booking notification suppression ${TEST_TAG}`,
      });

    expect(res.status).toBe(201);
    const appointmentId = res.body?.id as string;
    expect(typeof appointmentId).toBe('string');
    appointmentIds.push(appointmentId);

    const row = await withClinicContext(session.clinicId, async (trx) =>
      trx('notifications')
        .where({ clinic_id: session.clinicId, recipient_staff_id: session.userId })
        .whereRaw("payload->>'dedupe_key' = ?", [`appointment-booked:${appointmentId}:${session.userId}`])
        .first('id'),
    );

    expect(row).toBeFalsy();
  });
});
