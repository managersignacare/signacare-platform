import { randomUUID } from 'crypto';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import app from '../../src/server';
import { dbAdmin } from '../../src/db/db';
import { isIntegrationReady, loginAsClinician } from './_helpers';
import { withTenantContext } from '../../src/shared/tenantContext';

const READY = await isIntegrationReady();
const TEST_TAG = `BUG-WF52-${Date.now()}`;

type Session = {
  token: string;
  clinicId: string;
  userId: string;
};

let session: Session;

const createdPatientIds: string[] = [];
const createdEpisodeIds: string[] = [];
const createdOutcomeIds: string[] = [];

function authHeaders(token: string): Record<string, string> {
  return {
    Authorization: `Bearer ${token}`,
    'X-CSRF-Token': 'test',
    'X-Client': 'mobile',
  };
}

async function seedPatientAndEpisode(
  suffix: string,
): Promise<{ patientId: string; episodeId: string }> {
  const patientId = randomUUID();
  const episodeId = randomUUID();
  createdPatientIds.push(patientId);
  createdEpisodeIds.push(episodeId);

  await withTenantContext(session.clinicId, async () => {
    await dbAdmin('patients').insert({
      id: patientId,
      clinic_id: session.clinicId,
      given_name: 'BugWf52',
      family_name: `${TEST_TAG}-${suffix}`,
      emr_number: `${TEST_TAG}-${suffix}`,
      date_of_birth: '1992-03-04',
      created_at: new Date(),
      updated_at: new Date(),
    });

    await dbAdmin('episodes').insert({
      id: episodeId,
      clinic_id: session.clinicId,
      patient_id: patientId,
      primary_clinician_id: session.userId,
      episode_type: 'triage',
      presenting_problem: `${TEST_TAG} ${suffix}`,
      status: 'open',
      start_date: new Date(),
      created_at: new Date(),
      updated_at: new Date(),
    });
  });

  return { patientId, episodeId };
}

beforeAll(async () => {
  if (!READY) return;
  session = await loginAsClinician();
});

afterAll(async () => {
  if (!READY) return;

  await withTenantContext(session.clinicId, async () => {
    if (createdPatientIds.length > 0) {
      await dbAdmin('notifications')
        .where({ clinic_id: session.clinicId, category: 'risk' })
        .whereRaw(`payload::text ILIKE ?`, [`%${TEST_TAG}%`])
        .del()
        .catch(() => undefined);

      await dbAdmin('tasks')
        .where({ clinic_id: session.clinicId })
        .whereIn('patient_id', createdPatientIds)
        .where('title', 'Immediate suicide-risk assessment review required')
        .del()
        .catch(() => undefined);
    }

    if (createdOutcomeIds.length > 0) {
      await dbAdmin('outcome_measures').whereIn('id', createdOutcomeIds).del().catch(() => undefined);
    }
    if (createdEpisodeIds.length > 0) {
      await dbAdmin('episodes').whereIn('id', createdEpisodeIds).del().catch(() => undefined);
    }
    if (createdPatientIds.length > 0) {
      await dbAdmin('patients').whereIn('id', createdPatientIds).del().catch(() => undefined);
    }
  });
});

