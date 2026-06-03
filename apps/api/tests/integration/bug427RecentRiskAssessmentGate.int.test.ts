import { randomUUID } from 'crypto';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { RECENT_RISK_ASSESSMENT_BYPASS_FLAG } from '@signacare/shared';
import app from '../../src/server';
import { dbAdmin } from '../../src/db/db';
import { _resetFeatureFlagCache } from '../../src/shared/featureFlags';
import { isIntegrationReady, loginAsAdmin } from './_helpers';

const READY = await isIntegrationReady();
const TEST_TAG = `BUG-427-${Date.now()}`;

let session: { token: string; clinicId: string; userId: string };
const createdPatientIds: string[] = [];
const createdEpisodeIds: string[] = [];

type SeededFixture = {
  patientId: string;
  episodeId: string;
};

function firstVisitChartReviewPayload() {
  return {
    recentLabsReviewed: true,
    recentImagingReviewed: true,
    recentMedicationsReviewed: true,
    reviewedAt: new Date().toISOString(),
  };
}

async function upsertBypassFlag(enabled: boolean): Promise<void> {
  const existing = await dbAdmin('feature_flags')
    .where({ clinic_id: session.clinicId, name: RECENT_RISK_ASSESSMENT_BYPASS_FLAG })
    .first('id');

  if (existing) {
    await dbAdmin('feature_flags')
      .where({ id: existing.id })
      .update({ enabled, rollout_percentage: enabled ? 100 : 0 });
  } else {
    await dbAdmin('feature_flags').insert({
      id: randomUUID(),
      clinic_id: session.clinicId,
      name: RECENT_RISK_ASSESSMENT_BYPASS_FLAG,
      enabled,
      rollout_percentage: enabled ? 100 : 0,
    });
  }
  _resetFeatureFlagCache();
}

async function seedPatientAndEpisode(suffix: string): Promise<SeededFixture> {
  const patientId = randomUUID();
  const episodeId = randomUUID();
  createdPatientIds.push(patientId);
  createdEpisodeIds.push(episodeId);

  await dbAdmin('patients').insert({
    id: patientId,
    clinic_id: session.clinicId,
    given_name: 'Bug427',
    family_name: `${TEST_TAG}-${suffix}`,
    emr_number: `${TEST_TAG}-${suffix}`,
    date_of_birth: '1991-02-03',
    created_at: new Date(),
    updated_at: new Date(),
  });

  await dbAdmin('episodes').insert({
    id: episodeId,
    clinic_id: session.clinicId,
    patient_id: patientId,
    episode_type: 'triage',
    presenting_problem: `${TEST_TAG}-${suffix}`,
    status: 'open',
    start_date: new Date(),
    created_at: new Date(),
    updated_at: new Date(),
  });

  return { patientId, episodeId };
}

async function seedRiskAssessment(
  patientId: string,
  episodeId: string,
  completedAt: Date,
): Promise<void> {
  const assessmentDate = completedAt.toISOString().slice(0, 10);
  await dbAdmin('risk_assessments').insert({
    id: randomUUID(),
    clinic_id: session.clinicId,
    patient_id: patientId,
    episode_id: episodeId,
    assessment_type: 'clinical',
    overall_risk_level: 'medium',
    suicide_risk: false,
    self_harm_risk: false,
    harm_to_others_risk: false,
    absconding_risk: false,
    vulnerability_risk: true,
    safety_plan_in_place: true,
    assessed_by_id: session.userId,
    assessment_date: assessmentDate,
    created_at: completedAt,
    updated_at: completedAt,
    lock_version: 1,
  });
}

beforeAll(async () => {
  if (!READY) return;
  session = await loginAsAdmin();
  await upsertBypassFlag(false);
});

