/**
 * BUG-N1 — UC.016 patient-details write-back request contract
 * (`/prescriptions/hi/update-ihi-details`).
 *
 * This suite pins API-boundary behavior:
 * - requires patientId + IHI + demographic core
 * - enforces Medicare pair semantics
 * - returns structured write-back result (success boolean) without
 *   throwing runtime errors when HI service is offline.
 */

import { beforeAll, describe, expect, it } from 'vitest';
import { authedAgent, isIntegrationReady, loginAsClinician } from './_helpers';

const READY = await isIntegrationReady();

describe.skipIf(!READY)('BUG-N1 /prescriptions/hi/update-ihi-details request contract', () => {
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
    if (!patient) throw new Error('BUG-N1 test patient fixture missing');
    patientId = patient.id;
  });

  it('T1 — missing Medicare IRN when Medicare number supplied is rejected (422)', async () => {
    const agent = authedAgent(token);
    const res = await agent.post('/api/v1/prescriptions/hi/update-ihi-details').send({
      patientId,
      ihi: '8003608833357361',
      familyName: 'Smith',
      givenName: 'Jane',
      dateOfBirth: '1985-01-01',
      gender: 'F',
      medicareNumber: '29500003411',
    });
    expect(res.status).toBe(422);
  });

  it('T2 — malformed IHI is rejected at schema boundary (422)', async () => {
    const agent = authedAgent(token);
    const res = await agent.post('/api/v1/prescriptions/hi/update-ihi-details').send({
      patientId,
      ihi: '123',
      familyName: 'Smith',
      givenName: 'Jane',
      dateOfBirth: '1985-01-01',
      gender: 'F',
    });
    expect(res.status).toBe(422);
  });

  it('T3 — valid request reaches service and returns structured result', async () => {
    const agent = authedAgent(token);
    const res = await agent.post('/api/v1/prescriptions/hi/update-ihi-details').send({
      patientId,
      ihi: '8003608833357361',
      familyName: 'Smith',
      givenName: 'Jane',
      dateOfBirth: '1985-01-01',
      gender: 'F',
      medicareNumber: '29500003411',
      medicareIrn: '1',
    });
    expect(res.status).toBe(200);
    expect(typeof res.body.success).toBe('boolean');
    if (res.body.success === false) {
      expect(typeof res.body.error).toBe('string');
    }
  });
});
