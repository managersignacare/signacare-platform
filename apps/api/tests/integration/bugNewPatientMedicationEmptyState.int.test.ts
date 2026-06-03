import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { authedAgent, isIntegrationReady, loginAsClinician } from './_helpers';

const READY = await isIntegrationReady();
const RUN_TAG = `NEW_PATIENT_MEDS_${process.pid}_${Date.now().toString(36)}`;

describe.skipIf(!READY)('BUG — new patient medication surfaces should return empty, not error', () => {
  let token = '';
  const createdPatientIds: string[] = [];

  beforeAll(async () => {
    ({ token } = await loginAsClinician());
  });

  afterAll(async () => {
    if (createdPatientIds.length === 0) return;
    const { dbAdmin } = await import('../../src/db/db');
    await dbAdmin('patient_team_assignments')
      .whereIn('patient_id', createdPatientIds)
      .delete()
      .catch(() => undefined);
    await dbAdmin('patients')
      .whereIn('id', createdPatientIds)
      .delete()
      .catch(() => undefined);
  });

  it('clinician can open medications + clozapine read rails for a newly-created patient with no meds', async () => {
    const agent = authedAgent(token);
    const createRes = await agent.post('/api/v1/patients').send({
      givenName: 'NoMeds',
      familyName: RUN_TAG,
      dateOfBirth: '1991-04-15',
    });

    expect(createRes.status).toBe(201);
    const patientId = String(createRes.body?.id ?? '');
    expect(patientId).toMatch(/^[0-9a-f-]{36}$/i);
    createdPatientIds.push(patientId);

    const medsRes = await agent.get(`/api/v1/medications/patients/${patientId}/medications`);
    expect(medsRes.status).toBe(200);
    expect(Array.isArray(medsRes.body)).toBe(true);
    expect(medsRes.body).toHaveLength(0);

    const clozRes = await agent.get(`/api/v1/clozapine/patients/${patientId}/clozapine`);
    expect(clozRes.status).toBe(200);
    expect(Array.isArray(clozRes.body)).toBe(true);
    expect(clozRes.body).toHaveLength(0);
  });
});

