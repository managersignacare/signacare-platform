import { randomUUID } from 'crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import app from '../../src/server';
import { dbAdmin } from '../../src/db/db';
import { isIntegrationReady, loginAsAdmin } from './_helpers';

const ready = await isIntegrationReady();

describe.skipIf(!ready)('BUG-E2E pathway aggregate list route', () => {
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

    await withClinicContext(session.clinicId, async (trx) => {
      await trx('patients').insert({
        id: patientId,
        clinic_id: session.clinicId,
        given_name: 'Pathway',
        family_name: `ListAll-${Date.now()}`,
        emr_number: `LISTALL-${Date.now()}`,
        date_of_birth: '1985-01-01',
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
          completedSessions: 1,
          startDate: '2026-01-01',
        }),
        created_at: new Date(),
        updated_at: new Date(),
      });
    });
  });

  afterAll(async () => {
    if (!ready) return;
    if (!pathwayId && !patientId) return;
    await withClinicContext(session.clinicId, async (trx) => {
      await trx('treatment_pathways').where({ id: pathwayId }).del();
      await trx('patients').where({ id: patientId }).del();
    });
  });

  it('GET /api/v1/pathways/patient/all returns array response and does not treat "all" as a patient id', async () => {
    const res = await request(app)
      .get('/api/v1/pathways/patient/all')
      .set('Authorization', `Bearer ${session.token}`)
      .set('X-Client', 'mobile')
      .set('X-CSRF-Token', 'test');

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    const found = (res.body as Array<{ id: string }>).some((row) => row.id === pathwayId);
    expect(found).toBe(true);
  });
});
