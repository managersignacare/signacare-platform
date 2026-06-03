import { randomUUID } from 'crypto';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import app from '../../src/server';
import { dbAdmin } from '../../src/db/db';
import { config } from '../../src/config';
import { isIntegrationReady, loginAsClinician } from './_helpers';
import type { Knex } from 'knex';

const READY = await isIntegrationReady();
const TEST_TAG = `VIVA-MAIN-E2E-${Date.now()}`;

type StaffSession = {
  token: string;
  clinicId: string;
  userId: string;
};

let staffSession: StaffSession;
let patientToken = '';
let patientId = '';
let episodeId = '';
let patientAccountId = '';
let appointmentId = '';
let checklistId = '';
let taskId = '';
let patientTrackingEntryId = '';
let clinicianTrackingEntryId = '';
let messageThreadId = '';

function authHeaders(token: string): Record<string, string> {
  return {
    Authorization: `Bearer ${token}`,
    'X-CSRF-Token': 'test',
    'X-Client': 'mobile',
  };
}

async function withClinicContext<T>(fn: (trx: Knex.Transaction) => Promise<T>): Promise<T> {
  return dbAdmin.transaction(async (trx) => {
    await trx.raw("SELECT set_config('app.clinic_id', ?, true)", [staffSession.clinicId]);
    return fn(trx);
  });
}

async function seedPatientFixture(): Promise<void> {
  patientId = randomUUID();
  episodeId = randomUUID();
  patientAccountId = randomUUID();

  await withClinicContext(async (trx) => {
    await trx('patients').insert({
      id: patientId,
      clinic_id: staffSession.clinicId,
      given_name: 'Viva',
      family_name: `${TEST_TAG}-Patient`,
      emr_number: `${TEST_TAG}-MRN`,
      date_of_birth: '1991-01-01',
      created_at: new Date(),
      updated_at: new Date(),
    });

    await trx('episodes').insert({
      id: episodeId,
      clinic_id: staffSession.clinicId,
      patient_id: patientId,
      primary_clinician_id: staffSession.userId,
      episode_type: 'community',
      presenting_problem: `${TEST_TAG} integration fixture`,
      status: 'open',
      start_date: new Date(),
      created_at: new Date(),
      updated_at: new Date(),
    });

    await trx('patient_app_accounts').insert({
      id: patientAccountId,
      clinic_id: staffSession.clinicId,
      patient_id: patientId,
      phone: `+614${Date.now().toString().slice(-8)}`,
      password_hash: await bcrypt.hash('Password1!', 10),
      is_active: true,
      created_at: new Date(),
      updated_at: new Date(),
    });
  });
}

async function mintPatientToken(): Promise<string> {
  const token = jwt.sign(
    {
      id: patientAccountId,
      patientId,
      clinicId: staffSession.clinicId,
      givenName: 'Viva',
      familyName: 'Patient',
      role: 'patient',
      isPatientApp: true,
    },
    config.jwt.accessSecret,
    { expiresIn: '2h' },
  );
  const { primeIdleWindow } = await import('../../src/middleware/sessionIdleMiddleware');
  await primeIdleWindow(patientAccountId, 120);
  return token;
}

beforeAll(async () => {
  if (!READY) return;
  staffSession = await loginAsClinician();
  await seedPatientFixture();
  patientToken = await mintPatientToken();
});

afterAll(async () => {
  if (!READY) return;
  await withClinicContext(async (trx) => {
    if (messageThreadId) {
      await trx('messages').where({ thread_id: messageThreadId, clinic_id: staffSession.clinicId }).del().catch(() => undefined);
      await trx('message_thread_participants').where({ thread_id: messageThreadId }).del().catch(() => undefined);
      await trx('message_threads').where({ id: messageThreadId, clinic_id: staffSession.clinicId }).del().catch(() => undefined);
    } else if (patientId) {
      const threadRows = await trx('message_threads')
        .where({ clinic_id: staffSession.clinicId, patient_id: patientId })
        .select('id');
      const threadIds = threadRows.map((row: { id: string }) => row.id);
      if (threadIds.length > 0) {
        await trx('messages').whereIn('thread_id', threadIds).del().catch(() => undefined);
        await trx('message_thread_participants').whereIn('thread_id', threadIds).del().catch(() => undefined);
        await trx('message_threads').whereIn('id', threadIds).del().catch(() => undefined);
      }
    }
    if (checklistId) {
      await trx('appointment_checklists').where({ id: checklistId }).del().catch(() => undefined);
    }
    if (taskId) {
      await trx('patient_tasks').where({ id: taskId }).del().catch(() => undefined);
    }
    if (patientTrackingEntryId) {
      await trx('patient_tracking').where({ id: patientTrackingEntryId }).del().catch(() => undefined);
    }
    if (clinicianTrackingEntryId) {
      await trx('patient_tracking').where({ id: clinicianTrackingEntryId }).del().catch(() => undefined);
    }
    if (appointmentId) {
      await trx('appointments').where({ id: appointmentId }).del().catch(() => undefined);
    }
    if (patientAccountId) {
      await trx('patient_app_accounts').where({ id: patientAccountId }).del().catch(() => undefined);
    }
    if (episodeId) {
      await trx('episodes').where({ id: episodeId }).del().catch(() => undefined);
    }
    if (patientId) {
      await trx('patients').where({ id: patientId }).del().catch(() => undefined);
    }
  });
});

