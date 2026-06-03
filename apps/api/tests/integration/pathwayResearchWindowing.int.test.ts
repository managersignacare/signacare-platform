import { randomUUID } from 'crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import app from '../../src/server';
import { dbAdmin } from '../../src/db/db';
import { isIntegrationReady, loginAsAdmin } from './_helpers';

const READY = await isIntegrationReady();

describe.skipIf(!READY)('Pathway research lane period windowing', () => {
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
    pathwayId = randomUUID();
    const now = new Date();
    const old = new Date(now.getTime() - 120 * 24 * 60 * 60 * 1000).toISOString();
    const recent = new Date(now.getTime() - 5 * 24 * 60 * 60 * 1000).toISOString();

    await withClinicContext(session.clinicId, async (trx) => {
      await trx('patients').insert({
        id: patientId,
        clinic_id: session.clinicId,
        given_name: 'Research',
        family_name: `Window-${Date.now()}`,
        emr_number: `RWIN-${Date.now()}`,
        date_of_birth: '1988-04-01',
        created_at: new Date(),
        updated_at: new Date(),
      });

      await trx('treatment_pathways').insert({
        id: pathwayId,
        clinic_id: session.clinicId,
        patient_id: patientId,
        name: 'Cognitive Behavioural Therapy',
        status: 'active',
        milestones: JSON.stringify({
          pathwayType: 'cbt',
          totalSessions: 12,
          completedSessions: 4,
          startDate: old,
          assignedPacks: [
            {
              id: randomUUID(),
              templateKey: 'cbt_homework',
              title: 'Old Pack',
              status: 'completed',
              dueDate: null,
              notes: null,
              assignedAt: old,
              assignedByStaffId: session.userId,
              items: [],
            },
            {
              id: randomUUID(),
              templateKey: 'dbt_skills',
              title: 'Recent Pack',
              status: 'active',
              dueDate: null,
              notes: null,
              assignedAt: recent,
              assignedByStaffId: session.userId,
              items: [],
            },
          ],
          thoughtDiaryEntries: [
            {
              id: randomUUID(),
              occurredAt: old,
              situation: 'Historical',
              automaticThought: 'Old thought',
              emotion: 'sadness',
              emotionIntensity: 50,
              createdAt: old,
              createdByStaffId: session.userId,
            },
            {
              id: randomUUID(),
              occurredAt: recent,
              situation: 'Recent',
              automaticThought: 'Recent thought',
              emotion: 'anxiety',
              emotionIntensity: 65,
              createdAt: recent,
              createdByStaffId: session.userId,
            },
          ],
          sleepJourneyCheckIns: [
            {
              id: randomUUID(),
              date: old.split('T')[0],
              sleepQuality: 3,
              caffeineAfterNoon: false,
              screenAfterBed: false,
              exerciseDone: true,
              createdAt: old,
              createdByStaffId: session.userId,
            },
            {
              id: randomUUID(),
              date: recent.split('T')[0],
              sleepQuality: 4,
              caffeineAfterNoon: false,
              screenAfterBed: true,
              exerciseDone: false,
              createdAt: recent,
              createdByStaffId: session.userId,
            },
          ],
        }),
        created_at: new Date(),
        updated_at: new Date(),
      });
    });
  });

  afterAll(async () => {
    if (!READY) return;
    await withClinicContext(session.clinicId, async (trx) => {
      await trx('treatment_pathways').where({ clinic_id: session.clinicId, id: pathwayId }).del();
      await trx('patients').where({ clinic_id: session.clinicId, id: patientId }).del();
    });
  });

  it('counts intervention and digital activity only within selected period window', async () => {
    const result = await request(app)
      .get('/api/v1/pathways/research/effectiveness?periodDays=30')
      .set('Authorization', `Bearer ${session.token}`)
      .set('X-Client', 'mobile')
      .set('X-CSRF-Token', 'test');

    expect(result.status).toBe(200);
    expect(result.body.assignedInterventionPacks).toBe(1);
    expect(result.body.thoughtDiaryEntries).toBe(1);
    expect(result.body.sleepJourneyCheckIns).toBe(1);
  });
});

