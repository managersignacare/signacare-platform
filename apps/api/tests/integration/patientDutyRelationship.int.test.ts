import { randomUUID } from 'crypto';
import request from 'supertest';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { AuthContext, Role } from '@signacare/shared';
import { ROLE_PERMISSIONS } from '@signacare/shared';
import app from '../../src/server';
import { isIntegrationReady, loginAsAdmin } from './_helpers';
import { issueTokens } from '../../src/features/auth/authService';
import { requirePatientRelationship } from '../../src/shared/authGuards';
import { withTenantContext } from '../../src/shared/tenantContext';

const READY = await isIntegrationReady();

type StaffSeed = {
  id: string;
  role: Role;
  given_name: string;
  family_name: string;
  email: string;
};

describe.skipIf(!READY)('patient duty relationships', () => {
  let clinicId: string;
  let patientId: string;
  let clinicianStaffId: string;
  let prescriberStaffId: string;
  let clinicianToken: string;
  let prescriberToken: string;

  async function mintToken(staff: StaffSeed): Promise<string> {
    const { redis } = await import('../../src/config/redis');
    const { accessToken } = issueTokens({
      id: staff.id,
      clinicId,
      role: staff.role,
      permissions: ROLE_PERMISSIONS[staff.role] ?? [],
      email: staff.email,
      givenName: staff.given_name,
      familyName: staff.family_name,
    });
    await redis.set(`idle:${staff.id}`, '1', 'EX', 60 * 60);
    return accessToken;
  }

  function authHeader(token: string) {
    return {
      Authorization: `Bearer ${token}`,
      'X-CSRF-Token': 'test',
      'X-Client': 'mobile',
    };
  }

  function buildAuth(staffId: string, role: Role): AuthContext {
    return {
      staffId,
      clinicId,
      role,
      permissions: ROLE_PERMISSIONS[role] ?? [],
      patientId,
    };
  }

  beforeAll(async () => {
    const session = await loginAsAdmin();
    clinicId = session.clinicId;

    clinicianStaffId = randomUUID();
    prescriberStaffId = randomUUID();
    patientId = randomUUID();

    const clinicianStaff: StaffSeed = {
      id: clinicianStaffId,
      role: 'clinician',
      given_name: 'Duty',
      family_name: 'Clinician',
      email: `duty-clinician-${clinicianStaffId.slice(0, 6)}@signacare.local`,
    };

    const prescriberStaff: StaffSeed = {
      id: prescriberStaffId,
      role: 'prescriber_hmo',
      given_name: 'Duty',
      family_name: 'Prescriber',
      email: `duty-prescriber-${prescriberStaffId.slice(0, 6)}@signacare.local`,
    };

    const { dbAdmin } = await import('../../src/db/db');
    await dbAdmin('staff').insert([
      {
        id: clinicianStaff.id,
        clinic_id: clinicId,
        email: clinicianStaff.email,
        password_hash: 'stub',
        given_name: clinicianStaff.given_name,
        family_name: clinicianStaff.family_name,
        role: clinicianStaff.role,
        is_active: true,
      },
      {
        id: prescriberStaff.id,
        clinic_id: clinicId,
        email: prescriberStaff.email,
        password_hash: 'stub',
        given_name: prescriberStaff.given_name,
        family_name: prescriberStaff.family_name,
        role: prescriberStaff.role,
        is_active: true,
      },
    ]);

    await withTenantContext(clinicId, async () => {
      await dbAdmin('patients').insert({
        id: patientId,
        clinic_id: clinicId,
        given_name: 'Duty',
        family_name: 'Coverage',
        date_of_birth: '1985-06-12',
      });
    });

    clinicianToken = await mintToken(clinicianStaff);
    prescriberToken = await mintToken(prescriberStaff);
  });

  afterAll(async () => {
    const { dbAdmin } = await import('../../src/db/db');
    await dbAdmin('patient_duty_relationships')
      .where({ patient_id: patientId })
      .delete()
      .catch(() => undefined);
    await dbAdmin('patients')
      .where({ id: patientId })
      .delete()
      .catch(() => undefined);
    await dbAdmin('staff')
      .whereIn('id', [clinicianStaffId, prescriberStaffId])
      .update({
        is_active: false,
        deleted_at: new Date(),
        updated_at: new Date(),
      })
      .catch(() => undefined);
  });

  it('creates a duty clinician relationship, lists it, and unlocks the relationship guard', async () => {
    await expect(
      withTenantContext(clinicId, () =>
        requirePatientRelationship(buildAuth(clinicianStaffId, 'clinician'), patientId),
      ),
    ).rejects.toMatchObject({ status: 403, code: 'NO_PATIENT_RELATIONSHIP' });

    const createRes = await request(app)
      .post(`/api/v1/patients/${patientId}/duty-relationships`)
      .set(authHeader(clinicianToken))
      .send({
        relationshipType: 'duty_clinician',
        reason: 'Covering the patient on the Q team overnight shift.',
        expiresInHours: 8,
      });

    expect(createRes.status).toBe(201);
    expect(createRes.body.relationship.relationshipType).toBe('duty_clinician');
    expect(createRes.body.relationship.status).toBe('created');

    const listRes = await request(app)
      .get(`/api/v1/patients/${patientId}/duty-relationships/me`)
      .set(authHeader(clinicianToken));

    expect(listRes.status).toBe(200);
    expect(listRes.body.relationships).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          relationshipType: 'duty_clinician',
          reason: 'Covering the patient on the Q team overnight shift.',
        }),
      ]),
    );

    await expect(
      withTenantContext(clinicId, () =>
        requirePatientRelationship(buildAuth(clinicianStaffId, 'clinician'), patientId),
      ),
    ).resolves.toBeUndefined();

    const { dbAdmin } = await import('../../src/db/db');
    const auditRow = await dbAdmin('audit_log')
      .where({
        table_name: 'patient_duty_relationships',
        record_id: createRes.body.relationship.id,
      })
      .where('action', 'duty_relationship_granted')
      .orderBy('created_at', 'desc')
      .first('id', 'action');

    expect(auditRow).toBeDefined();
  });

  it('rejects duty prescriber for a non-prescriber clinician', async () => {
    const res = await request(app)
      .post(`/api/v1/patients/${patientId}/duty-relationships`)
      .set(authHeader(clinicianToken))
      .send({
        relationshipType: 'duty_prescriber',
        reason: 'Trying to prescribe while covering the Q team shift.',
        expiresInHours: 4,
      });

    expect(res.status).toBe(403);
    expect(res.body.code).toBe('DUTY_PRESCRIBER_ROLE_REQUIRED');
  });

  it('allows a prescriber-role user to create a duty prescriber relationship', async () => {
    const res = await request(app)
      .post(`/api/v1/patients/${patientId}/duty-relationships`)
      .set(authHeader(prescriberToken))
      .send({
        relationshipType: 'duty_prescriber',
        reason: 'Covering the Q team prescribing roster tonight.',
        expiresInHours: 12,
      });

    expect([200, 201]).toContain(res.status);
    expect(res.body.relationship.relationshipType).toBe('duty_prescriber');

    await expect(
      withTenantContext(clinicId, () =>
        requirePatientRelationship(buildAuth(prescriberStaffId, 'prescriber_hmo'), patientId),
      ),
    ).resolves.toBeUndefined();
  });
});
