import { randomUUID } from 'crypto';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import app from '../../src/server';
import { dbAdmin } from '../../src/db/db';
import { isIntegrationReady, loginAsAdmin } from './_helpers';
import { withTenantContext } from '../../src/shared/tenantContext';

const READY = await isIntegrationReady();
const TEST_TAG = `BUG-417-${Date.now()}`;

let session: { token: string; clinicId: string; userId: string };
let patientId = '';
let episodeId = '';
let consentId = '';

beforeAll(async () => {
  if (!READY) return;
  session = await loginAsAdmin();
  patientId = randomUUID();
  episodeId = randomUUID();

  await withTenantContext(session.clinicId, async () => {
    await dbAdmin('patients').insert({
      id: patientId,
      clinic_id: session.clinicId,
      given_name: 'Bug417',
      family_name: TEST_TAG,
      emr_number: TEST_TAG,
      date_of_birth: '1991-02-03',
      created_at: new Date(),
      updated_at: new Date(),
    });

    await dbAdmin('episodes').insert({
      id: episodeId,
      clinic_id: session.clinicId,
      patient_id: patientId,
      episode_type: 'triage',
      presenting_problem: TEST_TAG,
      status: 'open',
      start_date: new Date(),
      created_at: new Date(),
      updated_at: new Date(),
    });

    consentId = randomUUID();
    await dbAdmin('scribe_consents').insert({
      id: consentId,
      clinic_id: session.clinicId,
      patient_id: patientId,
      mode: 'clinician_attestation',
      clinician_attested_by_id: session.userId,
      clinician_attestation_text: `${TEST_TAG} consent`,
      attested_at: new Date(),
      created_at: new Date(),
    });
  });
});

afterAll(async () => {
  if (!READY) return;
  await withTenantContext(session.clinicId, async () => {
    await dbAdmin('clinical_note_versions').whereRaw('snapshot::text ILIKE ?', [`%${TEST_TAG}%`]).del();
    await dbAdmin('clinical_notes').where({ clinic_id: session.clinicId, patient_id: patientId }).del();
    if (consentId) {
      await dbAdmin('scribe_consents').where({ id: consentId }).del();
    }
    await dbAdmin('episodes').where({ id: episodeId }).del();
    await dbAdmin('patients').where({ id: patientId }).del();
  });
});

async function createAiDraftClinicalNote(): Promise<string> {
  const res = await request(app)
    .post('/api/v1/clinical-notes')
    .set('Authorization', `Bearer ${session.token}`)
    .set('X-Client', 'mobile')
    .send({
      patientId,
      episodeId,
      noteType: 'soap',
      noteDateTime: new Date().toISOString(),
      content: `${TEST_TAG} draft clinical note`,
      soapAssessment: `${TEST_TAG} assessment`,
      isAiDraft: true,
      consentId,
    });

  if (res.status !== 201) {
    throw new Error(`Failed to create clinical note (${res.status}): ${JSON.stringify(res.body)}`);
  }
  return String(res.body.id);
}

describe.skipIf(!READY)('BUG-417 — AI draft sign attestation', () => {
  it('blocks /clinical-notes/:id/sign when reviewedAndAdopted is missing', async () => {
    const noteId = await createAiDraftClinicalNote();

    const blocked = await request(app)
      .post(`/api/v1/clinical-notes/${noteId}/sign`)
      .set('Authorization', `Bearer ${session.token}`)
      .set('X-Client', 'mobile')
      .send({});

    expect(blocked.status).toBe(409);
    expect(blocked.body.code).toBe('REVIEW_AND_ADOPT_REQUIRED');

    const allowed = await request(app)
      .post(`/api/v1/clinical-notes/${noteId}/sign`)
      .set('Authorization', `Bearer ${session.token}`)
      .set('X-Client', 'mobile')
      .send({ reviewedAndAdopted: true });

    expect(allowed.status).toBe(200);
    expect(allowed.body.status).toBe('signed');

    const dbRow = await withTenantContext(session.clinicId, async () =>
      dbAdmin('clinical_notes')
        .where({ id: noteId, clinic_id: session.clinicId })
        .select(
          'reviewed_and_adopted_by_id',
          'reviewed_and_adopted_at',
          'signed_content_hash',
          'signed_content_hash_alg',
        )
        .first(),
    );
    expect(dbRow?.reviewed_and_adopted_by_id).toBe(session.userId);
    expect(dbRow?.reviewed_and_adopted_at).toBeTruthy();
    expect(typeof dbRow?.signed_content_hash).toBe('string');
    expect(dbRow?.signed_content_hash).toHaveLength(64);
    expect(dbRow?.signed_content_hash_alg).toBe('sha256');

    await expect(
      withTenantContext(session.clinicId, async () =>
        dbAdmin('clinical_notes')
          .where({ id: noteId, clinic_id: session.clinicId })
          .update({ content: `${TEST_TAG} tampered signed content` }),
      ),
    ).rejects.toThrow(/immutable once signed/i);
  });

  it('blocks /patients/:id/notes signed AI draft create without reviewedAndAdopted', async () => {
    const blocked = await request(app)
      .post(`/api/v1/patients/${patientId}/notes`)
      .set('Authorization', `Bearer ${session.token}`)
      .set('X-Client', 'mobile')
      .send({
        episodeId,
        title: `${TEST_TAG} inline blocked`,
        noteType: 'soap',
        content: `${TEST_TAG} inline blocked`,
        status: 'signed',
        isAiDraft: true,
        consentId,
      });

    expect(blocked.status).toBe(409);
    expect(blocked.body.code).toBe('REVIEW_AND_ADOPT_REQUIRED');

    const allowed = await request(app)
      .post(`/api/v1/patients/${patientId}/notes`)
      .set('Authorization', `Bearer ${session.token}`)
      .set('X-Client', 'mobile')
      .send({
        episodeId,
        title: `${TEST_TAG} inline allowed`,
        noteType: 'soap',
        content: `${TEST_TAG} inline allowed`,
        status: 'signed',
        isAiDraft: true,
        reviewedAndAdopted: true,
        consentId,
      });

    expect(allowed.status).toBe(201);
    expect(allowed.body.note?.status).toBe('signed');
    expect(allowed.body.note?.isAiDraft).toBe(true);

    const noteId = String(allowed.body.note?.id);
    const dbRow = await withTenantContext(session.clinicId, async () =>
      dbAdmin('clinical_notes')
        .where({ id: noteId, clinic_id: session.clinicId })
        .select(
          'reviewed_and_adopted_by_id',
          'reviewed_and_adopted_at',
          'signed_content_hash',
          'signed_content_hash_alg',
        )
        .first(),
    );
    expect(dbRow?.reviewed_and_adopted_by_id).toBe(session.userId);
    expect(dbRow?.reviewed_and_adopted_at).toBeTruthy();
    expect(typeof dbRow?.signed_content_hash).toBe('string');
    expect(dbRow?.signed_content_hash).toHaveLength(64);
    expect(dbRow?.signed_content_hash_alg).toBe('sha256');
  });
});