describe.skipIf(!READY)('BUG-WF52 — suicide-risk escalation for PHQ-9 assessments', () => {
  it('creates urgent task + clinical signal when clinician submits PHQ-9 with positive Q9', async () => {
    const { patientId, episodeId } = await seedPatientAndEpisode('clinician-phq9');
    const start = new Date();

    const res = await request(app)
      .post('/api/v1/outcomes')
      .set(authHeaders(session.token))
      .send({
        patientId,
        episodeId,
        measureType: 'PHQ-9',
        collectionOccasion: 'review',
        items: {
          q1: 1, q2: 1, q3: 1, q4: 0, q5: 0, q6: 1, q7: 0, q8: 0, q9: 1,
        },
      });

    expect(res.status).toBe(201);
    const outcomeId = String(res.body.id ?? res.body.outcomeId ?? '');
    if (outcomeId) createdOutcomeIds.push(outcomeId);

    const taskRows = await withTenantContext(session.clinicId, async () =>
      dbAdmin('tasks')
        .where({
          clinic_id: session.clinicId,
          patient_id: patientId,
          assigned_to_id: session.userId,
          title: 'Immediate suicide-risk assessment review required',
          priority: 'urgent',
        })
        .andWhere('created_at', '>=', start)
        .select('id', 'description'),
    );
    expect(taskRows.length).toBeGreaterThan(0);
    expect(String(taskRows[0]?.description ?? '')).toContain('Q9');

    const notificationRows = await withTenantContext(session.clinicId, async () =>
      dbAdmin('notifications')
        .where({
          clinic_id: session.clinicId,
          recipient_staff_id: session.userId,
          category: 'risk',
          title: 'PHQ-9 high suicide-risk trigger',
        })
        .andWhere('created_at', '>=', start)
        .select('id', 'payload'),
    );
    expect(notificationRows.length).toBeGreaterThan(0);
    expect(JSON.stringify(notificationRows[0]?.payload ?? {})).toContain(patientId);
  });

  it('does not create escalation task for low-risk PHQ-9 submission', async () => {
    const { patientId, episodeId } = await seedPatientAndEpisode('clinician-low-risk');
    const start = new Date();

    const res = await request(app)
      .post('/api/v1/outcomes')
      .set(authHeaders(session.token))
      .send({
        patientId,
        episodeId,
        measureType: 'PHQ-9',
        collectionOccasion: 'review',
        items: {
          q1: 0, q2: 0, q3: 0, q4: 1, q5: 1, q6: 0, q7: 0, q8: 0, q9: 0,
        },
      });

    expect(res.status).toBe(201);
    const outcomeId = String(res.body.id ?? res.body.outcomeId ?? '');
    if (outcomeId) createdOutcomeIds.push(outcomeId);

    const taskRows = await withTenantContext(session.clinicId, async () =>
      dbAdmin('tasks')
        .where({
          clinic_id: session.clinicId,
          patient_id: patientId,
          title: 'Immediate suicide-risk assessment review required',
        })
        .andWhere('created_at', '>=', start)
        .select('id'),
    );
    expect(taskRows).toHaveLength(0);
  });

  it('creates escalation on patient-app completion when PHQ-9 total >= 20', async () => {
    const { patientId, episodeId } = await seedPatientAndEpisode('patient-app-phq9');
    const assessmentId = randomUUID();
    createdOutcomeIds.push(assessmentId);
    const start = new Date();

    await withTenantContext(session.clinicId, async () => {
      await dbAdmin('outcome_measures').insert({
        id: assessmentId,
        clinic_id: session.clinicId,
        patient_id: patientId,
        episode_id: episodeId,
        staff_id: session.userId,
        measure_type: 'PHQ-9',
        template_name: 'PHQ-9',
        status: 'pending',
        assigned_for_patient: true,
        items: JSON.stringify({}),
        created_at: new Date(),
        updated_at: new Date(),
      });
    });

    const res = await request(app)
      .patch(`/api/v1/patient-app/assessments/${patientId}/${assessmentId}/complete`)
      .set(authHeaders(session.token))
      .send({
        responses: {
          q1: 3, q2: 3, q3: 3, q4: 3, q5: 3, q6: 2, q7: 2, q8: 1, q9: 0,
        },
      });

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);

    const taskRows = await withTenantContext(session.clinicId, async () =>
      dbAdmin('tasks')
        .where({
          clinic_id: session.clinicId,
          patient_id: patientId,
          assigned_to_id: session.userId,
          title: 'Immediate suicide-risk assessment review required',
          priority: 'urgent',
        })
        .andWhere('created_at', '>=', start)
        .select('id'),
    );
    expect(taskRows.length).toBeGreaterThan(0);

    const notificationRows = await withTenantContext(session.clinicId, async () =>
      dbAdmin('notifications')
        .where({
          clinic_id: session.clinicId,
          recipient_staff_id: session.userId,
          category: 'risk',
          title: 'Patient app PHQ-9 high-risk trigger',
        })
        .andWhere('created_at', '>=', start)
        .select('id', 'payload'),
    );
    expect(notificationRows.length).toBeGreaterThan(0);
    expect(JSON.stringify(notificationRows[0]?.payload ?? {})).toContain(assessmentId);
  });

  it('ignores client-submitted totalScore and uses derived response score for escalation decisions', async () => {
    const { patientId, episodeId } = await seedPatientAndEpisode('patient-app-spoofed-total');
    const assessmentId = randomUUID();
    createdOutcomeIds.push(assessmentId);
    const start = new Date();

    await withTenantContext(session.clinicId, async () => {
      await dbAdmin('outcome_measures').insert({
        id: assessmentId,
        clinic_id: session.clinicId,
        patient_id: patientId,
        episode_id: episodeId,
        staff_id: session.userId,
        measure_type: 'PHQ-9',
        template_name: 'PHQ-9',
        status: 'pending',
        assigned_for_patient: true,
        items: JSON.stringify({}),
        created_at: new Date(),
        updated_at: new Date(),
      });
    });

    const res = await request(app)
      .patch(`/api/v1/patient-app/assessments/${patientId}/${assessmentId}/complete`)
      .set(authHeaders(session.token))
      .send({
        totalScore: 27,
        responses: {
          q1: 1, q2: 0, q3: 0, q4: 0, q5: 0, q6: 0, q7: 0, q8: 0, q9: 0,
        },
      });

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);

    const storedOutcome = await withTenantContext(session.clinicId, async () =>
      dbAdmin('outcome_measures')
        .where({ id: assessmentId, clinic_id: session.clinicId })
        .first('total_score'),
    );
    expect(Number(storedOutcome?.total_score ?? -1)).toBe(1);

    const taskRows = await withTenantContext(session.clinicId, async () =>
      dbAdmin('tasks')
        .where({
          clinic_id: session.clinicId,
          patient_id: patientId,
          assigned_to_id: session.userId,
          title: 'Immediate suicide-risk assessment review required',
          priority: 'urgent',
        })
        .andWhere('created_at', '>=', start)
        .select('id'),
    );
    expect(taskRows).toHaveLength(0);

    const notificationRows = await withTenantContext(session.clinicId, async () =>
      dbAdmin('notifications')
        .where({
          clinic_id: session.clinicId,
          recipient_staff_id: session.userId,
          category: 'risk',
          title: 'Patient app PHQ-9 high-risk trigger',
        })
        .andWhere('created_at', '>=', start)
        .select('id'),
    );
    expect(notificationRows).toHaveLength(0);
  });
});
