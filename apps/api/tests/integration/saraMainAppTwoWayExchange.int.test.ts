import { randomUUID } from 'crypto';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import app from '../../src/server';
import { dbAdmin } from '../../src/db/db';
import { isIntegrationReady, loginAsClinician } from './_helpers';
import type { Knex } from 'knex';

const READY = await isIntegrationReady();
const TEST_TAG = `SARA-MAIN-E2E-${Date.now()}`;

type Session = {
  token: string;
  clinicId: string;
  userId: string;
};

let session: Session;
let patientId = '';
let episodeId = '';
let taskId = '';
let medicationId = '';
let contactRecordId = '';
let correspondenceLetterId = '';
let clinicalNoteId = '';
let originalHpii: string | null = null;

function authHeaders(token: string): Record<string, string> {
  return {
    Authorization: `Bearer ${token}`,
    'X-CSRF-Token': 'test',
    'X-Client': 'mobile',
  };
}

async function withClinicContext<T>(fn: (trx: Knex.Transaction) => Promise<T>): Promise<T> {
  return dbAdmin.transaction(async (trx) => {
    await trx.raw("SELECT set_config('app.clinic_id', ?, true)", [session.clinicId]);
    return fn(trx);
  });
}

async function seedPatientAndEpisode(): Promise<void> {
  patientId = randomUUID();
  episodeId = randomUUID();

  await withClinicContext(async (trx) => {
    await trx('patients').insert({
      id: patientId,
      clinic_id: session.clinicId,
      given_name: 'Sara',
      family_name: `${TEST_TAG}-Patient`,
      emr_number: `${TEST_TAG}-MRN`,
      date_of_birth: '1990-01-01',
      created_at: new Date(),
      updated_at: new Date(),
    });

    await trx('episodes').insert({
      id: episodeId,
      clinic_id: session.clinicId,
      patient_id: patientId,
      primary_clinician_id: session.userId,
      episode_type: 'community',
      presenting_problem: `${TEST_TAG} integration fixture`,
      status: 'open',
      start_date: new Date(),
      created_at: new Date(),
      updated_at: new Date(),
    });
  });
}

beforeAll(async () => {
  if (!READY) return;
  session = await loginAsClinician();
  await withClinicContext(async (trx) => {
    const staff = await trx('staff')
      .where({ id: session.userId, clinic_id: session.clinicId })
      .select('hpii')
      .first();
    originalHpii = (staff?.hpii as string | null | undefined) ?? null;
    await trx('staff')
      .where({ id: session.userId, clinic_id: session.clinicId })
      .update({ hpii: '8003611234567893' });
  });
  await seedPatientAndEpisode();
});

afterAll(async () => {
  if (!READY) return;

  await withClinicContext(async (trx) => {
    // Cleanup in FK-safe order.
    if (taskId) {
      await trx('tasks').where({ id: taskId }).del().catch(() => undefined);
    }
    if (contactRecordId) {
      await trx('contact_records').where({ id: contactRecordId }).del().catch(() => undefined);
    }
    if (clinicalNoteId) {
      await trx('clinical_notes').where({ id: clinicalNoteId }).del().catch(() => undefined);
    }
    if (correspondenceLetterId) {
      await trx('correspondence_letters').where({ id: correspondenceLetterId }).del().catch(() => undefined);
    }
    if (medicationId) {
      await trx('patient_medications').where({ id: medicationId }).del().catch(() => undefined);
    }

    if (episodeId) {
      await trx('episodes').where({ id: episodeId }).del().catch(() => undefined);
    }
    if (patientId) {
      await trx('patients').where({ id: patientId }).del().catch(() => undefined);
    }

    await trx('staff')
      .where({ id: session.userId, clinic_id: session.clinicId })
      .update({ hpii: originalHpii })
      .catch(() => undefined);
  });
});