describe.skipIf(!READY)('Viva ↔ Main App two-way exchange parity', () => {
  it('Viva read-only endpoint set is callable with patient-app auth (no role/module hard fail)', async () => {
    const probes: Array<{ method: 'get'; path: string; ok: number[] }> = [
      { method: 'get', path: `/api/v1/patient-app/legal-orders/${patientId}`, ok: [200] },
      { method: 'get', path: `/api/v1/patient-app/pathology/${patientId}`, ok: [200] },
      { method: 'get', path: `/api/v1/patient-app/attachments/${patientId}`, ok: [200] },
      { method: 'get', path: `/api/v1/patient-app/shared-docs/${patientId}`, ok: [200] },
      { method: 'get', path: `/api/v1/patient-app/medications/${patientId}`, ok: [200] },
      { method: 'get', path: `/api/v1/patient-app/assessments/${patientId}`, ok: [200] },
      { method: 'get', path: `/api/v1/patient-app/tasks/${patientId}`, ok: [200] },
      { method: 'get', path: `/api/v1/patient-app/checklists/${patientId}`, ok: [200] },
      { method: 'get', path: `/api/v1/patient-app/triage/${patientId}`, ok: [200] },
      { method: 'get', path: `/api/v1/patient-app/interventions/${patientId}`, ok: [200, 404] },
      { method: 'get', path: `/api/v1/patient-app/wearables/${patientId}/sources`, ok: [200, 404] },
      { method: 'get', path: `/api/v1/patient-app/wearables/${patientId}/phenotypes?limit=14`, ok: [200, 404] },
      { method: 'get', path: `/api/v1/patient-app/wearables/${patientId}/surveillance`, ok: [200, 404] },
      { method: 'get', path: '/api/v1/patient-app/sync-preferences', ok: [200] },
      { method: 'get', path: '/api/v1/patient-app/messages/inbox', ok: [200] },
    ];

    for (const probe of probes) {
      const res = await request(app)[probe.method](probe.path).set(authHeaders(patientToken));
      expect(probe.ok).toContain(res.status);
    }
  });

  it('Viva episode feed and allocation are readable for the authenticated patient', async () => {
    const episodes = await request(app)
      .get(`/api/v1/patient-app/episodes/${patientId}`)
      .set(authHeaders(patientToken));
    expect(episodes.status).toBe(200);

    const rows = Array.isArray(episodes.body?.data) ? episodes.body.data : [];
    const openEpisode = rows.find((row: Record<string, unknown>) => row.id === episodeId);
    expect(openEpisode).toBeTruthy();
    expect(openEpisode?.status).toBe('open');

    const allocation = await request(app)
      .get(`/api/v1/patient-app/episodes/${episodeId}/allocation`)
      .set(authHeaders(patientToken));
    expect(allocation.status).toBe(200);
    expect(allocation.body?.episodeId).toBe(episodeId);
  });

  it('main-app appointment write is visible to Viva appointments feed', async () => {
    const start = new Date();
    start.setUTCDate(start.getUTCDate() + 2);
    start.setUTCHours(2, 0, 0, 0);
    const end = new Date(start.getTime() + 30 * 60 * 1000);

    const create = await request(app)
      .post('/api/v1/appointments')
      .set(authHeaders(staffSession.token))
      .send({
        patientId,
        clinicianId: staffSession.userId,
        startTime: start.toISOString(),
        endTime: end.toISOString(),
        type: 'follow_up',
        notes: `${TEST_TAG} appointment`,
      });

    expect(create.status).toBe(201);
    appointmentId = String(create.body?.id ?? '');
    expect(appointmentId.length).toBeGreaterThan(0);

    const list = await request(app)
      .get('/api/v1/patient-app/appointments')
      .query({ patientId, limit: 20 })
      .set(authHeaders(patientToken));

    expect(list.status).toBe(200);
    const rows = Array.isArray(list.body?.appointments) ? list.body.appointments : [];
    const match = rows.find((row: Record<string, unknown>) => row.id === appointmentId);
    expect(match).toBeTruthy();
    expect(match?.patientResponse ?? null).toBeNull();
  });

  it('Viva appointment response write is visible to main appointment list', async () => {
    expect(appointmentId.length).toBeGreaterThan(0);

    const respond = await request(app)
      .patch(`/api/v1/patient-app/appointment-response/${appointmentId}`)
      .set(authHeaders(patientToken))
      .send({ response: 'not_attending' });

    expect(respond.status).toBe(200);

    const list = await request(app)
      .get('/api/v1/appointments')
      .query({ patientId, limit: 20 })
      .set(authHeaders(staffSession.token));

    expect(list.status).toBe(200);
    const rows = Array.isArray(list.body) ? list.body : [];
    const match = rows.find((row: Record<string, unknown>) => row.id === appointmentId);
    expect(match).toBeTruthy();
    expect(match?.patientResponse).toBe('not_attending');
  });

  it('main-app messaging write is visible in Viva and Viva reply is visible in main app inbox', async () => {
    const staffSend = await request(app)
      .post('/api/v1/patient-app/messages')
      .set(authHeaders(staffSession.token))
      .send({
        patientId,
        subject: `${TEST_TAG} message thread`,
        body: `${TEST_TAG} clinician message`,
      });
    expect(staffSend.status).toBe(201);
    messageThreadId = String(staffSend.body?.threadId ?? '');
    expect(messageThreadId.length).toBeGreaterThan(0);

    const patientInbox = await request(app)
      .get('/api/v1/patient-app/messages/inbox')
      .set(authHeaders(patientToken));
    expect(patientInbox.status).toBe(200);
    const patientRows = Array.isArray(patientInbox.body?.messages) ? patientInbox.body.messages : [];
    expect(
      patientRows.some(
        (row: Record<string, unknown>) => String(row.body ?? '').includes(`${TEST_TAG} clinician message`),
      ),
    ).toBe(true);

    const patientReply = await request(app)
      .post(`/api/v1/patient-app/messages/threads/${messageThreadId}/messages`)
      .set(authHeaders(patientToken))
      .send({
        body: `${TEST_TAG} patient reply`,
      });
    expect(patientReply.status).toBe(201);

    const staffInbox = await request(app)
      .get('/api/v1/patient-app/messages/inbox')
      .query({ patientId })
      .set(authHeaders(staffSession.token));
    expect(staffInbox.status).toBe(200);
    const staffRows = Array.isArray(staffInbox.body?.messages) ? staffInbox.body.messages : [];
    expect(
      staffRows.some(
        (row: Record<string, unknown>) =>
          String(row.body ?? '').includes(`${TEST_TAG} patient reply`) &&
          row.authoredByPatient === true,
      ),
    ).toBe(true);
  });

  it('Viva tracking write is visible to clinician and clinician tracking write is visible to Viva', async () => {
    const patientWrite = await request(app)
      .post('/api/v1/patient-app/tracking')
      .set(authHeaders(patientToken))
      .send({
        entries: [{ type: 'mood', value: 3, note: `${TEST_TAG} patient mood` }],
      });
    expect(patientWrite.status).toBe(201);

    const clinicianRead = await request(app)
      .get(`/api/v1/patient-app/tracking/${patientId}`)
      .query({ type: 'mood', days: 7 })
      .set(authHeaders(staffSession.token));
    expect(clinicianRead.status).toBe(200);

    const clinicianRows = Array.isArray(clinicianRead.body?.entries)
      ? clinicianRead.body.entries
      : [];
    const patientEntry = clinicianRows.find(
      (row: Record<string, unknown>) => String(row.note ?? '').includes(`${TEST_TAG} patient mood`),
    ) as Record<string, unknown> | undefined;
    expect(patientEntry).toBeTruthy();
    expect(patientEntry?.source).toBe('patient_app');
    patientTrackingEntryId = String(patientEntry?.id ?? '');

    const clinicianWrite = await request(app)
      .post('/api/v1/patient-app/tracking')
      .set(authHeaders(staffSession.token))
      .send({
        patientId,
        entries: [{ type: 'mood', value: 4, note: `${TEST_TAG} clinician mood` }],
      });
    expect(clinicianWrite.status).toBe(201);

    const patientRead = await request(app)
      .get(`/api/v1/patient-app/tracking/${patientId}`)
      .query({ type: 'mood', days: 7 })
      .set(authHeaders(patientToken));
    expect(patientRead.status).toBe(200);

    const patientRows = Array.isArray(patientRead.body?.entries)
      ? patientRead.body.entries
      : [];
    const clinicianEntry = patientRows.find(
      (row: Record<string, unknown>) => String(row.note ?? '').includes(`${TEST_TAG} clinician mood`),
    ) as Record<string, unknown> | undefined;
    expect(clinicianEntry).toBeTruthy();
    expect(clinicianEntry?.source).toBe('clinician');
    clinicianTrackingEntryId = String(clinicianEntry?.id ?? '');
  });

  it('main-app checklist/task writes are visible in Viva and Viva completion is visible back to main app', async () => {
    expect(appointmentId.length).toBeGreaterThan(0);

    const checklistCreate = await request(app)
      .post(`/api/v1/patient-app/checklists/${patientId}`)
      .set(authHeaders(staffSession.token))
      .send({
        item: `${TEST_TAG} bring medication list`,
        appointmentId,
      });
    expect(checklistCreate.status).toBe(201);
    checklistId = String(checklistCreate.body?.checklist?.id ?? '');
    expect(checklistId.length).toBeGreaterThan(0);

    const checklistReadPatient = await request(app)
      .get(`/api/v1/patient-app/checklists/${patientId}`)
      .query({ appointmentId })
      .set(authHeaders(patientToken));
    expect(checklistReadPatient.status).toBe(200);
    const checklistRows = Array.isArray(checklistReadPatient.body?.checklists)
      ? checklistReadPatient.body.checklists
      : [];
    expect(checklistRows.some((row: Record<string, unknown>) => row.id === checklistId)).toBe(true);

    const checklistComplete = await request(app)
      .patch(`/api/v1/patient-app/checklists/${patientId}/${checklistId}`)
      .set(authHeaders(patientToken))
      .send({ isCompleted: true });
    expect(checklistComplete.status).toBe(200);

    const checklistReadStaff = await request(app)
      .get(`/api/v1/patient-app/checklists/${patientId}`)
      .query({ appointmentId })
      .set(authHeaders(staffSession.token));
    expect(checklistReadStaff.status).toBe(200);
    const checklistRowsStaff = Array.isArray(checklistReadStaff.body?.checklists)
      ? checklistReadStaff.body.checklists
      : [];
    const completedChecklist = checklistRowsStaff.find((row: Record<string, unknown>) => row.id === checklistId);
    expect(completedChecklist?.is_completed ?? completedChecklist?.isCompleted).toBe(true);

    const taskCreate = await request(app)
      .post(`/api/v1/patient-app/tasks/${patientId}`)
      .set(authHeaders(staffSession.token))
      .send({
        title: `${TEST_TAG} complete wellbeing check-in`,
        dueDate: new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString(),
      });
    expect(taskCreate.status).toBe(201);
    taskId = String(taskCreate.body?.task?.id ?? '');
    expect(taskId.length).toBeGreaterThan(0);

    const taskReadPatient = await request(app)
      .get(`/api/v1/patient-app/tasks/${patientId}`)
      .set(authHeaders(patientToken));
    expect(taskReadPatient.status).toBe(200);
    const taskRowsPatient = Array.isArray(taskReadPatient.body?.tasks)
      ? taskReadPatient.body.tasks
      : [];
    expect(taskRowsPatient.some((row: Record<string, unknown>) => row.id === taskId)).toBe(true);

    const taskComplete = await request(app)
      .patch(`/api/v1/patient-app/tasks/${patientId}/${taskId}`)
      .set(authHeaders(patientToken))
      .send({ status: 'completed' });
    expect(taskComplete.status).toBe(200);

    const taskReadStaff = await request(app)
      .get(`/api/v1/patient-app/tasks/${patientId}`)
      .set(authHeaders(staffSession.token));
    expect(taskReadStaff.status).toBe(200);
    const taskRowsStaff = Array.isArray(taskReadStaff.body?.tasks)
      ? taskReadStaff.body.tasks
      : [];
    const completedTask = taskRowsStaff.find((row: Record<string, unknown>) => row.id === taskId);
    expect(completedTask?.status).toBe('completed');
  });
});
