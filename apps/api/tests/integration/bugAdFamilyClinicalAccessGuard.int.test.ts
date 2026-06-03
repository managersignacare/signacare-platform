import { randomUUID } from 'crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import app from '../../src/server';
import { dbAdmin } from '../../src/db/db';
import { CANONICAL_PASSWORD, CANONICAL_PERSONAS } from '../fixtures/canonical-personas';
import { isIntegrationReady, loginAsClinician } from './_helpers';

const READY = await isIntegrationReady();

let clinicianSession: { token: string; clinicId: string; userId: string };
let receptionistToken = '';
let patientId = '';
let episodeId = '';
let directiveId = '';
let directiveLockVersion = 0;

async function loginAsReceptionist(): Promise<string> {
  const res = await request(app)
    .post('/api/v1/auth/login')
    .set('X-CSRF-Token', 'test')
    .set('X-Client', 'mobile')
    .send({
      email: CANONICAL_PERSONAS.receptionist.email,
      password: CANONICAL_PASSWORD,
    });

  expect(res.status).toBe(200);
  expect(typeof res.body?.accessToken).toBe('string');
  return res.body.accessToken as string;
}

beforeAll(async () => {
  if (!READY) return;
  const clinician = await loginAsClinician();
  clinicianSession = { token: clinician.token, clinicId: clinician.clinicId, userId: clinician.userId };
  receptionistToken = await loginAsReceptionist();

  patientId = randomUUID();
  await dbAdmin('patients').insert({
    id: patientId,
    clinic_id: clinicianSession.clinicId,
    given_name: 'BugAdFamily',
    family_name: `ClinicalAccess-${Date.now()}`,
    emr_number: `BUGAD-${Date.now()}`,
    date_of_birth: '1990-01-01',
    created_at: new Date(),
    updated_at: new Date(),
  });
  episodeId = randomUUID();
  await dbAdmin('episodes').insert({
    id: episodeId,
    clinic_id: clinicianSession.clinicId,
    patient_id: patientId,
    primary_clinician_id: clinicianSession.userId,
    episode_type: 'triage',
    presenting_problem: 'advance-directive relationship fixture',
    status: 'open',
    start_date: new Date(),
    created_at: new Date(),
    updated_at: new Date(),
  });

  const createRes = await request(app)
    .post('/api/v1/advance-directives')
    .set('Authorization', `Bearer ${clinicianSession.token}`)
    .set('X-Client', 'mobile')
    .set('X-CSRF-Token', 'test')
    .send({
      patientId,
      type: 'mental_health_advance_directive',
      status: 'active',
      treatmentPreferences: 'baseline fixture',
    });
  expect(createRes.status).toBe(201);
  directiveId = createRes.body.id as string;
  directiveLockVersion = Number(createRes.body.lockVersion ?? 1);
});

afterAll(async () => {
  if (!READY) return;
  await dbAdmin('advance_directives').where({ patient_id: patientId }).del();
  if (episodeId) {
    await dbAdmin('episodes').where({ id: episodeId }).del().catch(() => undefined);
  }
  await dbAdmin('patients').where({ id: patientId }).del();
});

describe.skipIf(!READY)('BUG-AD family — advance-directive operational-role block', () => {
  it('rejects receptionist GET with CLINICAL_ACCESS_DENIED', async () => {
    const res = await request(app)
      .get(`/api/v1/advance-directives/patient/${patientId}`)
      .set('Authorization', `Bearer ${receptionistToken}`)
      .set('X-Client', 'mobile')
      .set('X-CSRF-Token', 'test');

    expect(res.status).toBe(403);
    expect(res.body?.code ?? res.body?.error?.code).toBe('CLINICAL_ACCESS_DENIED');
  });

  it('rejects receptionist POST with CLINICAL_ACCESS_DENIED', async () => {
    const res = await request(app)
      .post('/api/v1/advance-directives')
      .set('Authorization', `Bearer ${receptionistToken}`)
      .set('X-Client', 'mobile')
      .set('X-CSRF-Token', 'test')
      .send({
        patientId,
        type: 'mental_health_advance_directive',
        status: 'active',
        treatmentPreferences: 'should not be accepted',
      });

    expect(res.status).toBe(403);
    expect(res.body?.code ?? res.body?.error?.code).toBe('CLINICAL_ACCESS_DENIED');
  });

  it('rejects receptionist PATCH with CLINICAL_ACCESS_DENIED', async () => {
    const res = await request(app)
      .patch(`/api/v1/advance-directives/${directiveId}`)
      .set('Authorization', `Bearer ${receptionistToken}`)
      .set('X-Client', 'mobile')
      .set('X-CSRF-Token', 'test')
      .send({
        expectedLockVersion: directiveLockVersion,
        notes: 'unauthorized receptionist update',
      });

    expect(res.status).toBe(403);
    expect(res.body?.code ?? res.body?.error?.code).toBe('CLINICAL_ACCESS_DENIED');
  });
});