afterAll(async () => {
  if (!READY) return;
  if (createdPatientIds.length > 0) {
    await dbAdmin('clinical_notes')
      .where({ clinic_id: session.clinicId })
      .whereIn('patient_id', createdPatientIds)
      .del()
      .catch(() => undefined);
    await dbAdmin('risk_assessments')
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
  await upsertBypassFlag(false);
});

describe.skipIf(!READY)('BUG-427 — recent risk-assessment sign gate', () => {
  it('blocks first signed psychiatric note when no risk assessment exists', async () => {
    const { patientId, episodeId } = await seedPatientAndEpisode('no-risk');
    const res = await request(app)
      .post(`/api/v1/patients/${patientId}/notes`)
      .set('Authorization', `Bearer ${session.token}`)
      .set('X-Client', 'mobile')
      .send({
        episodeId,
        title: `${TEST_TAG} no risk create-sign`,
        noteType: 'progress',
        content: `${TEST_TAG} content`,
        status: 'signed',
        firstVisitChartReview: firstVisitChartReviewPayload(),
      });

    expect(res.status).toBe(409);
    expect(res.body.code).toBe('RECENT_RISK_ASSESSMENT_REQUIRED');
  });

  it('blocks draft-to-signed transition when latest risk assessment is older than 48 hours', async () => {
    const { patientId, episodeId } = await seedPatientAndEpisode('stale-risk');
    await seedRiskAssessment(patientId, episodeId, new Date(Date.now() - 49 * 60 * 60 * 1000));

    const draft = await request(app)
      .post(`/api/v1/patients/${patientId}/notes`)
      .set('Authorization', `Bearer ${session.token}`)
      .set('X-Client', 'mobile')
      .send({
        episodeId,
        title: `${TEST_TAG} stale risk draft`,
        noteType: 'progress',
        content: `${TEST_TAG} draft`,
        status: 'draft',
      });
    expect(draft.status).toBe(201);

    const noteId = String(draft.body.note?.id);
    const signRes = await request(app)
      .patch(`/api/v1/patients/${patientId}/notes/${noteId}`)
      .set('Authorization', `Bearer ${session.token}`)
      .set('X-Client', 'mobile')
      .send({
        status: 'signed',
        firstVisitChartReview: firstVisitChartReviewPayload(),
      });

    expect(signRes.status).toBe(409);
    expect(signRes.body.code).toBe('RECENT_RISK_ASSESSMENT_REQUIRED');
  });

  it('allows first signed psychiatric note when a recent risk assessment exists', async () => {
    const { patientId, episodeId } = await seedPatientAndEpisode('recent-risk');
    await seedRiskAssessment(patientId, episodeId, new Date(Date.now() - 2 * 60 * 60 * 1000));

    const res = await request(app)
      .post(`/api/v1/patients/${patientId}/notes`)
      .set('Authorization', `Bearer ${session.token}`)
      .set('X-Client', 'mobile')
      .send({
        episodeId,
        title: `${TEST_TAG} recent risk create-sign`,
        noteType: 'progress',
        content: `${TEST_TAG} content`,
        status: 'signed',
        firstVisitChartReview: firstVisitChartReviewPayload(),
      });

    expect(res.status).toBe(201);
    expect(res.body.note?.status).toBe('signed');
  });

  it('allows signing when bypass flag is enabled', async () => {
    await upsertBypassFlag(true);
    const { patientId, episodeId } = await seedPatientAndEpisode('bypass');
    const res = await request(app)
      .post(`/api/v1/patients/${patientId}/notes`)
      .set('Authorization', `Bearer ${session.token}`)
      .set('X-Client', 'mobile')
      .send({
        episodeId,
        title: `${TEST_TAG} bypass create-sign`,
        noteType: 'progress',
        content: `${TEST_TAG} content`,
        status: 'signed',
        firstVisitChartReview: firstVisitChartReviewPayload(),
      });
    expect(res.status).toBe(201);
    await upsertBypassFlag(false);
  });

  it('allows second signed psychiatric note even without a fresh risk assessment', async () => {
    await upsertBypassFlag(true);
    const { patientId, episodeId } = await seedPatientAndEpisode('second-note');

    const first = await request(app)
      .post(`/api/v1/patients/${patientId}/notes`)
      .set('Authorization', `Bearer ${session.token}`)
      .set('X-Client', 'mobile')
      .send({
        episodeId,
        title: `${TEST_TAG} first signed via bypass`,
        noteType: 'progress',
        content: `${TEST_TAG} first`,
        status: 'signed',
        firstVisitChartReview: firstVisitChartReviewPayload(),
      });
    expect(first.status).toBe(201);

    await upsertBypassFlag(false);
    const second = await request(app)
      .post(`/api/v1/patients/${patientId}/notes`)
      .set('Authorization', `Bearer ${session.token}`)
      .set('X-Client', 'mobile')
      .send({
        episodeId,
        title: `${TEST_TAG} second signed no fresh risk`,
        noteType: 'progress',
        content: `${TEST_TAG} second`,
        status: 'signed',
        firstVisitChartReview: firstVisitChartReviewPayload(),
      });
    expect(second.status).toBe(201);
  });
});
