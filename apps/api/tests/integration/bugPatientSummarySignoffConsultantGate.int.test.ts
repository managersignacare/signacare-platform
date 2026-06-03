import { randomUUID } from 'crypto';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import app from '../../src/server';
import { dbAdmin } from '../../src/db/db';
import { isIntegrationReady, loginAsAdmin } from './_helpers';

const READY = await isIntegrationReady();
const TEST_TAG = `BUG-SUMMARY-SIGNOFF-${Date.now()}`;

let session: { token: string; clinicId: string; userId: string };
const createdTaskIds: string[] = [];
const createdSignoffIds: string[] = [];
const createdStaffRoleAssignmentIds: string[] = [];
const createdClinicalRoleIds: string[] = [];
const createdPatientTeamAssignmentIds: string[] = [];
const createdOrgUnitIds: string[] = [];
const createdPatientIds: string[] = [];

beforeAll(async () => {
  if (!READY) return;
  session = await loginAsAdmin();
});

afterAll(async () => {
  if (!READY) return;

  if (createdSignoffIds.length > 0) {
    await dbAdmin('patient_summary_signoffs').whereIn('id', createdSignoffIds).delete().catch(() => undefined);
  }
  if (createdTaskIds.length > 0) {
    await dbAdmin('tasks').whereIn('id', createdTaskIds).delete().catch(() => undefined);
  }
  if (createdStaffRoleAssignmentIds.length > 0) {
    await dbAdmin('staff_role_assignments').whereIn('id', createdStaffRoleAssignmentIds).delete().catch(() => undefined);
  }
  if (createdPatientTeamAssignmentIds.length > 0) {
    await dbAdmin('patient_team_assignments').whereIn('id', createdPatientTeamAssignmentIds).delete().catch(() => undefined);
  }
  if (createdPatientIds.length > 0) {
    await dbAdmin('patients').whereIn('id', createdPatientIds).delete().catch(() => undefined);
  }
  if (createdOrgUnitIds.length > 0) {
    await dbAdmin('org_units').whereIn('id', createdOrgUnitIds).delete().catch(() => undefined);
  }
  if (createdClinicalRoleIds.length > 0) {
    await dbAdmin('clinical_roles').whereIn('id', createdClinicalRoleIds).delete().catch(() => undefined);
  }
});

