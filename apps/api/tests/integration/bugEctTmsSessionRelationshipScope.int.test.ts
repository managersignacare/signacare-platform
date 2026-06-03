import { randomUUID } from 'crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import app from '../../src/server';
import { dbAdmin } from '../../src/db/db';
import { CANONICAL_CLINIC_IDS, CANONICAL_PERSONAS } from '../fixtures/canonical-personas';
import { isIntegrationReady, loginAsAdmin } from './_helpers';
import { withTenantContext } from '../../src/shared/tenantContext';

const READY = await isIntegrationReady();

type Session = {
  token: string;
  clinicId: string;
  userId: string;
};

let primaryAdmin: Session;

const primaryPatientId = randomUUID();
const secondaryPatientId = randomUUID();
const primaryEpisodeId = randomUUID();
const secondaryEpisodeId = randomUUID();
const primaryEctCourseId = randomUUID();
const secondaryEctCourseId = randomUUID();
const primaryTmsCourseId = randomUUID();
const secondaryTmsCourseId = randomUUID();

function authHeaders(token: string): Record<string, string> {
  return {
    Authorization: `Bearer ${token}`,
    'X-CSRF-Token': 'test',
    'X-Client': 'mobile',
  };
}

beforeAll(async () => {
  if (!READY) return;

  primaryAdmin = await loginAsAdmin();

  const now = new Date();

  await withTenantContext(CANONICAL_CLINIC_IDS.primary, async () => {
    await dbAdmin('patients').insert({
      id: primaryPatientId,
      clinic_id: CANONICAL_CLINIC_IDS.primary,
      given_name: 'BugEctTms',
      family_name: `Primary-${Date.now()}`,
      emr_number: `ECTTMS-PRI-${Date.now()}`,
      date_of_birth: '1988-01-01',
      created_at: now,
      updated_at: now,
    });
  });
  await withTenantContext(CANONICAL_CLINIC_IDS.secondary, async () => {
    await dbAdmin('patients').insert({
      id: secondaryPatientId,
      clinic_id: CANONICAL_CLINIC_IDS.secondary,
      given_name: 'BugEctTms',
      family_name: `Secondary-${Date.now()}`,
      emr_number: `ECTTMS-SEC-${Date.now()}`,
      date_of_birth: '1989-01-01',
      created_at: now,
      updated_at: now,
    });
  });

  await withTenantContext(CANONICAL_CLINIC_IDS.primary, async () => {
    await dbAdmin('episodes').insert({
      id: primaryEpisodeId,
      clinic_id: CANONICAL_CLINIC_IDS.primary,
      patient_id: primaryPatientId,
      primary_clinician_id: CANONICAL_PERSONAS.superadmin.id,
      episode_type: 'intake',
      presenting_problem: 'ECT/TMS relationship integration guard',
      status: 'open',
      start_date: now,
      created_at: now,
      updated_at: now,
    });
  });
  await withTenantContext(CANONICAL_CLINIC_IDS.secondary, async () => {
    await dbAdmin('episodes').insert({
      id: secondaryEpisodeId,
      clinic_id: CANONICAL_CLINIC_IDS.secondary,
      patient_id: secondaryPatientId,
      primary_clinician_id: CANONICAL_PERSONAS.otherClinicClinician.id,
      episode_type: 'intake',
      presenting_problem: 'ECT/TMS relationship integration guard',
      status: 'open',
      start_date: now,
      created_at: now,
      updated_at: now,
    });
  });

  await withTenantContext(CANONICAL_CLINIC_IDS.primary, async () => {
    await dbAdmin('ect_courses').insert({
      id: primaryEctCourseId,
      clinic_id: CANONICAL_CLINIC_IDS.primary,
      patient_id: primaryPatientId,
      episode_id: primaryEpisodeId,
      treating_psychiatrist_id: CANONICAL_PERSONAS.clinician.id,
      consent_obtained: true,
      consent_date: now,
      consent_recorded_by: CANONICAL_PERSONAS.clinician.id,
      total_planned_sessions: 12,
      indication: 'Major depression',
      status: 'planned',
      created_at: now,
      updated_at: now,
    });
  });
  await withTenantContext(CANONICAL_CLINIC_IDS.secondary, async () => {
    await dbAdmin('ect_courses').insert({
      id: secondaryEctCourseId,
      clinic_id: CANONICAL_CLINIC_IDS.secondary,
      patient_id: secondaryPatientId,
      episode_id: secondaryEpisodeId,
      treating_psychiatrist_id: CANONICAL_PERSONAS.otherClinicClinician.id,
      consent_obtained: true,
      consent_date: now,
      consent_recorded_by: CANONICAL_PERSONAS.otherClinicClinician.id,
      total_planned_sessions: 10,
      indication: 'Severe depression',
      status: 'planned',
      created_at: now,
      updated_at: now,
    });
  });

  await withTenantContext(CANONICAL_CLINIC_IDS.primary, async () => {
    await dbAdmin('tms_courses').insert({
      id: primaryTmsCourseId,
      clinic_id: CANONICAL_CLINIC_IDS.primary,
      patient_id: primaryPatientId,
      episode_id: primaryEpisodeId,
      treating_psychiatrist_id: CANONICAL_PERSONAS.clinician.id,
      protocol: 'standard',
      target_area: 'left_dlpfc',
      total_planned_sessions: 20,
      motor_threshold_percent: 90,
      consent_obtained: true,
      consent_date: now,
      consent_recorded_by: CANONICAL_PERSONAS.clinician.id,
      indication: 'Treatment resistant depression',
      status: 'planned',
      created_at: now,
      updated_at: now,
    });
  });
  await withTenantContext(CANONICAL_CLINIC_IDS.secondary, async () => {
    await dbAdmin('tms_courses').insert({
      id: secondaryTmsCourseId,
      clinic_id: CANONICAL_CLINIC_IDS.secondary,
      patient_id: secondaryPatientId,
      episode_id: secondaryEpisodeId,
      treating_psychiatrist_id: CANONICAL_PERSONAS.otherClinicClinician.id,
      protocol: 'standard',
      target_area: 'left_dlpfc',
      total_planned_sessions: 20,
      motor_threshold_percent: 95,
      consent_obtained: true,
      consent_date: now,
      consent_recorded_by: CANONICAL_PERSONAS.otherClinicClinician.id,
      indication: 'Treatment resistant depression',
      status: 'planned',
      created_at: now,
      updated_at: now,
    });
  });
});

