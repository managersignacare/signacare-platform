import { randomUUID } from 'crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import app from '../../src/server';
import { dbAdmin } from '../../src/db/db';
import { isIntegrationReady, loginAsAdmin } from './_helpers';

const READY = await isIntegrationReady();

describe.skipIf(!READY)('Pathway digital interventions (CBT/DBT homework, thought diary, sleep journey)', () => {
  let session: Awaited<ReturnType<typeof loginAsAdmin>>;
  let patientId = '';
  let pathwayId = '';

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
    session = await loginAsAdmin();
    patientId = randomUUID();
    await withClinicContext(session.clinicId, async (trx) => {
      await trx('patients').insert({
        id: patientId,
        clinic_id: session.clinicId,
        given_name: 'Digital',
        family_name: `Pathway-${Date.now()}`,
        emr_number: `DIPW-${Date.now()}`,
        date_of_birth: '1992-03-12',
        created_at: new Date(),
        updated_at: new Date(),
      });
    });

    const pathwayCreate = await request(app)
      .post('/api/v1/pathways/')
      .set('Authorization', `Bearer ${session.token}`)
      .set('X-Client', 'mobile')
      .set('X-CSRF-Token', 'test')
      .send({
        patientId,
        pathwayType: 'cbt',
        pathwayName: 'Cognitive Behavioural Therapy',
        name: 'Cognitive Behavioural Therapy',
        totalSessions: 12,
        startDate: '2026-05-01',
      });
    expect(pathwayCreate.status).toBe(201);
    pathwayId = pathwayCreate.body.id as string;
  });

  afterAll(async () => {
    if (!READY) return;
    await withClinicContext(session.clinicId, async (trx) => {
      if (pathwayId) {
        await trx('treatment_pathways').where({ id: pathwayId }).del();
      }
      if (patientId) {
        await trx('patients').where({ id: patientId }).del();
      }
    });
  });

  it('supports intervention pack assignment, item completion, thought diary and sleep check-ins under optimistic lock', async () => {
    const detail0 = await request(app)
      .get(`/api/v1/pathways/${pathwayId}/digital-interventions`)
      .set('Authorization', `Bearer ${session.token}`)
      .set('X-Client', 'mobile')
      .set('X-CSRF-Token', 'test');
    expect(detail0.status).toBe(200);
    expect(Array.isArray(detail0.body.packs)).toBe(true);
    expect(Array.isArray(detail0.body.thoughtDiaryEntries)).toBe(true);
    expect(Array.isArray(detail0.body.sleepJourneyCheckIns)).toBe(true);
    const v0 = detail0.body.lockVersion as number;

    const assign = await request(app)
      .post(`/api/v1/pathways/${pathwayId}/digital-interventions/assign`)
      .set('Authorization', `Bearer ${session.token}`)
      .set('X-Client', 'mobile')
      .set('X-CSRF-Token', 'test')
      .send({
        expectedLockVersion: v0,
        templateKey: 'cbt_homework',
        dueDate: '2026-06-15',
      });
    expect(assign.status).toBe(200);
    expect(assign.body.packs.length).toBe(1);
    const pack = assign.body.packs[0] as { id: string; items: Array<{ id: string }> };
    const v1 = assign.body.lockVersion as number;

    const completeItem = await request(app)
      .post(`/api/v1/pathways/${pathwayId}/digital-interventions/${pack.id}/items/${pack.items[0].id}`)
      .set('Authorization', `Bearer ${session.token}`)
      .set('X-Client', 'mobile')
      .set('X-CSRF-Token', 'test')
      .send({
        expectedLockVersion: v1,
        completed: true,
      });
    expect(completeItem.status).toBe(200);
    expect(completeItem.body.packs[0].items[0].completed).toBe(true);
    const v2 = completeItem.body.lockVersion as number;

    const thoughtDiary = await request(app)
      .post(`/api/v1/pathways/${pathwayId}/thought-diary`)
      .set('Authorization', `Bearer ${session.token}`)
      .set('X-Client', 'mobile')
      .set('X-CSRF-Token', 'test')
      .send({
        expectedLockVersion: v2,
        situation: 'Team meeting',
        automaticThought: 'I cannot cope',
        emotion: 'anxiety',
        emotionIntensity: 85,
        balancedThought: 'I can ask for support and break this into steps',
      });
    expect(thoughtDiary.status).toBe(200);
    expect(thoughtDiary.body.thoughtDiaryEntries.length).toBe(1);
    const v3 = thoughtDiary.body.lockVersion as number;

    const sleepCheckIn = await request(app)
      .post(`/api/v1/pathways/${pathwayId}/sleep-hygiene/check-in`)
      .set('Authorization', `Bearer ${session.token}`)
      .set('X-Client', 'mobile')
      .set('X-CSRF-Token', 'test')
      .send({
        expectedLockVersion: v3,
        date: '2026-06-01',
        bedtime: '22:45',
        wakeTime: '06:30',
        sleepHours: 7.0,
        sleepQuality: 4,
        caffeineAfterNoon: false,
        screenAfterBed: true,
        exerciseDone: true,
      });
    expect(sleepCheckIn.status).toBe(200);
    expect(sleepCheckIn.body.sleepJourneyCheckIns.length).toBe(1);

    const staleAssign = await request(app)
      .post(`/api/v1/pathways/${pathwayId}/digital-interventions/assign`)
      .set('Authorization', `Bearer ${session.token}`)
      .set('X-Client', 'mobile')
      .set('X-CSRF-Token', 'test')
      .send({
        expectedLockVersion: v0,
        templateKey: 'dbt_skills',
      });
    expect(staleAssign.status).toBe(409);
    expect(staleAssign.body.code ?? staleAssign.body.error?.code).toBe('OPTIMISTIC_LOCK_CONFLICT');
  });
});