describe.skipIf(!READY)('BUG-PATIENT-SUMMARY-SIGNOFF — consultant sign-off + reminder task', () => {
  it('allows consultant sign-off, creates reminder task, and returns persisted signoff metadata', async () => {
    const now = new Date();
    const orgUnitId = randomUUID();
    const patientId = randomUUID();
    const roleId = randomUUID();
    const roleAssignmentId = randomUUID();
    const teamAssignmentId = randomUUID();

    createdOrgUnitIds.push(orgUnitId);
    createdPatientIds.push(patientId);
    createdClinicalRoleIds.push(roleId);
    createdStaffRoleAssignmentIds.push(roleAssignmentId);
    createdPatientTeamAssignmentIds.push(teamAssignmentId);

    await dbAdmin('org_units').insert({
      id: orgUnitId,
      clinic_id: session.clinicId,
      name: `${TEST_TAG}-Team`,
      level: 'team',
      parent_id: null,
      sort_order: 1,
      is_active: true,
      created_at: now,
      updated_at: now,
    });

    await dbAdmin('patients').insert({
      id: patientId,
      clinic_id: session.clinicId,
      given_name: 'Summary',
      family_name: TEST_TAG,
      emr_number: `${TEST_TAG}-MRN`,
      date_of_birth: '1990-01-01',
      status: 'active',
      created_at: now,
      updated_at: now,
    });

    await dbAdmin('patient_team_assignments').insert({
      id: teamAssignmentId,
      patient_id: patientId,
      org_unit_id: orgUnitId,
      primary_clinician_id: session.userId,
      is_active: true,
      created_at: now,
      updated_at: now,
    });

    await dbAdmin('clinical_roles').insert({
      id: roleId,
      clinic_id: session.clinicId,
      name: `${TEST_TAG}-Consultant Psychiatrist`,
      is_active: true,
      sort_order: 1,
      created_at: now,
      updated_at: now,
    });

    await dbAdmin('staff_role_assignments').insert({
      id: roleAssignmentId,
      clinic_id: session.clinicId,
      staff_id: session.userId,
      org_unit_id: orgUnitId,
      clinical_role_id: roleId,
      role_type: 'clinical',
      start_date: now.toISOString().slice(0, 10),
      is_active: true,
      created_at: now,
      updated_at: now,
    });

    const signRes = await request(app)
      .post(`/api/v1/patients/${patientId}/summary-signoffs`)
      .set('Authorization', `Bearer ${session.token}`)
      .send({
        section: 'longitudinal_summary',
        reviewIntervalMonths: 6,
      });

    expect(signRes.status).toBe(201);
    expect(Array.isArray(signRes.body.signoffs)).toBe(true);
    expect(signRes.body.signoffs.some((s: { section?: string }) => s.section === 'longitudinal_summary')).toBe(true);

    const signoffRow = await dbAdmin('patient_summary_signoffs')
      .where({ clinic_id: session.clinicId, patient_id: patientId, summary_section: 'longitudinal_summary' })
      .first();
    expect(signoffRow).toBeTruthy();
    if (signoffRow?.id) createdSignoffIds.push(signoffRow.id as string);
    expect(signoffRow?.signed_off_by_id).toBe(session.userId);
    expect(signoffRow?.review_interval_months).toBe(6);
    expect(signoffRow?.reminder_task_id).toBeTruthy();

    const reminderTask = await dbAdmin('tasks')
      .where({ id: signoffRow?.reminder_task_id, clinic_id: session.clinicId })
      .first();
    expect(reminderTask).toBeTruthy();
    if (reminderTask?.id) createdTaskIds.push(reminderTask.id as string);
    expect(reminderTask?.task_type).toBe('summary_review');
    expect(reminderTask?.assigned_to_id).toBe(session.userId);

    const listRes = await request(app)
      .get(`/api/v1/patients/${patientId}/summary-signoffs`)
      .set('Authorization', `Bearer ${session.token}`);

    expect(listRes.status).toBe(200);
    const listEntry = (listRes.body.signoffs as Array<{ section: string; signedOffById: string }>).find(
      (row) => row.section === 'longitudinal_summary',
    );
    expect(listEntry?.signedOffById).toBe(session.userId);
  });

  it('rejects sign-off when caller is not assigned as consultant for the patient team', async () => {
    const now = new Date();
    const orgUnitId = randomUUID();
    const patientId = randomUUID();
    const teamAssignmentId = randomUUID();

    createdOrgUnitIds.push(orgUnitId);
    createdPatientIds.push(patientId);
    createdPatientTeamAssignmentIds.push(teamAssignmentId);

    await dbAdmin('org_units').insert({
      id: orgUnitId,
      clinic_id: session.clinicId,
      name: `${TEST_TAG}-NoConsultantTeam`,
      level: 'team',
      parent_id: null,
      sort_order: 2,
      is_active: true,
      created_at: now,
      updated_at: now,
    });

    await dbAdmin('patients').insert({
      id: patientId,
      clinic_id: session.clinicId,
      given_name: 'No',
      family_name: 'Consultant',
      emr_number: `${TEST_TAG}-MRN-2`,
      date_of_birth: '1992-02-02',
      status: 'active',
      created_at: now,
      updated_at: now,
    });

    await dbAdmin('patient_team_assignments').insert({
      id: teamAssignmentId,
      patient_id: patientId,
      org_unit_id: orgUnitId,
      primary_clinician_id: session.userId,
      is_active: true,
      created_at: now,
      updated_at: now,
    });

    const res = await request(app)
      .post(`/api/v1/patients/${patientId}/summary-signoffs`)
      .set('Authorization', `Bearer ${session.token}`)
      .send({
        section: 'care_provision_summary',
        reviewIntervalMonths: 3,
      });

    expect(res.status).toBe(403);
    expect(res.body.code).toBe('CONSULTANT_SIGNOFF_REQUIRED');
  });

  it('rejects sign-off for non-psychiatrist consultant roles', async () => {
    const now = new Date();
    const orgUnitId = randomUUID();
    const patientId = randomUUID();
    const teamAssignmentId = randomUUID();
    const roleId = randomUUID();
    const roleAssignmentId = randomUUID();

    createdOrgUnitIds.push(orgUnitId);
    createdPatientIds.push(patientId);
    createdPatientTeamAssignmentIds.push(teamAssignmentId);
    createdClinicalRoleIds.push(roleId);
    createdStaffRoleAssignmentIds.push(roleAssignmentId);

    await dbAdmin('org_units').insert({
      id: orgUnitId,
      clinic_id: session.clinicId,
      name: `${TEST_TAG}-ConsultantPsychologistTeam`,
      level: 'team',
      parent_id: null,
      sort_order: 3,
      is_active: true,
      created_at: now,
      updated_at: now,
    });

    await dbAdmin('patients').insert({
      id: patientId,
      clinic_id: session.clinicId,
      given_name: 'Consultant',
      family_name: 'Psychologist',
      emr_number: `${TEST_TAG}-MRN-3`,
      date_of_birth: '1988-05-03',
      status: 'active',
      created_at: now,
      updated_at: now,
    });

    await dbAdmin('patient_team_assignments').insert({
      id: teamAssignmentId,
      patient_id: patientId,
      org_unit_id: orgUnitId,
      primary_clinician_id: session.userId,
      is_active: true,
      created_at: now,
      updated_at: now,
    });

    await dbAdmin('clinical_roles').insert({
      id: roleId,
      clinic_id: session.clinicId,
      name: `${TEST_TAG}-Consultant Psychologist`,
      is_active: true,
      sort_order: 4,
      created_at: now,
      updated_at: now,
    });

    await dbAdmin('staff_role_assignments').insert({
      id: roleAssignmentId,
      clinic_id: session.clinicId,
      staff_id: session.userId,
      org_unit_id: orgUnitId,
      clinical_role_id: roleId,
      role_type: 'clinical',
      start_date: now.toISOString().slice(0, 10),
      is_active: true,
      created_at: now,
      updated_at: now,
    });

    const res = await request(app)
      .post(`/api/v1/patients/${patientId}/summary-signoffs`)
      .set('Authorization', `Bearer ${session.token}`)
      .send({
        section: 'diagnosis_summary',
        reviewIntervalMonths: 3,
      });

    expect(res.status).toBe(403);
    expect(res.body.code).toBe('CONSULTANT_SIGNOFF_REQUIRED');
  });
});
