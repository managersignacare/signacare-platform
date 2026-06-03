import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { randomUUID } from 'crypto';
import app from '../../src/server';
import { dbAdmin } from '../../src/db/db';
import { withTenantContext } from '../../src/shared/tenantContext';
import { isIntegrationReady, loginAsAdmin } from './_helpers';

const READY = await isIntegrationReady();
const TEST_LABEL = `BUG-ARCH-S0-1-${Date.now()}`;

let clinicAId = '';
let clinicASession: { token: string; clinicId: string; userId: string };
let clinicAOrgUnitId = '';
let clinicAPatientId = '';
let clinicAAssignmentId = '';
let clinicAAdminId = '';

let clinicBId = '';
let clinicBOrgUnitId = '';
let clinicBPatientId = '';
let clinicBAssignmentId = '';

describe.skipIf(!READY)('BUG-ARCH-S0-1 — escalations team-summary tenant scoping', () => {
  beforeAll(async () => {
    clinicASession = await loginAsAdmin();
    clinicAId = clinicASession.clinicId;
    clinicAAdminId = clinicASession.userId;

    clinicAOrgUnitId = randomUUID();
    clinicAPatientId = randomUUID();
    clinicAAssignmentId = randomUUID();

    await withTenantContext(clinicAId, async () => {
      await dbAdmin('org_units').insert({
        id: clinicAOrgUnitId,
        clinic_id: clinicAId,
        name: `${TEST_LABEL}-A-Team`,
        level: 'team',
        parent_id: null,
        sort_order: 1,
        is_active: true,
        created_at: new Date(),
        updated_at: new Date(),
      });
      await dbAdmin('patients').insert({
        id: clinicAPatientId,
        clinic_id: clinicAId,
        given_name: 'Escalation',
        family_name: 'TenantA',
        emr_number: `ESA-${Date.now()}`,
        date_of_birth: '1990-01-01',
        created_at: new Date(),
        updated_at: new Date(),
      });
      await dbAdmin('patient_team_assignments').insert({
        id: clinicAAssignmentId,
        patient_id: clinicAPatientId,
        org_unit_id: clinicAOrgUnitId,
        is_active: true,
        referral_status: 'new',
        created_at: new Date(),
        updated_at: new Date(),
      });
    }, clinicAAdminId);

    clinicBId = randomUUID();
    clinicBOrgUnitId = randomUUID();
    clinicBPatientId = randomUUID();
    clinicBAssignmentId = randomUUID();

    await withTenantContext(clinicAId, async () => {
      await dbAdmin('clinics').insert({
        id: clinicBId,
        name: `${TEST_LABEL}-ClinicB`,
        hpio: `800362${String(Date.now()).slice(-10)}`,
        created_at: new Date(),
        updated_at: new Date(),
      });
    }, clinicAAdminId);

    await withTenantContext(clinicBId, async () => {
      await dbAdmin('org_units').insert({
        id: clinicBOrgUnitId,
        clinic_id: clinicBId,
        name: `${TEST_LABEL}-B-Team`,
        level: 'team',
        parent_id: null,
        sort_order: 1,
        is_active: true,
        created_at: new Date(),
        updated_at: new Date(),
      });
      await dbAdmin('patients').insert({
        id: clinicBPatientId,
        clinic_id: clinicBId,
        given_name: 'Escalation',
        family_name: 'TenantB',
        emr_number: `ESB-${Date.now()}`,
        date_of_birth: '1991-01-01',
        created_at: new Date(),
        updated_at: new Date(),
      });
      await dbAdmin('patient_team_assignments').insert({
        id: clinicBAssignmentId,
        patient_id: clinicBPatientId,
        org_unit_id: clinicBOrgUnitId,
        is_active: true,
        referral_status: 'accepted',
        created_at: new Date(),
        updated_at: new Date(),
      });
    });
  });

  afterAll(async () => {
    if (!READY) return;
    if (clinicAId) {
      await withTenantContext(clinicAId, async () => {
        if (clinicAAssignmentId) {
          await dbAdmin('patient_team_assignments').where({ id: clinicAAssignmentId }).delete().catch(() => undefined);
        }
        if (clinicAPatientId) {
          await dbAdmin('patients').where({ id: clinicAPatientId }).delete().catch(() => undefined);
        }
        if (clinicAOrgUnitId) {
          await dbAdmin('org_units').where({ id: clinicAOrgUnitId }).delete().catch(() => undefined);
        }
      }, clinicAAdminId || undefined);
    }
    if (clinicBId) {
      await withTenantContext(clinicBId, async () => {
        if (clinicBAssignmentId) {
          await dbAdmin('patient_team_assignments').where({ id: clinicBAssignmentId }).delete().catch(() => undefined);
        }
        if (clinicBPatientId) {
          await dbAdmin('patients').where({ id: clinicBPatientId }).delete().catch(() => undefined);
        }
        if (clinicBOrgUnitId) {
          await dbAdmin('org_units').where({ id: clinicBOrgUnitId }).delete().catch(() => undefined);
        }
      });
      await withTenantContext(clinicAId, async () => {
        await dbAdmin('clinics').where({ id: clinicBId }).delete().catch(() => undefined);
      }, clinicAAdminId || undefined);
    }
  });

  it('returns counts for same-clinic team', async () => {
    const res = await request(app)
      .get(`/api/v1/escalations/team-summary?orgUnitId=${clinicAOrgUnitId}`)
      .set('Authorization', `Bearer ${clinicASession.token}`);

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      new: 1,
      inReview: 0,
      accepted: 0,
      rejected: 0,
    });
  });

  it('returns 404 for cross-clinic orgUnitId probing', async () => {
    const res = await request(app)
      .get(`/api/v1/escalations/team-summary?orgUnitId=${clinicBOrgUnitId}`)
      .set('Authorization', `Bearer ${clinicASession.token}`);

    expect(res.status).toBe(404);
    expect(res.body).toMatchObject({ error: 'Team not found' });
  });
});
