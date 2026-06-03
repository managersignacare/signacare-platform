import { randomUUID } from 'crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import app from '../../src/server';
import { db, dbAdmin } from '../../src/db/db';
import { isIntegrationReady, loginAsAdmin } from './_helpers';
import { withTenantContext } from '../../src/shared/tenantContext';

const READY = await isIntegrationReady();

let session: { token: string; clinicId: string; userId: string };
let foreignClinicId = '';
let createdForeignClinic = false;
let foreignPatientId = '';
let foreignEpisodeId = '';
let localPatientId = '';
let localEpisodeId = '';

beforeAll(async () => {
  if (!READY) return;
  session = await loginAsAdmin();

  const existingOtherClinic = await dbAdmin('clinics')
    .whereNot({ id: session.clinicId })
    .first('id');

  if (existingOtherClinic?.id) {
    foreignClinicId = String(existingOtherClinic.id);
  } else {
    foreignClinicId = randomUUID();
    createdForeignClinic = true;
    await dbAdmin('clinics').insert({
      id: foreignClinicId,
      name: `BUG-EP-CLINIC-SCOPE-${Date.now()}`,
      hpio: `800362${Date.now().toString().slice(-7)}`,
      created_at: new Date(),
      updated_at: new Date(),
    });
  }

  foreignPatientId = randomUUID();
  foreignEpisodeId = randomUUID();

  await withTenantContext(foreignClinicId, async () => {
    await db('patients').insert({
      id: foreignPatientId,
      clinic_id: foreignClinicId,
      given_name: 'Cross',
      family_name: `Tenant-${Date.now()}`,
      emr_number: `EP-XSCOPE-${Date.now()}`,
      date_of_birth: '1991-01-01',
      created_at: new Date(),
      updated_at: new Date(),
    });

    await db('episodes').insert({
      id: foreignEpisodeId,
      clinic_id: foreignClinicId,
      patient_id: foreignPatientId,
      primary_clinician_id: session.userId,
      episode_type: 'intake',
      presenting_problem: 'Cross-tenant discharge scope regression test',
      status: 'open',
      start_date: new Date(),
      created_at: new Date(),
      updated_at: new Date(),
    });
  });

  localPatientId = randomUUID();
  localEpisodeId = randomUUID();
  await withTenantContext(session.clinicId, async () => {
    await db('patients').insert({
      id: localPatientId,
      clinic_id: session.clinicId,
      given_name: 'Local',
      family_name: `Tenant-${Date.now()}`,
      emr_number: `EP-LOCAL-${Date.now()}`,
      date_of_birth: '1992-02-02',
      created_at: new Date(),
      updated_at: new Date(),
    });
    await db('episodes').insert({
      id: localEpisodeId,
      clinic_id: session.clinicId,
      patient_id: localPatientId,
      primary_clinician_id: session.userId,
      episode_type: 'intake',
      presenting_problem: 'In-clinic discharge summary submission path',
      status: 'open',
      start_date: new Date(),
      created_at: new Date(),
      updated_at: new Date(),
    });
  });
});

afterAll(async () => {
  if (!READY) return;
  if (foreignEpisodeId) {
    await withTenantContext(foreignClinicId, async () => {
      await db('tasks')
        .where({ task_type: 'discharge_review' })
        .andWhere('description', 'like', `%${foreignEpisodeId}%`)
        .del();
      await db('episodes').where({ id: foreignEpisodeId }).del();
    }).catch(() => undefined);
  }
  if (localEpisodeId) {
    await withTenantContext(session.clinicId, async () => {
      await db('tasks')
        .where({ clinic_id: session.clinicId, task_type: 'discharge_review' })
        .andWhere('description', 'like', `%${localEpisodeId}%`)
        .del();
      await db('episodes').where({ id: localEpisodeId }).del();
    }).catch(() => undefined);
  }
  if (localPatientId) {
    await withTenantContext(session.clinicId, async () => {
      await db('patients').where({ id: localPatientId }).del();
    }).catch(() => undefined);
  }
  if (foreignPatientId) {
    await withTenantContext(foreignClinicId, async () => {
      await db('patients').where({ id: foreignPatientId }).del();
    }).catch(() => undefined);
  }
  if (createdForeignClinic) {
    await dbAdmin('clinics').where({ id: foreignClinicId }).del().catch(() => undefined);
  }
});

describe.skipIf(!READY)('Episode discharge summary routes are clinic-scoped', () => {
  it('creates a discharge-review task for in-clinic submissions', async () => {
    const beforeTasks = await dbAdmin('tasks')
      .where({ clinic_id: session.clinicId, task_type: 'discharge_review' })
      .andWhere('description', 'like', `%${localEpisodeId}%`)
      .count<{ count: string }[]>({ count: '*' });

    const res = await request(app)
      .post(`/api/v1/episodes/${localEpisodeId}/discharge-summary/submit`)
      .set('Authorization', `Bearer ${session.token}`)
      .set('X-CSRF-Token', 'test')
      .set('X-Client', 'mobile')
      .send({
        content: 'in-clinic submission',
        consultantId: session.userId,
      });

    expect(res.status).toBe(200);
    expect(res.body?.ok).toBe(true);

    const rows = await dbAdmin('tasks')
      .where({ clinic_id: session.clinicId, task_type: 'discharge_review' })
      .andWhere('description', 'like', `%${localEpisodeId}%`)
      .orderBy('created_at', 'asc')
      .select('assigned_to_id', 'assigned_by_id', 'patient_id', 'episode_id', 'status');

    expect(rows.length).toBe(Number(beforeTasks[0]?.count ?? 0) + 1);
    const created = rows.at(-1);
    expect(created?.assigned_to_id).toBe(session.userId);
    expect(created?.assigned_by_id).toBe(session.userId);
    expect(created?.patient_id).toBe(localPatientId);
    expect(created?.episode_id).toBe(localEpisodeId);
    expect(created?.status).toBe('pending');
  });

  it('rejects cross-tenant discharge-summary submit and does not create tasks', async () => {
    const beforeTasks = await dbAdmin('tasks')
      .where({ clinic_id: session.clinicId, task_type: 'discharge_review' })
      .andWhere('description', 'like', `%${foreignEpisodeId}%`)
      .count<{ count: string }[]>({ count: '*' });

    const res = await request(app)
      .post(`/api/v1/episodes/${foreignEpisodeId}/discharge-summary/submit`)
      .set('Authorization', `Bearer ${session.token}`)
      .set('X-CSRF-Token', 'test')
      .set('X-Client', 'mobile')
      .send({
        content: 'cross-tenant attempt',
        consultantId: session.userId,
      });

    expect(res.status).toBe(404);
    expect(res.body?.error).toBe('Episode not found');

    const afterTasks = await dbAdmin('tasks')
      .where({ clinic_id: session.clinicId, task_type: 'discharge_review' })
      .andWhere('description', 'like', `%${foreignEpisodeId}%`)
      .count<{ count: string }[]>({ count: '*' });

    const beforeCount = Number(beforeTasks[0]?.count ?? 0);
    const afterCount = Number(afterTasks[0]?.count ?? 0);
    expect(afterCount).toBe(beforeCount);
  });
});
