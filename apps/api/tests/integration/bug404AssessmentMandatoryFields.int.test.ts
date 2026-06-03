import { randomUUID } from 'crypto';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import app from '../../src/server';
import { dbAdmin } from '../../src/db/db';
import { isIntegrationReady, loginAsAdmin } from './_helpers';

const READY = await isIntegrationReady();
const TEST_TAG = `BUG-404-${Date.now()}`;

type Session = {
  token: string;
  clinicId: string;
  userId: string;
};

let session: Session;
const createdPatientIds: string[] = [];
const createdEpisodeIds: string[] = [];

function authHeaders(token: string): Record<string, string> {
  return {
    Authorization: `Bearer ${token}`,
    'X-CSRF-Token': 'test',
    'X-Client': 'mobile',
  };
}

async function seedPatientAndEpisode(suffix: string): Promise<{ patientId: string; episodeId: string }> {
  const patientId = randomUUID();
  const episodeId = randomUUID();
  createdPatientIds.push(patientId);
  createdEpisodeIds.push(episodeId);

  await dbAdmin('patients').insert({
    id: patientId,
    clinic_id: session.clinicId,
    given_name: 'Bug404',
    family_name: `${TEST_TAG}-${suffix}`,
    emr_number: `${TEST_TAG}-${suffix}`,
    date_of_birth: '1990-01-01',
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

  return { patientId, episodeId };
}

beforeAll(async () => {
  if (!READY) return;
  session = await loginAsAdmin();
});

afterAll(async () => {
  if (!READY) return;
  if (createdPatientIds.length > 0) {
    await dbAdmin('risk_assessments')
      .where({ clinic_id: session.clinicId })
      .whereIn('patient_id', createdPatientIds)
      .del()
      .catch(() => undefined);
    await dbAdmin('outcome_measures')
      .where({ clinic_id: session.clinicId })
      .whereIn('patient_id', createdPatientIds)
      .del()
      .catch(() => undefined);
  }
  if (createdEpisodeIds.length > 0) {
    await dbAdmin('episodes').whereIn('id', createdEpisodeIds).del().catch(() => undefined);
  }
  if (createdPatientIds.length > 0) {
    await dbAdmin('patients').whereIn('id', createdPatientIds).del().catch(() => undefined);
  }
});

describe.skipIf(!READY)('BUG-404 — mandatory-field enforcement for C-SSRS / HoNOS', () => {
  it('rejects partial HoNOS item payloads on outcomes create', async () => {
    const { patientId, episodeId } = await seedPatientAndEpisode('honos-partial');
    const res = await request(app)
      .post('/api/v1/outcomes')
      .set(authHeaders(session.token))
      .send({
        patientId,
        episodeId,
        measureType: 'honos',
        collectionOccasion: 'review',
        items: {
          '1': 2,
          '2': 1,
        },
      });

    expect(res.status).toBe(422);
    expect(JSON.stringify(res.body)).toMatch(/honos item 3 is required/i);
  });

  it('accepts complete HoNOS item payloads on outcomes create', async () => {
    const { patientId, episodeId } = await seedPatientAndEpisode('honos-complete');
    const items: Record<string, number> = {};
    for (let i = 1; i <= 12; i += 1) items[String(i)] = 1;

    const res = await request(app)
      .post('/api/v1/outcomes')
      .set(authHeaders(session.token))
      .send({
        patientId,
        episodeId,
        measureType: 'honos',
        collectionOccasion: 'review',
        items,
        totalScore: 12,
      });

    expect(res.status).toBe(201);
    expect(res.body.measure_type ?? res.body.measureType).toBe('honos');
    expect(Number(res.body.total_score ?? res.body.totalScore)).toBe(12);
  });

  it('rejects C-SSRS risk assessments missing mandatory fields', async () => {
    const { patientId, episodeId } = await seedPatientAndEpisode('cssrs-partial');
    const res = await request(app)
      .post('/api/v1/risk-assessments')
      .set(authHeaders(session.token))
      .send({
        patientId,
        episodeId,
        assessmentType: 'C-SSRS',
        overallRiskLevel: 'high',
        suicideRisk: true,
        assessmentDate: new Date().toISOString().slice(0, 10),
      });

    expect(res.status).toBe(400);
    expect(JSON.stringify(res.body)).toMatch(/form(al)? instrument assessments require/i);
  });

  it('accepts C-SSRS risk assessments when mandatory fields are complete', async () => {
    const { patientId, episodeId } = await seedPatientAndEpisode('cssrs-complete');
    const today = new Date().toISOString().slice(0, 10);
    const reviewDate = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

    const res = await request(app)
      .post('/api/v1/risk-assessments')
      .set(authHeaders(session.token))
      .send({
        patientId,
        episodeId,
        assessmentType: 'C-SSRS',
        totalScore: 8,
        scoreBand: 'moderate',
        overallRiskLevel: 'high',
        suicideRisk: true,
        selfHarmRisk: true,
        harmToOthersRisk: false,
        abscondingRisk: false,
        vulnerabilityRisk: true,
        riskNarrative: 'Active suicidal ideation with episodic intent; no immediate plan.',
        riskManagementPlan: 'Enhanced observation, safety planning, and daily MDT risk review.',
        assessmentDate: today,
        reviewDate,
      });

    expect(res.status).toBe(201);
    expect(res.body.assessmentType).toBe('C-SSRS');
    expect(res.body.totalScore).toBe(8);
  });
});
