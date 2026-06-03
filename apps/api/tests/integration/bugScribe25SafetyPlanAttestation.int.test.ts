import { randomUUID } from 'crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { authedAgent, isIntegrationReady, loginAsAdmin } from './_helpers';
import { dbAdmin } from '../../src/db/db';

const READY = await isIntegrationReady();

describe.skipIf(!READY)('BUG-SCRIBE25-002 — safety plan collaboration attestation gate', () => {
  let token = '';
  let clinicId = '';
  let patientId = '';

  const createdPlanIds: string[] = [];
  let createdPatientId: string | null = null;

  async function withClinicContext<T>(
    work: (trx: Awaited<ReturnType<typeof dbAdmin.transaction>>) => Promise<T>,
  ): Promise<T> {
    return dbAdmin.transaction(async (trx) => {
      await trx.raw("SELECT set_config('app.clinic_id', ?, true)", [clinicId]);
      return work(trx);
    });
  }

  beforeAll(async () => {
    const session = await loginAsAdmin();
    token = session.token;
    clinicId = session.clinicId;

    const existingPatient = await dbAdmin('patients')
      .where({ clinic_id: clinicId })
      .whereNull('deleted_at')
      .first('id');

    if (existingPatient?.id) {
      patientId = existingPatient.id as string;
      return;
    }

    const seededPatientId = randomUUID();
    await withClinicContext(async (trx) => {
      await trx('patients').insert({
        id: seededPatientId,
        clinic_id: clinicId,
        given_name: 'BugScribe25',
        family_name: 'SafetyPlan',
        date_of_birth: '1986-02-14',
        gender: 'female',
        created_at: new Date(),
        updated_at: new Date(),
      } as never);
    });
    patientId = seededPatientId;
    createdPatientId = seededPatientId;
  });

  afterAll(async () => {
    if (!READY) return;
    if (createdPlanIds.length > 0) {
      await withClinicContext(async (trx) => {
        await trx('safety_plans').whereIn('id', createdPlanIds).del();
      });
    }
    if (createdPatientId) {
      await withClinicContext(async (trx) => {
        await trx('patients').where({ id: createdPatientId }).del();
      });
    }
  });

  it('blocks active safety-plan create without collaboration attestation', async () => {
    const res = await authedAgent(token)
      .post('/api/v1/safety-plans')
      .send({
        patientId,
        content: {
          warning_signs: 'Escalating rumination, poor sleep, and suicidal thoughts.',
        },
      });

    expect(res.status).toBe(422);
    expect(res.body?.code).toBe('SAFETY_PLAN_COLLAB_ATTESTATION_REQUIRED');
  });

  it('allows create when collaboration attestation is supplied', async () => {
    const res = await authedAgent(token)
      .post('/api/v1/safety-plans')
      .send({
        patientId,
        content: {
          warning_signs: 'Escalating rumination.',
          emergency_services: 'Emergency: 000',
        },
        collaborationAttestation: {
          patientCollaborated: true,
          attestationNote: 'Reviewed step-by-step with patient; coping and contacts confirmed.',
        },
      });

    expect(res.status).toBe(201);
    expect(typeof res.body?.id).toBe('string');
    createdPlanIds.push(res.body.id as string);
    const sign = await authedAgent(token)
      .post(`/api/v1/safety-plans/${res.body.id as string}/sign`)
      .send({});
    expect(sign.status).toBe(200);
    expect(sign.body?.status).toBe('signed');
  });

  it('blocks sign-off when collaboration attestation is missing', async () => {
    const create = await authedAgent(token)
      .post('/api/v1/safety-plans')
      .send({
        patientId,
        status: 'draft',
        content: {
          warning_signs: 'Low mood and increasing hopelessness.',
        },
      });

    expect(create.status).toBe(201);
    const planId = create.body.id as string;
    createdPlanIds.push(planId);

    const sign = await authedAgent(token)
      .post(`/api/v1/safety-plans/${planId}/sign`)
      .send({});

    expect(sign.status).toBe(422);
    expect(sign.body?.code).toBe('SAFETY_PLAN_COLLAB_ATTESTATION_REQUIRED');
  });

  it('allows draft -> active transition only when attestation is present', async () => {
    const create = await authedAgent(token)
      .post('/api/v1/safety-plans')
      .send({
        patientId,
        status: 'draft',
        content: {
          warning_signs: 'Escalating anxiety and social withdrawal.',
        },
      });

    expect(create.status).toBe(201);
    const planId = create.body.id as string;
    createdPlanIds.push(planId);

    const activate = await authedAgent(token)
      .patch(`/api/v1/safety-plans/${planId}`)
      .send({
        status: 'active',
        collaborationAttestation: {
          patientCollaborated: true,
          attestationNote: 'Patient reviewed and agreed all six safety-plan steps during consultation.',
        },
      });

    expect(activate.status).toBe(200);
    expect(activate.body?.status).toBe('active');
  });
});
