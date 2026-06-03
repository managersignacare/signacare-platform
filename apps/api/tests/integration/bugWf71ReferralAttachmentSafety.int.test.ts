import { randomUUID } from 'crypto';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import app from '../../src/server';
import { dbAdmin } from '../../src/db/db';
import { isIntegrationReady, loginAsAdmin } from './_helpers';

const READY = await isIntegrationReady();
const TEST_TAG = `WF71-UPLOAD-${Date.now().toString(36)}`;

type Session = {
  token: string;
  clinicId: string;
  userId: string;
};

let session: Session;
let seededPatientId = '';
let seededEpisodeId = '';
let seededReferralId = '';
let previousAvMode: string | undefined;

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
  previousAvMode = process.env.REFERRAL_UPLOAD_ANTIVIRUS_MODE;
  process.env.REFERRAL_UPLOAD_ANTIVIRUS_MODE = 'off';

  seededPatientId = randomUUID();
  seededEpisodeId = randomUUID();
  seededReferralId = randomUUID();

  await withClinicContext(session.clinicId, async (trx) => {
    await trx('patients').insert({
      id: seededPatientId,
      clinic_id: session.clinicId,
      given_name: 'Upload',
      family_name: `Safety-${TEST_TAG}`,
      emr_number: `${TEST_TAG}-P`,
      date_of_birth: '1992-06-10',
      created_at: new Date(),
      updated_at: new Date(),
    });

    await trx('episodes').insert({
      id: seededEpisodeId,
      clinic_id: session.clinicId,
      patient_id: seededPatientId,
      primary_clinician_id: session.userId,
      episode_type: 'intake',
      status: 'open',
      start_date: new Date(),
      presenting_problem: `WF71 upload safety ${TEST_TAG}`,
      created_at: new Date(),
      updated_at: new Date(),
    });

    await trx('referrals').insert({
      id: seededReferralId,
      clinic_id: session.clinicId,
      patient_id: seededPatientId,
      linked_episode_id: seededEpisodeId,
      referral_number: `${TEST_TAG}-R`,
      referral_date: '2026-05-24',
      source: 'gp',
      from_service: 'WF71 upload safety',
      reason: 'Attachment safety regression test',
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
});

afterAll(async () => {
  if (!READY) return;
  process.env.REFERRAL_UPLOAD_ANTIVIRUS_MODE = previousAvMode;

  await withClinicContext(session.clinicId, async (trx) => {
    await trx('referral_attachments').where({ referral_id: seededReferralId }).del().catch(() => undefined);
    await trx('referrals').where({ id: seededReferralId }).del().catch(() => undefined);
    await trx('episodes').where({ id: seededEpisodeId }).del().catch(() => undefined);
    await trx('patients').where({ id: seededPatientId }).del().catch(() => undefined);
  });
});

describe.skipIf(!READY)('BUG-WF71 referral attachment safety', () => {
  it('rejects attachments with non-allowlisted MIME types', async () => {
    const res = await request(app)
      .post(`/api/v1/referrals/${seededReferralId}/attachments`)
      .set(authHeaders(session.token))
      .attach('file', Buffer.from('MZ fake-exe'), {
        filename: 'payload.exe',
        contentType: 'application/x-msdownload',
      });

    expect(res.status).toBe(422);
    expect(res.body?.code).toBe('REFERRAL_ATTACHMENT_MIME_NOT_ALLOWED');
  });

  it('rejects MIME/signature mismatch on declared PDF files', async () => {
    const jpegHeader = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);
    const res = await request(app)
      .post(`/api/v1/referrals/${seededReferralId}/attachments`)
      .set(authHeaders(session.token))
      .attach('file', jpegHeader, {
        filename: 'note.pdf',
        contentType: 'application/pdf',
      });

    expect(res.status).toBe(422);
    expect(res.body?.code).toBe('REFERRAL_ATTACHMENT_SIGNATURE_MISMATCH');
  });
});

