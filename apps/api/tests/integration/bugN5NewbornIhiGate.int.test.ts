/**
 * BUG-N5 — Create Verified IHI for Newborns gate.
 *
 * Pre-deployment posture is explicit fail-closed until maternity spike
 * approval enables the workflow.
 */

import { beforeAll, describe, expect, it } from 'vitest';
import { authedAgent, isIntegrationReady, loginAsClinician } from './_helpers';

const READY = await isIntegrationReady();

describe.skipIf(!READY)('BUG-N5 /prescriptions/hi/create-newborn-ihi gate', () => {
  let token: string;
  let patientId: string;

  beforeAll(async () => {
    const session = await loginAsClinician();
    token = session.token;
    const { dbAdmin } = await import('../../src/db/db');
    const patient = await dbAdmin('patients')
      .where({ clinic_id: session.clinicId })
      .whereNull('deleted_at')
      .select('id')
      .first() as { id: string } | undefined;
    if (!patient) throw new Error('BUG-N5 test patient fixture missing');
    patientId = patient.id;
  });

  it('T1 — Medicare pair must be complete (422)', async () => {
    const agent = authedAgent(token);
    const res = await agent.post('/api/v1/prescriptions/hi/create-newborn-ihi').send({
      patientId,
      newbornFamilyName: 'Smith',
      newbornGivenName: 'Baby',
      dateOfBirth: '2026-05-01',
      gender: 'F',
      motherIhi: '8003608833357361',
      motherMedicareNumber: '29500003411',
    });
    expect(res.status).toBe(422);
  });

  it('T2 — valid request returns explicit fail-closed result when feature is disabled', async () => {
    const agent = authedAgent(token);
    const res = await agent.post('/api/v1/prescriptions/hi/create-newborn-ihi').send({
      patientId,
      newbornFamilyName: 'Smith',
      newbornGivenName: 'Baby',
      dateOfBirth: '2026-05-01',
      gender: 'F',
      motherIhi: '8003608833357361',
      motherMedicareNumber: '29500003411',
      motherMedicareIrn: '1',
    });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(false);
    expect(res.body.statusCode).toBe(501);
  });
});
