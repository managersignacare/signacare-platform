import { randomUUID } from 'crypto';
import jwt from 'jsonwebtoken';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import app from '../../src/server';
import { config } from '../../src/config';
import { dbAdmin } from '../../src/db/db';
import { primeIdleWindow } from '../../src/middleware/sessionIdleMiddleware';
import { withTenantContext } from '../../src/shared/tenantContext';
import { isIntegrationReady } from './_helpers';
import { CANONICAL_CLINIC_IDS, CANONICAL_PERSONAS } from '../fixtures/canonical-personas';

const READY = await isIntegrationReady();

function authHeaders(token: string): Record<string, string> {
  return {
    Authorization: `Bearer ${token}`,
    'X-CSRF-Token': 'test',
    'X-Client': 'mobile',
  };
}

describe.skipIf(!READY)('medication module write access regression', () => {
  const clinicId = CANONICAL_CLINIC_IDS.primary;
  const clinician = CANONICAL_PERSONAS.clinician;
  const patientId = randomUUID();
  const patientTeamAssignmentId = randomUUID();
  let orgUnitId = '';
  let originalHpii: string | null = null;
  const createdMedicationIds: string[] = [];

  beforeAll(async () => {
    await withTenantContext(clinicId, async () => {
      const orgUnit = await dbAdmin('org_units')
        .where({ clinic_id: clinicId })
        .orderBy('created_at', 'asc')
        .first('id');
      if (!orgUnit?.id) {
        throw new Error('No org unit found in canonical clinic for medication write-access regression test');
      }
      orgUnitId = orgUnit.id as string;

      const clinicianRow = await dbAdmin('staff')
        .where({ id: clinician.id })
        .first('hpii');
      originalHpii = (clinicianRow?.hpii as string | null | undefined) ?? null;
      if (originalHpii !== '8003611234567893') {
        await dbAdmin('staff')
          .where({ id: clinician.id })
          .update({ hpii: '8003611234567893', updated_at: new Date() });
      }

      await dbAdmin('patients').insert({
        id: patientId,
        clinic_id: clinicId,
        given_name: 'Medication',
        family_name: 'Write Access',
        emr_number: `MED-WRITE-${Date.now()}`,
        date_of_birth: '1990-01-01',
        created_at: new Date(),
        updated_at: new Date(),
      });

      await dbAdmin('patient_team_assignments').insert({
        id: patientTeamAssignmentId,
        patient_id: patientId,
        org_unit_id: orgUnitId,
        primary_clinician_id: clinician.id,
        is_active: true,
      });
    });
  });

  afterAll(async () => {
    await withTenantContext(clinicId, async () => {
      if (createdMedicationIds.length > 0) {
        await dbAdmin('patient_medications')
          .whereIn('id', createdMedicationIds)
          .delete()
          .catch(() => undefined);
      }
      await dbAdmin('patient_team_assignments')
        .where({ id: patientTeamAssignmentId })
        .delete()
        .catch(() => undefined);
      await dbAdmin('patients')
        .where({ id: patientId })
        .delete()
        .catch(() => undefined);
      await dbAdmin('staff')
        .where({ id: clinician.id })
        .update({ hpii: originalHpii, updated_at: new Date() })
        .catch(() => undefined);
    });
  });

  it('allows prescribing with module write permission even when the JWT does not include medication:read', async () => {
    const token = jwt.sign(
      {
        id: clinician.id,
        clinicId,
        role: 'clinician',
        permissions: ['medication:create'],
        givenName: clinician.givenName,
        familyName: clinician.familyName,
        email: clinician.email,
      },
      config.jwt.accessSecret,
      { expiresIn: '60m' },
    );
    await primeIdleWindow(clinician.id, 120);

    const res = await request(app)
      .post('/api/v1/medications')
      .set(authHeaders(token))
      .send({
        patientId,
        medicationName: 'Olanzapine',
        dose: '5 mg',
        frequency: 'once daily',
        route: 'oral',
      });

    expect(res.status).toBe(201);
    expect(res.body?.code).not.toBe('MODULE_READ_DENIED');
    expect(typeof res.body?.id).toBe('string');
    createdMedicationIds.push(res.body.id as string);
  });
});
