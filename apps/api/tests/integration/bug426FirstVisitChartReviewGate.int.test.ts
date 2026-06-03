import { randomUUID } from 'crypto';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { FIRST_VISIT_CHART_REVIEW_BYPASS_FLAG } from '@signacare/shared';
import app from '../../src/server';
import { dbAdmin } from '../../src/db/db';
import { _resetFeatureFlagCache } from '../../src/shared/featureFlags';
import { isIntegrationReady, loginAsAdmin } from './_helpers';

const READY = await isIntegrationReady();
const TEST_TAG = `BUG-426-${Date.now()}`;

let session: { token: string; clinicId: string; userId: string };
const createdPatientIds: string[] = [];
const createdEpisodeIds: string[] = [];

type SeededFixture = {
  patientId: string;
  episodeId: string;
};

async function upsertBypassFlag(enabled: boolean): Promise<void> {
  const existing = await dbAdmin('feature_flags')
    .where({ clinic_id: session.clinicId, name: FIRST_VISIT_CHART_REVIEW_BYPASS_FLAG })
    .first('id');

  if (existing) {
    await dbAdmin('feature_flags')
      .where({ id: existing.id })
      .update({ enabled, rollout_percentage: enabled ? 100 : 0 });
  } else {
    await dbAdmin('feature_flags').insert({
      id: randomUUID(),
      clinic_id: session.clinicId,
      name: FIRST_VISIT_CHART_REVIEW_BYPASS_FLAG,
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
    given_name: 'Bug426',
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
  await dbAdmin('clinical_note_versions')
    .whereRaw('snapshot::text ILIKE ?', [`%${TEST_TAG}%`])
    .del()
    .catch(() => undefined);
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

describe.skipIf(!READY)('BUG-426 — first-visit chart review sign gate', () => {
  it('blocks first signed encounter note when chart-review attestation is missing', async () => {
    const { patientId, episodeId } = await seedPatientAndEpisode('blocked');
    await seedRiskAssessment(patientId, episodeId, new Date());
    const res = await request(app)
      .post(`/api/v1/patients/${patientId}/notes`)
      .set('Authorization', `Bearer ${session.token}`)
      .set('X-Client', 'mobile')
      .send({
        episodeId,
        title: `${TEST_TAG} first signed note`,
        noteType: 'progress',
        content: `${TEST_TAG} content`,
        status: 'signed',
      });

    expect(res.status).toBe(409);
    expect(res.body.code).toBe('FIRST_VISIT_CHART_REVIEW_REQUIRED');
  });

  it('accepts first signed encounter note with full chart-review attestation and persists evidence', async () => {
    const { patientId, episodeId } = await seedPatientAndEpisode('attested');
    await seedRiskAssessment(patientId, episodeId, new Date());
    const reviewedAt = new Date().toISOString();
    const first = await request(app)
      .post(`/api/v1/patients/${patientId}/notes`)
      .set('Authorization', `Bearer ${session.token}`)
      .set('X-Client', 'mobile')
      .send({
        episodeId,
        title: `${TEST_TAG} attested first note`,
        noteType: 'progress',
        content: `${TEST_TAG} attested content`,
        status: 'signed',
        firstVisitChartReview: {
          recentLabsReviewed: true,
          recentImagingReviewed: true,
          recentMedicationsReviewed: true,
          reviewedAt,
        },
      });

    expect(first.status).toBe(201);
    expect(first.body.note?.status).toBe('signed');

    const noteId = String(first.body.note?.id);
    const row = await dbAdmin('clinical_notes')
      .where({ id: noteId, clinic_id: session.clinicId })
      .select('contact_meta')
      .first();
    const meta =
      typeof row?.contact_meta === 'string'
        ? (JSON.parse(row.contact_meta) as Record<string, unknown>)
        : (row?.contact_meta as Record<string, unknown>);
    const attestation = (meta?.firstVisitChartReview ?? {}) as Record<string, unknown>;
    expect(attestation.recentLabsReviewed).toBe(true);
    expect(attestation.recentImagingReviewed).toBe(true);
    expect(attestation.recentMedicationsReviewed).toBe(true);
    expect(attestation.reviewedByStaffId).toBe(session.userId);

    const second = await request(app)
      .post(`/api/v1/patients/${patientId}/notes`)
      .set('Authorization', `Bearer ${session.token}`)
      .set('X-Client', 'mobile')
      .send({
        episodeId,
        title: `${TEST_TAG} second signed note`,
        noteType: 'progress',
        content: `${TEST_TAG} second content`,
        status: 'signed',
      });
    expect(second.status).toBe(201);
    expect(second.body.note?.status).toBe('signed');
  });

  it('allows first signed encounter note without attestation when bypass flag is enabled', async () => {
    await upsertBypassFlag(true);
    const { patientId, episodeId } = await seedPatientAndEpisode('bypass');
    await seedRiskAssessment(patientId, episodeId, new Date());
    const res = await request(app)
      .post(`/api/v1/patients/${patientId}/notes`)
      .set('Authorization', `Bearer ${session.token}`)
      .set('X-Client', 'mobile')
      .send({
        episodeId,
        title: `${TEST_TAG} bypass signed note`,
        noteType: 'progress',
        content: `${TEST_TAG} bypass content`,
        status: 'signed',
      });
    expect(res.status).toBe(201);
    expect(res.body.note?.status).toBe('signed');
    await upsertBypassFlag(false);
  });
});
