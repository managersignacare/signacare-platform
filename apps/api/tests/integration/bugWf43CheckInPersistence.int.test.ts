import { randomUUID } from 'crypto';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import app from '../../src/server';
import { dbAdmin } from '../../src/db/db';
import { isIntegrationReady, loginAsAdmin } from './_helpers';

const READY = await isIntegrationReady();
const TEST_TAG = `WF43-CHECKIN-${Date.now().toString(36)}`;

type Session = {
  token: string;
  clinicId: string;
  userId: string;
};

let session: Session;
let patientId = '';
let appointmentId = '';
let invoiceId = '';
let referralId = '';
let referralAttachmentId = '';
let flagId = '';

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
  appointmentId = randomUUID();
  invoiceId = randomUUID();
  referralId = randomUUID();
  referralAttachmentId = randomUUID();
  flagId = randomUUID();

  const start = new Date();
  const end = new Date(start.getTime() + 30 * 60 * 1000);

  await withClinicContext(session.clinicId, async (trx) => {
    await trx('patients').insert({
      id: patientId,
      clinic_id: session.clinicId,
      given_name: 'Checkin',
      family_name: `Patient-${TEST_TAG}`,
      emr_number: `${TEST_TAG}-P`,
      date_of_birth: '1993-07-11',
      created_at: new Date(),
      updated_at: new Date(),
    });

    await trx('appointments').insert({
      id: appointmentId,
      clinic_id: session.clinicId,
      patient_id: patientId,
      clinician_id: session.userId,
      staff_id: session.userId,
      start_time: start.toISOString(),
      end_time: end.toISOString(),
      appointment_start: start.toISOString(),
      appointment_end: end.toISOString(),
      status: 'scheduled',
      type: 'review',
      specialty_code: 'mental_health',
      reminder_scheduled: false,
      reminder_sent: false,
      lock_version: 1,
      created_at: new Date(),
      updated_at: new Date(),
    });

    await trx('invoices').insert({
      id: invoiceId,
      clinic_id: session.clinicId,
      patient_id: patientId,
      invoice_number: `${TEST_TAG}-INV`,
      status: 'unpaid',
      auto_generated: false,
      created_at: new Date(),
      updated_at: new Date(),
    });

    await trx('patient_flags').insert({
      id: flagId,
      clinic_id: session.clinicId,
      patient_id: patientId,
      category: 'clinical',
      severity: 'high',
      title: `WF43 active flag ${TEST_TAG}`,
      status: 'active',
      raised_at: new Date(),
      is_header_flag: false,
      created_at: new Date(),
      updated_at: new Date(),
    });

    await trx('referrals').insert({
      id: referralId,
      clinic_id: session.clinicId,
      patient_id: patientId,
      linked_episode_id: null,
      referral_number: `${TEST_TAG}-R`,
      referral_date: '2026-05-24',
      source: 'gp',
      from_service: 'WF43 check-in',
      reason: 'Outstanding item aggregation test',
      urgency: 'routine',
      status: 'received',
      task_status: 'received',
      service_request_status: 'active',
      target_specialty_code: 'mental_health',
      created_by_staff_id: session.userId,
      created_at: new Date(),
      updated_at: new Date(),
    });

    await trx('referral_attachments').insert({
      id: referralAttachmentId,
      clinic_id: session.clinicId,
      referral_id: referralId,
      original_filename: 'intake-note.pdf',
      stored_filename: 'wf43-intake-note.pdf',
      mime_type: 'application/pdf',
      file_size_bytes: 1024,
      storage_key: `referrals/${referralId}/intake-note.pdf`,
      category: 'other',
      ocr_status: 'pending',
      created_at: new Date(),
      updated_at: new Date(),
    });
  });
});

afterAll(async () => {
  if (!READY) return;
  await withClinicContext(session.clinicId, async (trx) => {
    await trx('referral_attachments').where({ id: referralAttachmentId }).del().catch(() => undefined);
    await trx('referrals').where({ id: referralId }).del().catch(() => undefined);
    await trx('patient_flags').where({ id: flagId }).del().catch(() => undefined);
    await trx('invoices').where({ id: invoiceId }).del().catch(() => undefined);
    await trx('appointments').where({ id: appointmentId }).del().catch(() => undefined);
    await trx('patients').where({ id: patientId }).del().catch(() => undefined);
  });
});

describe.skipIf(!READY)('BUG-WF43 check-in persistence', () => {
  it('persists check_in_at + checked_in_by_id and increments lock version', async () => {
    const before = await withClinicContext(session.clinicId, async (trx) =>
      trx('appointments').where({ id: appointmentId }).first('status', 'lock_version', 'check_in_at', 'checked_in_by_id'),
    );
    expect(before?.status).toBe('scheduled');
    expect(before?.lock_version).toBe(1);
    expect(before?.check_in_at).toBeNull();
    expect(before?.checked_in_by_id).toBeNull();

    const res = await request(app)
      .post(`/api/v1/appointments/${appointmentId}/check-in`)
      .set(authHeaders(session.token))
      .send({});

    expect(res.status).toBe(200);
    expect(res.body?.id).toBe(appointmentId);
    expect(res.body?.status).toBe('arrived');

    const after = await withClinicContext(session.clinicId, async (trx) =>
      trx('appointments').where({ id: appointmentId }).first('status', 'lock_version', 'check_in_at', 'checked_in_by_id'),
    );
    expect(after?.status).toBe('arrived');
    expect(after?.lock_version).toBe(2);
    expect(after?.checked_in_by_id).toBe(session.userId);
    expect(after?.check_in_at).toBeTruthy();
  });

  it('returns 404 for unknown appointment ids', async () => {
    const res = await request(app)
      .post(`/api/v1/appointments/${randomUUID()}/check-in`)
      .set(authHeaders(session.token))
      .send({});

    expect(res.status).toBe(404);
    expect(res.body?.error).toBe('Appointment not found');
  });

  it('aggregates outstanding invoices/flags/referrals/docs for check-in workflow', async () => {
    const res = await request(app)
      .get(`/api/v1/appointments/${appointmentId}/check-in-outstanding`)
      .set(authHeaders(session.token));

    expect(res.status).toBe(200);
    expect(res.body?.appointmentId).toBe(appointmentId);
    expect(res.body?.patientId).toBe(patientId);
    expect(res.body?.outstanding).toEqual({
      invoices: 1,
      flags: 1,
      referrals: 1,
      documents: 1,
      total: 4,
    });
  });
});
