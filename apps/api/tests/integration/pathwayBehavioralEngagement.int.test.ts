import { randomUUID } from 'crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import app from '../../src/server';
import { dbAdmin } from '../../src/db/db';
import { isIntegrationReady, loginAsAdmin } from './_helpers';

const READY = await isIntegrationReady();

describe.skipIf(!READY)('Behavioral pathways end-to-end workflow', () => {
  let session: Awaited<ReturnType<typeof loginAsAdmin>>;
  let patientId = '';
  let episodeId = '';
  let pathwayId = '';
  let contractId = '';
  let routineId = '';
  let ruleId = '';
  let assignmentId = '';

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
    episodeId = randomUUID();
    await withClinicContext(session.clinicId, async (trx) => {
      await trx('patients').insert({
        id: patientId,
        clinic_id: session.clinicId,
        given_name: 'Behavioral',
        family_name: `Workflow-${Date.now()}`,
        emr_number: `BP-${Date.now()}`,
        date_of_birth: '1990-06-10',
        created_at: new Date(),
        updated_at: new Date(),
      });
      await trx('episodes').insert({
        id: episodeId,
        clinic_id: session.clinicId,
        patient_id: patientId,
        status: 'open',
        start_date: new Date().toISOString().slice(0, 10),
        primary_clinician_id: session.userId,
        created_at: new Date(),
        updated_at: new Date(),
      });
    });

    const createdPathway = await request(app)
      .post('/api/v1/pathways/')
      .set('Authorization', `Bearer ${session.token}`)
      .set('X-Client', 'web')
      .set('X-CSRF-Token', 'test')
      .send({
        patientId,
        pathwayType: 'cbt',
        pathwayName: 'Cognitive Behavioural Therapy',
        name: 'Cognitive Behavioural Therapy',
        totalSessions: 12,
        startDate: '2026-01-01',
      });
    expect(createdPathway.status).toBe(201);
    pathwayId = createdPathway.body.id as string;
  });

  afterAll(async () => {
    if (!READY || !session?.clinicId || !patientId) return;
    await withClinicContext(session.clinicId, async (trx) => {
      await trx('patient_micro_learning_assignments').where({ clinic_id: session.clinicId, patient_id: patientId }).del();
      await trx('clinic_micro_learning_rules').where({ clinic_id: session.clinicId, id: ruleId }).del();
      await trx('patient_tracking').where({ clinic_id: session.clinicId, patient_id: patientId }).del();
      await trx('patient_routine_events').where({ clinic_id: session.clinicId, patient_id: patientId }).del();
      await trx('patient_routine_plans').where({ clinic_id: session.clinicId, patient_id: patientId }).del();
      await trx('patient_behavior_contracts').where({ clinic_id: session.clinicId, patient_id: patientId }).del();
      await trx('patient_behavioral_segments').where({ clinic_id: session.clinicId, patient_id: patientId }).del();
      await trx('treatment_pathways').where({ clinic_id: session.clinicId, id: pathwayId }).del();
      await trx('episodes').where({ clinic_id: session.clinicId, patient_id: patientId }).del();
      await trx('patients').where({ clinic_id: session.clinicId, id: patientId }).del();
    });
  });

  it('supports contract, routine, streak, segment, micro-learning, patient-app and defaults workflows', async () => {
    const createContract = await request(app)
      .post('/api/v1/pathways/behavioral/contracts')
      .set('Authorization', `Bearer ${session.token}`)
      .set('X-Client', 'web')
      .set('X-CSRF-Token', 'test')
      .send({
        patientId,
        pathwayId,
        triggerText: 'If anxiety exceeds 7 for two days',
        commitmentBehavior: 'Open grounding card and send support message',
        fallbackPlan: 'Call care line if no reduction in 20 minutes',
        reviewDate: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10),
        accountabilityPartner: 'Sibling',
      });
    expect(createContract.status).toBe(201);
    contractId = String(createContract.body.id);
    expect(createContract.body.lockVersion).toBe(1);

    const listContracts = await request(app)
      .get(`/api/v1/pathways/behavioral/contracts/${patientId}`)
      .set('Authorization', `Bearer ${session.token}`)
      .set('X-Client', 'web')
      .set('X-CSRF-Token', 'test');
    expect(listContracts.status).toBe(200);
    expect(Array.isArray(listContracts.body.contracts)).toBe(true);
    expect(listContracts.body.contracts.some((row: { id: string }) => row.id === contractId)).toBe(true);

    const patchContract = await request(app)
      .patch(`/api/v1/pathways/behavioral/contracts/${contractId}`)
      .set('Authorization', `Bearer ${session.token}`)
      .set('X-Client', 'web')
      .set('X-CSRF-Token', 'test')
      .send({
        expectedLockVersion: 1,
        adherenceStatus: 'completed',
        adherenceNote: 'Completed daily for this week',
      });
    expect(patchContract.status).toBe(200);
    expect(patchContract.body.lockVersion).toBe(2);

    const createRoutine = await request(app)
      .post('/api/v1/pathways/behavioral/routines')
      .set('Authorization', `Bearer ${session.token}`)
      .set('X-Client', 'web')
      .set('X-CSRF-Token', 'test')
      .send({
        patientId,
        pathwayId,
        name: 'Anxiety regulation routine',
        conditionKind: 'anxiety_gte',
        conditionThreshold: 7,
        conditionWindowMinutes: 60,
        thenActionKind: 'open_grounding_card',
        thenActionText: 'Open grounding card and complete paced breathing.',
        fallbackAfterMinutes: 20,
        fallbackActionText: 'Call the support line and notify clinician.',
        reviewDate: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10),
        isActive: true,
      });
    expect(createRoutine.status).toBe(201);
    routineId = String(createRoutine.body.id);

    const logRoutineEvent = await request(app)
      .post('/api/v1/pathways/behavioral/routines/events')
      .set('Authorization', `Bearer ${session.token}`)
      .set('X-Client', 'web')
      .set('X-CSRF-Token', 'test')
      .send({
        patientId,
        routineId,
        eventType: 'routine_completed',
        occurredAt: new Date().toISOString(),
      });
    expect(logRoutineEvent.status).toBe(202);

    const streak = await request(app)
      .get(`/api/v1/pathways/behavioral/streaks/${patientId}`)
      .set('Authorization', `Bearer ${session.token}`)
      .set('X-Client', 'web')
      .set('X-CSRF-Token', 'test');
    expect(streak.status).toBe(200);
    expect(Array.isArray(streak.body.items)).toBe(true);

    const friction = await request(app)
      .get(`/api/v1/pathways/behavioral/friction/${patientId}`)
      .set('Authorization', `Bearer ${session.token}`)
      .set('X-Client', 'web')
      .set('X-CSRF-Token', 'test');
    expect(friction.status).toBe(200);
    expect(Array.isArray(friction.body.items)).toBe(true);

    const segment = await request(app)
      .get(`/api/v1/pathways/behavioral/segments/${patientId}`)
      .set('Authorization', `Bearer ${session.token}`)
      .set('X-Client', 'web')
      .set('X-CSRF-Token', 'test');
    expect(segment.status).toBe(200);
    expect(typeof segment.body.segment).toBe('string');

    const segmentOverride = await request(app)
      .put(`/api/v1/pathways/behavioral/segments/${patientId}/override`)
      .set('Authorization', `Bearer ${session.token}`)
      .set('X-Client', 'web')
      .set('X-CSRF-Token', 'test')
      .send({
        segment: 'motivated',
        confidence: 0.92,
        overrideReason: 'Clinician reviewed adherence and confirmed trend.',
      });
    expect(segmentOverride.status).toBe(200);
    expect(segmentOverride.body.overrideByStaffId).toBe(session.userId);

    const listCards = await request(app)
      .get('/api/v1/pathways/behavioral/micro-learning/cards')
      .set('Authorization', `Bearer ${session.token}`)
      .set('X-Client', 'web')
      .set('X-CSRF-Token', 'test');
    expect(listCards.status).toBe(200);
    expect(Array.isArray(listCards.body.cards)).toBe(true);
    expect(listCards.body.cards.length).toBeGreaterThan(0);

    const cardId = String(listCards.body.cards[0].id);
    const createRule = await request(app)
      .post('/api/v1/pathways/behavioral/micro-learning/rules')
      .set('Authorization', `Bearer ${session.token}`)
      .set('X-Client', 'web')
      .set('X-CSRF-Token', 'test')
      .send({
        name: `Anxiety jump trigger ${Date.now()}`,
        trackingType: 'anxiety',
        deltaThreshold: 2,
        windowDays: 3,
        cardId,
        cooldownDays: 3,
        isActive: true,
      });
    expect(createRule.status).toBe(201);
    ruleId = String(createRule.body.id);

    await withClinicContext(session.clinicId, async (trx) => {
      const now = new Date();
      const baselineStart = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
      const risingStart = new Date(now.getTime() - 3 * 24 * 60 * 60 * 1000);
      const baselineValues = [2, 2, 3];
      const risingValues = [7, 8, 8];
      for (let index = 0; index < baselineValues.length; index += 1) {
        await trx('patient_tracking').insert({
          id: randomUUID(),
          clinic_id: session.clinicId,
          patient_id: patientId,
          tracking_type: 'anxiety',
          value: baselineValues[index],
          recorded_at: new Date(baselineStart.getTime() + index * 24 * 60 * 60 * 1000),
          created_at: now,
        });
      }
      for (let index = 0; index < risingValues.length; index += 1) {
        await trx('patient_tracking').insert({
          id: randomUUID(),
          clinic_id: session.clinicId,
          patient_id: patientId,
          tracking_type: 'anxiety',
          value: risingValues[index],
          recorded_at: new Date(risingStart.getTime() + index * 24 * 60 * 60 * 1000),
          created_at: now,
        });
      }
    });

    const assignments = await request(app)
      .get(`/api/v1/pathways/behavioral/micro-learning/assignments/${patientId}`)
      .set('Authorization', `Bearer ${session.token}`)
      .set('X-Client', 'web')
      .set('X-CSRF-Token', 'test');
    expect(assignments.status).toBe(200);
    expect(Array.isArray(assignments.body.assignments)).toBe(true);
    expect(assignments.body.assignments.length).toBeGreaterThan(0);
    assignmentId = String(assignments.body.assignments[0].id);

    const assignmentOpened = await request(app)
      .post(`/api/v1/pathways/behavioral/micro-learning/assignments/${assignmentId}/status`)
      .set('Authorization', `Bearer ${session.token}`)
      .set('X-Client', 'web')
      .set('X-CSRF-Token', 'test')
      .send({ status: 'opened' });
    expect(assignmentOpened.status).toBe(202);

    const patientMicroLearning = await request(app)
      .get(`/api/v1/patient-app/interventions/${patientId}/micro-learning`)
      .set('Authorization', `Bearer ${session.token}`)
      .set('X-Client', 'mobile')
      .set('X-CSRF-Token', 'test');
    expect(patientMicroLearning.status).toBe(200);
    expect(Array.isArray(patientMicroLearning.body.assignments)).toBe(true);

    const patientStatusUpdate = await request(app)
      .post(`/api/v1/patient-app/interventions/${patientId}/micro-learning/${assignmentId}/status`)
      .set('Authorization', `Bearer ${session.token}`)
      .set('X-Client', 'mobile')
      .set('X-CSRF-Token', 'test')
      .send({ status: 'completed' });
    expect(patientStatusUpdate.status).toBe(202);

    const patientRoutineEvent = await request(app)
      .post(`/api/v1/patient-app/interventions/${patientId}/routine-events`)
      .set('Authorization', `Bearer ${session.token}`)
      .set('X-Client', 'mobile')
      .set('X-CSRF-Token', 'test')
      .send({
        eventType: 'journal_completed',
        occurredAt: new Date().toISOString(),
      });
    expect(patientRoutineEvent.status).toBe(202);

    const defaults = await request(app)
      .get('/api/v1/pathways/behavioral/choice-architecture/defaults')
      .set('Authorization', `Bearer ${session.token}`)
      .set('X-Client', 'web')
      .set('X-CSRF-Token', 'test');
    expect(defaults.status).toBe(200);
    expect(typeof defaults.body.nextReviewDueDaysDefault).toBe('number');

    const patchDefaults = await request(app)
      .patch('/api/v1/pathways/behavioral/choice-architecture/defaults')
      .set('Authorization', `Bearer ${session.token}`)
      .set('X-Client', 'web')
      .set('X-CSRF-Token', 'test')
      .send({
        nextReviewDueDaysDefault: 21,
      });
    expect(patchDefaults.status).toBe(200);
    expect(patchDefaults.body.nextReviewDueDaysDefault).toBe(21);

    const slaBoard = await request(app)
      .get('/api/v1/pathways/behavioral/sla-board')
      .set('Authorization', `Bearer ${session.token}`)
      .set('X-Client', 'web')
      .set('X-CSRF-Token', 'test');
    expect(slaBoard.status).toBe(200);
    expect(Array.isArray(slaBoard.body.items)).toBe(true);
  });
});