afterAll(async () => {
  if (!READY) return;

  await withTenantContext(CANONICAL_CLINIC_IDS.primary, async () => {
    await dbAdmin('ect_sessions').where({ course_id: primaryEctCourseId }).del().catch(() => undefined);
    await dbAdmin('tms_sessions').where({ course_id: primaryTmsCourseId }).del().catch(() => undefined);
    await dbAdmin('ect_courses').where({ id: primaryEctCourseId }).del().catch(() => undefined);
    await dbAdmin('tms_courses').where({ id: primaryTmsCourseId }).del().catch(() => undefined);
    await dbAdmin('episodes').where({ id: primaryEpisodeId }).del().catch(() => undefined);
    await dbAdmin('patients').where({ id: primaryPatientId }).del().catch(() => undefined);
  });
  await withTenantContext(CANONICAL_CLINIC_IDS.secondary, async () => {
    await dbAdmin('ect_sessions').where({ course_id: secondaryEctCourseId }).del().catch(() => undefined);
    await dbAdmin('tms_sessions').where({ course_id: secondaryTmsCourseId }).del().catch(() => undefined);
    await dbAdmin('ect_courses').where({ id: secondaryEctCourseId }).del().catch(() => undefined);
    await dbAdmin('tms_courses').where({ id: secondaryTmsCourseId }).del().catch(() => undefined);
    await dbAdmin('episodes').where({ id: secondaryEpisodeId }).del().catch(() => undefined);
    await dbAdmin('patients').where({ id: secondaryPatientId }).del().catch(() => undefined);
  });
});

describe.skipIf(!READY)('BUG-ECT/TMS family — session lineage and clinic-scope matrix', () => {
  it('ECT: own-clinic admin can record session on own course', async () => {
    const res = await request(app)
      .post(`/api/v1/ect/courses/${primaryEctCourseId}/sessions`)
      .set(authHeaders(primaryAdmin.token))
      .send({
        sessionDate: '2026-05-14',
        stimulusDoseMc: 150,
        seizureDurationSec: 28,
        electrodePlacement: 'bilateral',
      });

    expect(res.status).toBe(201);
    expect(res.body.course_id ?? res.body.courseId).toBe(primaryEctCourseId);
  });

  it('ECT: cross-clinic course id is not resolvable from primary clinic context', async () => {
    const res = await request(app)
      .post(`/api/v1/ect/courses/${secondaryEctCourseId}/sessions`)
      .set(authHeaders(primaryAdmin.token))
      .send({
        sessionDate: '2026-05-14',
        stimulusDoseMc: 140,
      });

    expect(res.status).toBe(404);
    expect(res.body?.code ?? res.body?.error?.code).toBe('NOT_FOUND');
  });

  it('TMS: own-clinic admin can record session on own course', async () => {
    const res = await request(app)
      .post(`/api/v1/tms/courses/${primaryTmsCourseId}/sessions`)
      .set(authHeaders(primaryAdmin.token))
      .send({
        sessionDate: '2026-05-14',
        pulsesDelivered: 3000,
        intensityPercent: 100,
        patientTolerance: 'good',
      });

    expect(res.status).toBe(201);
    expect(res.body.course_id ?? res.body.courseId).toBe(primaryTmsCourseId);
  });

  it('TMS: cross-clinic course id is not resolvable from primary clinic context', async () => {
    const res = await request(app)
      .post(`/api/v1/tms/courses/${secondaryTmsCourseId}/sessions`)
      .set(authHeaders(primaryAdmin.token))
      .send({
        sessionDate: '2026-05-14',
        pulsesDelivered: 2800,
      });

    expect(res.status).toBe(404);
    expect(res.body?.code ?? res.body?.error?.code).toBe('NOT_FOUND');
  });

  it('ECT: own-clinic admin cannot read foreign-course sessions by ID', async () => {
    const res = await request(app)
      .get(`/api/v1/ect/courses/${secondaryEctCourseId}/sessions`)
      .set(authHeaders(primaryAdmin.token));

    expect(res.status).toBe(404);
    expect(res.body?.code ?? res.body?.error?.code).toBe('NOT_FOUND');
  });

  it('TMS: own-clinic admin cannot read foreign-course sessions by ID', async () => {
    const res = await request(app)
      .get(`/api/v1/tms/courses/${secondaryTmsCourseId}/sessions`)
      .set(authHeaders(primaryAdmin.token));

    expect(res.status).toBe(404);
    expect(res.body?.code ?? res.body?.error?.code).toBe('NOT_FOUND');
  });
});