describe.skipIf(!READY)('Sara ↔ Main App two-way exchange parity', () => {
  it('reads seeded episodes on both surfaces', async () => {
    const res = await request(app)
      .get(`/api/v1/episodes/patient/${patientId}`)
      .set(authHeaders(session.token));

    expect(res.status).toBe(200);
    const rows = Array.isArray(res.body?.data) ? res.body.data : [];
    expect(rows.some((row: Record<string, unknown>) => row.id === episodeId)).toBe(true);
  });

  it('round-trips a Sara draft note to main patient notes', async () => {
    const create = await request(app)
      .post('/api/v1/clinical-notes')
      .set(authHeaders(session.token))
      .send({
        patientId,
        episodeId,
        noteType: 'correspondence',
        noteDateTime: new Date().toISOString(),
        content: `${TEST_TAG} note content`,
      });

    expect(create.status).toBe(201);
    clinicalNoteId = String(create.body?.id ?? '');
    expect(clinicalNoteId.length).toBeGreaterThan(0);

    const list = await request(app)
      .get(`/api/v1/clinical-notes/patient/${patientId}`)
      .set(authHeaders(session.token));

    expect(list.status).toBe(200);
    const rows = Array.isArray(list.body) ? list.body : [];
    expect(rows.some((row: Record<string, unknown>) => row.id === clinicalNoteId)).toBe(true);
  });

  it('round-trips tasks between Sara task write and main task lists', async () => {
    const create = await request(app)
      .post('/api/v1/tasks')
      .set(authHeaders(session.token))
      .send({
        patientId,
        episodeId,
        title: `${TEST_TAG} task`,
        priority: 'medium',
      });

    expect(create.status).toBe(201);
    taskId = String(create.body?.id ?? '');
    expect(taskId.length).toBeGreaterThan(0);

    const openTasks = await request(app)
      .get(`/api/v1/tasks?patientId=${patientId}&status=open`)
      .set(authHeaders(session.token));
    expect(openTasks.status).toBe(200);

    const openRows = Array.isArray(openTasks.body) ? openTasks.body : Array.isArray(openTasks.body?.data) ? openTasks.body.data : [];
    expect(openRows.some((row: Record<string, unknown>) => row.id === taskId)).toBe(true);

    const complete = await request(app)
      .patch(`/api/v1/tasks/${taskId}`)
      .set(authHeaders(session.token))
      .send({ status: 'completed' });
    expect(complete.status).toBe(200);
  });

  it('round-trips medications between Sara prescription write and main medication lists', async () => {
    const create = await request(app)
      .post('/api/v1/medications')
      .set(authHeaders(session.token))
      .send({
        patientId,
        episodeId,
        medicationName: 'Lithium carbonate',
        dose: '450mg',
        frequency: 'BD',
      });

    expect(create.status).toBe(201);
    medicationId = String(create.body?.id ?? '');
    expect(medicationId.length).toBeGreaterThan(0);

    const list = await request(app)
      .get(`/api/v1/medications/patients/${patientId}/medications`)
      .set(authHeaders(session.token));

    expect(list.status).toBe(200);
    const rows = Array.isArray(list.body?.data) ? list.body.data : Array.isArray(list.body) ? list.body : [];
    expect(rows.some((row: Record<string, unknown>) => row.id === medicationId)).toBe(true);
  });

  it('round-trips signed contact records between Sara contact write and main unified contacts', async () => {
    const create = await request(app)
      .post('/api/v1/contact-records')
      .set(authHeaders(session.token))
      .send({
        patientId,
        episodeId,
        contactType: 'Phone call',
        status: 'signed',
        briefSummary: `${TEST_TAG} contact`,
      });

    expect(create.status).toBe(201);
    contactRecordId = String(create.body?.id ?? '');
    expect(contactRecordId.length).toBeGreaterThan(0);

    const list = await request(app)
      .get(`/api/v1/contact-records/patient/${patientId}/unified`)
      .set(authHeaders(session.token));

    expect(list.status).toBe(200);
    const rows = Array.isArray(list.body?.contacts) ? list.body.contacts : [];
    expect(rows.some((row: Record<string, unknown>) => row.id === contactRecordId)).toBe(true);
  });

  it('round-trips patient correspondence between Sara message write and main correspondence list', async () => {
    const create = await request(app)
      .post('/api/v1/correspondence/letters')
      .set(authHeaders(session.token))
      .send({
        patientId,
        episodeId,
        recipientName: 'Patient',
        letterType: 'patient_message',
        subject: `${TEST_TAG} message`,
        body: `${TEST_TAG} message body`,
        status: 'sent',
      });

    expect(create.status).toBe(201);
    correspondenceLetterId = String(create.body?.id ?? '');
    expect(correspondenceLetterId.length).toBeGreaterThan(0);

    const list = await request(app)
      .get(`/api/v1/correspondence/patient/${patientId}`)
      .set(authHeaders(session.token));

    expect(list.status).toBe(200);
    const rows = Array.isArray(list.body) ? list.body : [];
    expect(rows.some((row: Record<string, unknown>) => row.id === correspondenceLetterId)).toBe(true);
  });
});
