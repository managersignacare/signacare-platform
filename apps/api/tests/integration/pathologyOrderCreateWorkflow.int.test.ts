import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { authedAgent, isIntegrationReady, loginAsClinician } from './_helpers';

const READY = await isIntegrationReady();
const RUN_TAG = `PATH_REQ_${process.pid}_${Date.now().toString(36)}`;

describe.skipIf(!READY)('Pathology order create workflow', () => {
  let token = '';
  let clinicId = '';
  let patientId = '';
  let episodeId = '';
  let orderId = '';
  let noteId = '';

  beforeAll(async () => {
    const session = await loginAsClinician();
    token = session.token;
    clinicId = session.clinicId;
  });

  afterAll(async () => {
    const { dbAdmin } = await import('../../src/db/db');

    if (noteId) {
      await dbAdmin('contact_records')
        .where({ clinic_id: clinicId, patient_id: patientId })
        .whereRaw("content IS NOT NULL AND content != '' AND content::jsonb->>'sourceId' = ?", [noteId])
        .delete()
        .catch(() => undefined);
      await dbAdmin('clinical_notes')
        .where({ id: noteId })
        .delete()
        .catch(() => undefined);
    }

    if (orderId) {
      await dbAdmin('pathology_orders')
        .where({ id: orderId })
        .delete()
        .catch(() => undefined);
    }

    if (episodeId) {
      await dbAdmin('episodes')
        .where({ id: episodeId })
        .delete()
        .catch(() => undefined);
    }

    if (patientId) {
      await dbAdmin('patient_team_assignments')
        .where({ patient_id: patientId })
        .delete()
        .catch(() => undefined);
      await dbAdmin('patients')
        .where({ id: patientId })
        .delete()
        .catch(() => undefined);
    }
  });

  it('creates pathology order without 500 and links it to episode timeline + contact record', async () => {
    const agent = authedAgent(token);

    const createPatientRes = await agent.post('/api/v1/patients').send({
      givenName: 'Pathology',
      familyName: RUN_TAG,
      dateOfBirth: '1993-03-18',
    });
    expect(createPatientRes.status).toBe(201);
    patientId = String(createPatientRes.body?.id ?? '');
    expect(patientId).toMatch(/^[0-9a-f-]{36}$/i);

    const createEpisodeRes = await agent.post('/api/v1/episodes').send({
      patientId,
      title: `Community episode ${RUN_TAG}`,
      episodeType: 'community',
      startDate: '2026-05-31',
    });
    expect(createEpisodeRes.status).toBe(201);
    episodeId = String(createEpisodeRes.body?.id ?? '');
    expect(episodeId).toMatch(/^[0-9a-f-]{36}$/i);

    const orderPayload = {
      patientId,
      panelName: 'Metabolic Monitoring Panel',
      tests: ['Full Blood Count (FBC)', 'Urea, Electrolytes & Creatinine (UEC)'],
      urgency: 'routine',
      fasting: true,
      copyToGp: false,
      clinicalNotes: 'Baseline metabolic screen for medication monitoring.',
    };
    const createOrderRes = await agent
      .post('/api/v1/pathology/orders')
      .send(orderPayload);

    expect(createOrderRes.status).toBe(201);
    expect(createOrderRes.body?.orderNumber).toMatch(/^PATH-\d{8}-/);
    expect(createOrderRes.body?.patientId).toBe(patientId);
    expect(createOrderRes.body?.episodeId).toBe(episodeId);
    expect(createOrderRes.body?.tests).toEqual(orderPayload.tests);
    orderId = String(createOrderRes.body?.id ?? '');
    expect(orderId).toMatch(/^[0-9a-f-]{36}$/i);

    const { dbAdmin } = await import('../../src/db/db');
    const insertedOrder = await dbAdmin('pathology_orders')
      .where({ id: orderId, clinic_id: clinicId })
      .first();
    expect(insertedOrder).toBeTruthy();
    expect(insertedOrder.episode_id).toBe(episodeId);
    expect(insertedOrder.tests).toEqual(orderPayload.tests);

    const timelineNote = await dbAdmin('clinical_notes')
      .where({
        clinic_id: clinicId,
        patient_id: patientId,
        episode_id: episodeId,
        note_type: 'correspondence',
      })
      .where('title', 'like', 'Pathology request PATH-%')
      .orderBy('created_at', 'desc')
      .first();
    expect(timelineNote).toBeTruthy();
    noteId = String(timelineNote.id);
    expect(timelineNote.status).toBe('signed');
    expect(String(timelineNote.content ?? '')).toContain('Pathology request created');

    const contactRecord = await dbAdmin('contact_records')
      .where({ clinic_id: clinicId, patient_id: patientId, episode_id: episodeId })
      .whereRaw("content IS NOT NULL AND content != '' AND content::jsonb->>'sourceId' = ?", [noteId])
      .first();
    expect(contactRecord).toBeTruthy();
  });
});

