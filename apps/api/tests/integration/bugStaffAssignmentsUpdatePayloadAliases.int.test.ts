import { randomUUID } from 'crypto';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import request from 'supertest';
import app from '../../src/server';
import { dbAdmin } from '../../src/db/db';
import { isIntegrationReady, loginAsAdmin } from './_helpers';

const READY = await isIntegrationReady();

describe.skipIf(!READY)('BUG-STAFF-ASSIGNMENTS-UPDATE-PAYLOAD-ALIASES', () => {
  let token = '';
  let clinicId = '';
  let staffId = '';
  let orgUnitId = '';
  let clinicalRoleId = '';
  let teamAssignmentId = '';
  let roleAssignmentId = '';

  beforeAll(async () => {
    const session = await loginAsAdmin();
    token = session.token;
    clinicId = session.clinicId;

    const [staff] = (await dbAdmin('staff')
      .insert({
        id: randomUUID(),
        clinic_id: clinicId,
        email: `assign-payload-${Date.now()}@example.invalid`,
        password_hash: 'x',
        given_name: 'Assign',
        family_name: 'Payload',
        role: 'clinician',
        is_active: true,
      })
      .returning(['id'])) as Array<{ id: string }>;
    staffId = staff.id;

    const [orgUnit] = (await dbAdmin('org_units')
      .insert({
        id: randomUUID(),
        clinic_id: clinicId,
        name: `Assignment Team ${Date.now()}`,
        level: 'team',
      })
      .returning(['id'])) as Array<{ id: string }>;
    orgUnitId = orgUnit.id;

    const [clinicalRole] = (await dbAdmin('clinical_roles')
      .insert({
        id: randomUUID(),
        clinic_id: clinicId,
        name: `Assignment Role ${Date.now()}`,
        is_active: true,
        sort_order: 0,
      })
      .returning(['id'])) as Array<{ id: string }>;
    clinicalRoleId = clinicalRole.id;

    const [teamAssignment] = (await dbAdmin('staff_team_assignments')
      .insert({
        id: randomUUID(),
        clinic_id: clinicId,
        staff_id: staffId,
        org_unit_id: orgUnitId,
        start_date: '2026-01-01',
        is_active: true,
      })
      .returning(['id'])) as Array<{ id: string }>;
    teamAssignmentId = teamAssignment.id;

    const [roleAssignment] = (await dbAdmin('staff_role_assignments')
      .insert({
        id: randomUUID(),
        clinic_id: clinicId,
        staff_id: staffId,
        org_unit_id: orgUnitId,
        clinical_role_id: clinicalRoleId,
        role_type: 'primary',
        start_date: '2026-01-01',
        is_active: true,
      })
      .returning(['id'])) as Array<{ id: string }>;
    roleAssignmentId = roleAssignment.id;
  });

  afterAll(async () => {
    if (roleAssignmentId) {
      await dbAdmin('staff_role_assignments').where({ id: roleAssignmentId }).delete().catch(() => undefined);
    }
    if (teamAssignmentId) {
      await dbAdmin('staff_team_assignments').where({ id: teamAssignmentId }).delete().catch(() => undefined);
    }
    if (clinicalRoleId) {
      await dbAdmin('clinical_roles').where({ id: clinicalRoleId }).delete().catch(() => undefined);
    }
    if (orgUnitId) {
      await dbAdmin('org_units').where({ id: orgUnitId }).delete().catch(() => undefined);
    }
    if (staffId) {
      await dbAdmin('staff').where({ id: staffId }).delete().catch(() => undefined);
    }
  });

  test('PATCH /team-assignments/:id accepts camelCase endDate + isActive', async () => {
    const res = await request(app)
      .patch(`/api/v1/staff-settings/team-assignments/${teamAssignmentId}`)
      .set('Authorization', `Bearer ${token}`)
      .set('X-CSRF-Token', 'test')
      .send({
        endDate: '2026-12-31',
        isActive: false,
      });

    expect(res.status).toBe(200);
    expect(res.body?.assignment?.endDate).toBe('2026-12-31');
    expect(res.body?.assignment?.isActive).toBe(false);

    const row = await dbAdmin('staff_team_assignments').where({ id: teamAssignmentId }).first();
    expect(row?.end_date).toBe('2026-12-31');
    expect(row?.is_active).toBe(false);
  });

  test('PATCH /role-assignments/:id accepts camelCase roleType + endDate + isActive', async () => {
    const res = await request(app)
      .patch(`/api/v1/staff-settings/role-assignments/${roleAssignmentId}`)
      .set('Authorization', `Bearer ${token}`)
      .set('X-CSRF-Token', 'test')
      .send({
        roleType: 'delegated',
        endDate: '2026-12-30',
        isActive: false,
      });

    expect(res.status).toBe(200);
    expect(res.body?.assignment?.roleType).toBe('delegated');
    expect(res.body?.assignment?.endDate).toBe('2026-12-30');
    expect(res.body?.assignment?.isActive).toBe(false);

    const row = await dbAdmin('staff_role_assignments').where({ id: roleAssignmentId }).first();
    expect(row?.role_type).toBe('delegated');
    expect(row?.end_date).toBe('2026-12-30');
    expect(row?.is_active).toBe(false);
  });
});
