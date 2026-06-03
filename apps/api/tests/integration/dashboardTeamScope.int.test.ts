import { randomUUID } from 'crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import bcrypt from 'bcryptjs';
import app from '../../src/server';
import {
  CANONICAL_PASSWORD,
  CANONICAL_PERSONAS,
} from '../fixtures/canonical-personas';
import { isIntegrationReady, loginAsClinician } from './_helpers';

const ready = await isIntegrationReady();
const OPEN_TASK_STATUSES = new Set(['pending', 'open', 'todo', 'in_progress']);

interface Session {
  token: string;
  clinicId: string;
  userId: string;
}

function readOpenTaskCountFromBody(body: unknown): number {
  const rows = Array.isArray(body)
    ? body
    : (body as { data?: Array<{ status?: string | null }> } | null | undefined)?.data ?? [];
  return rows.filter((row) =>
    OPEN_TASK_STATUSES.has(String((row as { status?: string | null }).status ?? '').toLowerCase()),
  ).length;
}

async function loginByEmail(email: string): Promise<Session> {
  const res = await request(app)
    .post('/api/v1/auth/login')
    .set('X-CSRF-Token', 'test')
    .set('X-Client', 'mobile')
    .send({ email, password: CANONICAL_PASSWORD });

  if (res.status !== 200 || !res.body?.accessToken) {
    throw new Error(`Login failed for ${email}: ${res.status}`);
  }
  return {
    token: res.body.accessToken as string,
    clinicId: res.body.user.clinicId as string,
    userId: res.body.user.id as string,
  };
}

describe.skipIf(!ready)('Team dashboard scope and consolidation', () => {
  let clinicianSession: Session;
  let managerSession: Session;
  let clinicalDirectorSession: Session;

  /* eslint-disable @typescript-eslint/no-explicit-any */
  let dbAdmin: any;
  /* eslint-enable @typescript-eslint/no-explicit-any */

  const runTag = `bug-team-scope-${randomUUID().slice(0, 8)}`;
  const now = new Date();

  const parentTeamId = randomUUID();
  const teamAId = randomUUID();
  const teamBId = randomUUID();
  const programId = randomUUID();
  const patientAId = randomUUID();
  const patientBId = randomUUID();
  const episodeAId = randomUUID();
  const episodeBId = randomUUID();
  const teamAssignmentId = randomUUID();
  const managerTeamAssignmentId = randomUUID();
  const clinicalDirectorStaffId = randomUUID();
  const clinicalDirectorRoleId = randomUUID();
  const clinicalDirectorRoleAssignmentId = randomUUID();
  const noShowAppointmentId = randomUUID();
  const laiOverdueId = randomUUID();
  const laiUpcomingId = randomUUID();
  const legalOverdueId = randomUUID();
  const legalUpcomingId = randomUUID();
  const legalOrderTypeId = randomUUID();
  const teamATaskAssignedPendingId = randomUUID();
  const teamATaskUnassignedPendingId = randomUUID();
  const teamATaskCompletedId = randomUUID();
  const teamBTaskAssignedPendingId = randomUUID();

  beforeAll(async () => {
    clinicianSession = await loginAsClinician();
    managerSession = await loginByEmail(CANONICAL_PERSONAS.manager.email);
    ({ dbAdmin } = await import('../../src/db/db'));

    const directorEmail = `clinical-director-${runTag}@signacare.local`;
    const directorPasswordHash = await bcrypt.hash(CANONICAL_PASSWORD, 10);
    await dbAdmin('staff').insert({
      id: clinicalDirectorStaffId,
      clinic_id: clinicianSession.clinicId,
      given_name: 'Clinical',
      family_name: 'Director',
      email: directorEmail,
      password_hash: directorPasswordHash,
      role: 'clinician',
      is_active: true,
      failed_login_attempts: 0,
      created_at: now,
      updated_at: now,
    });
    clinicalDirectorSession = await loginByEmail(directorEmail);

    await dbAdmin('org_units').insert([
      {
        id: parentTeamId,
        clinic_id: clinicianSession.clinicId,
        parent_id: null,
        name: `Parent ${runTag}`,
        level: '1',
        sort_order: 1,
        is_active: true,
        created_at: now,
        updated_at: now,
      },
      {
        id: teamAId,
        clinic_id: clinicianSession.clinicId,
        parent_id: parentTeamId,
        name: `Team A ${runTag}`,
        level: '2',
        sort_order: 1,
        is_active: true,
        created_at: now,
        updated_at: now,
      },
      {
        id: teamBId,
        clinic_id: clinicianSession.clinicId,
        parent_id: parentTeamId,
        name: `Team B ${runTag}`,
        level: '2',
        sort_order: 2,
        is_active: true,
        created_at: now,
        updated_at: now,
      },
    ]);

    await dbAdmin('programs').insert({
      id: programId,
      clinic_id: clinicianSession.clinicId,
      name: `Program ${runTag}`,
      description: 'Integration test program',
      is_active: true,
      created_at: now,
      updated_at: now,
    });

    await dbAdmin('org_unit_programs').insert([
      {
        id: randomUUID(),
        clinic_id: clinicianSession.clinicId,
        org_unit_id: teamAId,
        name: `Program ${runTag}`,
        is_active: true,
        created_at: now,
        updated_at: now,
      },
      {
        id: randomUUID(),
        clinic_id: clinicianSession.clinicId,
        org_unit_id: teamBId,
        name: `Program ${runTag}`,
        is_active: true,
        created_at: now,
        updated_at: now,
      },
    ]);

    await dbAdmin('clinical_roles').insert({
      id: clinicalDirectorRoleId,
      clinic_id: clinicianSession.clinicId,
      name: `Clinical Director ${runTag}`,
      is_active: true,
      sort_order: 999,
      created_at: now,
      updated_at: now,
    });

    await dbAdmin('staff_team_assignments').insert([
      {
        id: teamAssignmentId,
        clinic_id: clinicianSession.clinicId,
        staff_id: clinicianSession.userId,
        org_unit_id: teamAId,
        start_date: now,
        end_date: null,
        is_active: true,
        created_at: now,
        updated_at: now,
      },
      {
        id: managerTeamAssignmentId,
        clinic_id: clinicianSession.clinicId,
        staff_id: managerSession.userId,
        org_unit_id: teamBId,
        start_date: now,
        end_date: null,
        is_active: true,
        created_at: now,
        updated_at: now,
      },
    ]);

    await dbAdmin('staff_role_assignments').insert({
      id: clinicalDirectorRoleAssignmentId,
      clinic_id: clinicianSession.clinicId,
      staff_id: clinicalDirectorStaffId,
      org_unit_id: teamBId,
      clinical_role_id: clinicalDirectorRoleId,
      role_type: 'primary',
      start_date: now,
      end_date: null,
      is_active: true,
      created_at: now,
      updated_at: now,
    });

    await dbAdmin('patients').insert([
      {
        id: patientAId,
        clinic_id: clinicianSession.clinicId,
        emr_number: `EMR-${runTag}-A`,
        given_name: 'Team',
        family_name: 'PatientA',
        date_of_birth: '1991-01-01',
        created_at: now,
        updated_at: now,
      },
      {
        id: patientBId,
        clinic_id: clinicianSession.clinicId,
        emr_number: `EMR-${runTag}-B`,
        given_name: 'Team',
        family_name: 'PatientB',
        date_of_birth: '1992-02-02',
        created_at: now,
        updated_at: now,
      },
    ]);

    const reviewOverdueStart = new Date(now);
    reviewOverdueStart.setDate(reviewOverdueStart.getDate() - 95);
    const reviewOverdueStartYmd = reviewOverdueStart.toISOString().slice(0, 10);
    const yesterday = new Date(now);
    yesterday.setDate(yesterday.getDate() - 1);
    const inThreeDays = new Date(now);
    inThreeDays.setDate(inThreeDays.getDate() + 3);
    const startYmd = new Date(now.getTime() - 35 * 86_400_000).toISOString().slice(0, 10);
    const yesterdayYmd = yesterday.toISOString().slice(0, 10);
    const inThreeDaysYmd = inThreeDays.toISOString().slice(0, 10);

    await dbAdmin('episodes').insert([
      {
        id: episodeAId,
        clinic_id: clinicianSession.clinicId,
        patient_id: patientAId,
        title: `Episode A ${runTag}`,
        episode_number: `EP-${runTag}-A`,
        episode_type: 'community',
        status: 'open',
        start_date: reviewOverdueStartYmd,
        team_id: teamAId,
        primary_clinician_id: clinicianSession.userId,
        created_at: now,
        updated_at: now,
      },
      {
        id: episodeBId,
        clinic_id: clinicianSession.clinicId,
        patient_id: patientBId,
        title: `Episode B ${runTag}`,
        episode_number: `EP-${runTag}-B`,
        episode_type: 'community',
        status: 'open',
        start_date: now,
        team_id: teamBId,
        primary_clinician_id: managerSession.userId,
        created_at: now,
        updated_at: now,
      },
    ]);

    await dbAdmin('appointments').insert({
      id: noShowAppointmentId,
      clinic_id: clinicianSession.clinicId,
      patient_id: patientAId,
      clinician_id: clinicianSession.userId,
      episode_id: episodeAId,
      start_time: yesterday.toISOString(),
      end_time: new Date(yesterday.getTime() + 30 * 60 * 1000).toISOString(),
      appointment_start: yesterday.toISOString(),
      appointment_end: new Date(yesterday.getTime() + 30 * 60 * 1000).toISOString(),
      status: 'no_show',
      type: 'follow_up',
      appointment_type: 'follow_up',
      reminder_scheduled: false,
      reminder_sent: false,
      specialty_code: 'general_medicine',
      created_at: now,
      updated_at: now,
    });

    await dbAdmin('lai_schedules').insert([
      {
        id: laiOverdueId,
        clinic_id: clinicianSession.clinicId,
        patient_id: patientAId,
        episode_id: episodeAId,
        prescriber_staff_id: clinicianSession.userId,
        drug_name: 'Paliperidone palmitate',
        dose_mg: '100',
        frequency_days: 28,
        injection_site: 'gluteal',
        injection_technique: 'IM',
        loading_dose_required: false,
        loading_doses_required: 0,
        loading_doses_given: 0,
        oral_overlap_required: false,
        start_date: startYmd,
        first_due_date: startYmd,
        next_due_date: yesterdayYmd,
        status: 'active',
        created_at: now,
        updated_at: now,
      },
      {
        id: laiUpcomingId,
        clinic_id: clinicianSession.clinicId,
        patient_id: patientAId,
        episode_id: episodeAId,
        prescriber_staff_id: clinicianSession.userId,
        drug_name: 'Aripiprazole',
        dose_mg: '300',
        frequency_days: 28,
        injection_site: 'deltoid',
        injection_technique: 'IM',
        loading_dose_required: false,
        loading_doses_required: 0,
        loading_doses_given: 0,
        oral_overlap_required: false,
        start_date: startYmd,
        first_due_date: startYmd,
        next_due_date: inThreeDaysYmd,
        status: 'active',
        created_at: now,
        updated_at: now,
      },
    ]);

    await dbAdmin('patient_legal_orders').insert([
      {
        id: legalOverdueId,
        patient_id: patientAId,
        clinic_id: clinicianSession.clinicId,
        order_type_id: legalOrderTypeId,
        entered_by_id: clinicianSession.userId,
        order_number: `LO-${runTag}-OD`,
        start_date: startYmd,
        end_date: yesterdayYmd,
        status: 'active',
        created_at: now,
        updated_at: now,
      },
      {
        id: legalUpcomingId,
        patient_id: patientAId,
        clinic_id: clinicianSession.clinicId,
        order_type_id: legalOrderTypeId,
        entered_by_id: clinicianSession.userId,
        order_number: `LO-${runTag}-UP`,
        start_date: startYmd,
        end_date: inThreeDaysYmd,
        status: 'active',
        created_at: now,
        updated_at: now,
      },
    ]);

    await dbAdmin('tasks').insert([
      {
        id: teamATaskAssignedPendingId,
        clinic_id: clinicianSession.clinicId,
        patient_id: patientAId,
        episode_id: episodeAId,
        assigned_to_id: clinicianSession.userId,
        assigned_by_id: managerSession.userId,
        title: `Pending assigned task ${runTag}`,
        description: 'Team A assigned task',
        task_type: 'review',
        priority: 'high',
        status: 'pending',
        due_date: inThreeDaysYmd,
        created_at: now,
        updated_at: now,
      },
      {
        id: teamATaskUnassignedPendingId,
        clinic_id: clinicianSession.clinicId,
        patient_id: patientAId,
        episode_id: episodeAId,
        assigned_to_id: null,
        assigned_by_id: managerSession.userId,
        title: `Pending unassigned task ${runTag}`,
        description: 'Team A unassigned task',
        task_type: 'review',
        priority: 'medium',
        status: 'pending',
        due_date: inThreeDaysYmd,
        created_at: now,
        updated_at: now,
      },
      {
        id: teamATaskCompletedId,
        clinic_id: clinicianSession.clinicId,
        patient_id: patientAId,
        episode_id: episodeAId,
        assigned_to_id: clinicianSession.userId,
        assigned_by_id: managerSession.userId,
        title: `Completed task ${runTag}`,
        description: 'Completed task should not count as open',
        task_type: 'review',
        priority: 'low',
        status: 'completed',
        due_date: yesterdayYmd,
        completed_at: now,
        created_at: now,
        updated_at: now,
      },
      {
        id: teamBTaskAssignedPendingId,
        clinic_id: clinicianSession.clinicId,
        patient_id: patientBId,
        episode_id: episodeBId,
        assigned_to_id: managerSession.userId,
        assigned_by_id: managerSession.userId,
        title: `Team B pending task ${runTag}`,
        description: 'Parent/program scope should include this',
        task_type: 'review',
        priority: 'medium',
        status: 'pending',
        due_date: inThreeDaysYmd,
        created_at: now,
        updated_at: now,
      },
    ]);
  });

  afterAll(async () => {
    if (!dbAdmin) return;
    await dbAdmin('staff_role_assignments')
      .where({ id: clinicalDirectorRoleAssignmentId })
      .delete();
    await dbAdmin('tasks')
      .whereIn('id', [
        teamATaskAssignedPendingId,
        teamATaskUnassignedPendingId,
        teamATaskCompletedId,
        teamBTaskAssignedPendingId,
      ])
      .delete();
    await dbAdmin('patient_legal_orders').whereIn('id', [legalOverdueId, legalUpcomingId]).delete();
    await dbAdmin('lai_schedules').whereIn('id', [laiOverdueId, laiUpcomingId]).delete();
    await dbAdmin('appointments').where({ id: noShowAppointmentId }).delete();
    await dbAdmin('episodes').whereIn('id', [episodeAId, episodeBId]).delete();
    await dbAdmin('patients').whereIn('id', [patientAId, patientBId]).delete();
    await dbAdmin('staff_team_assignments')
      .whereIn('id', [teamAssignmentId, managerTeamAssignmentId])
      .delete();
    await dbAdmin('clinical_roles').where({ id: clinicalDirectorRoleId }).delete();
    // audit_log is append-only; hard-deleting staff rows that appear in audit
    // entries triggers FK-set-null mutation on audit_log, which is blocked.
    await dbAdmin('staff')
      .where({ id: clinicalDirectorStaffId })
      .update({ is_active: false, deleted_at: now, updated_at: now });
    await dbAdmin('org_unit_programs')
      .where({ clinic_id: clinicianSession.clinicId, name: `Program ${runTag}` })
      .delete();
    await dbAdmin('programs').where({ id: programId }).delete();
    await dbAdmin('org_units')
      .whereIn('id', [teamAId, teamBId, parentTeamId])
      .delete();
  });

  it('restricts clinician team scope list to assigned teams', async () => {
    const res = await request(app)
      .get('/api/v1/dashboard/team/scopes')
      .set('Authorization', `Bearer ${clinicianSession.token}`)
      .set('X-CSRF-Token', 'test');

    expect(res.status).toBe(200);
    expect(res.body?.data?.canViewClinic).toBe(false);
    const teamIds = (res.body?.data?.teams ?? []).map((row: { scopeId: string }) => row.scopeId);
    expect(teamIds).toContain(teamAId);
    expect(teamIds).not.toContain(teamBId);
  });

  it('allows clinician team dashboard only for assigned team', async () => {
    const allowedRes = await request(app)
      .get('/api/v1/dashboard/team')
      .query({ scopeType: 'team', scopeId: teamAId })
      .set('Authorization', `Bearer ${clinicianSession.token}`)
      .set('X-CSRF-Token', 'test');

    expect(allowedRes.status).toBe(200);
    expect(allowedRes.body?.role).toBe('team');
    expect(allowedRes.body?.data?.totals?.activePatients).toBe(1);
    expect(allowedRes.body?.data?.totals?.openEpisodes).toBe(1);
    expect(allowedRes.body?.data?.totals?.didNotAttendAppointments).toBe(1);
    expect(allowedRes.body?.data?.totals?.overdueLai).toBe(1);
    expect(allowedRes.body?.data?.totals?.upcomingLai).toBe(1);
    expect(allowedRes.body?.data?.totals?.overdueMha).toBe(1);
    expect(allowedRes.body?.data?.totals?.upcomingMha).toBe(1);
    expect(allowedRes.body?.data?.totals?.overdueReviews91d).toBe(1);
    expect(allowedRes.body?.data?.totals?.openTasks).toBe(2);

    const clinicianRes = await request(app)
      .get('/api/v1/dashboard/clinician')
      .set('Authorization', `Bearer ${clinicianSession.token}`)
      .set('X-CSRF-Token', 'test');

    expect(clinicianRes.status).toBe(200);
    expect(clinicianRes.body?.data?.openTasks).toBe(1);
    expect(clinicianRes.body?.data?.newPathologyResults).toEqual(expect.any(Number));
    expect(clinicianRes.body?.data?.overduePathologyResults).toEqual(expect.any(Number));

    const teamTasksRes = await request(app)
      .get('/api/v1/tasks')
      .query({ teamId: teamAId })
      .set('Authorization', `Bearer ${clinicianSession.token}`)
      .set('X-CSRF-Token', 'test');
    expect(teamTasksRes.status).toBe(200);
    expect(readOpenTaskCountFromBody(teamTasksRes.body)).toBe(
      allowedRes.body?.data?.totals?.openTasks,
    );

    const myTasksRes = await request(app)
      .get('/api/v1/tasks')
      .query({ assignedToId: clinicianSession.userId })
      .set('Authorization', `Bearer ${clinicianSession.token}`)
      .set('X-CSRF-Token', 'test');
    expect(myTasksRes.status).toBe(200);
    expect(readOpenTaskCountFromBody(myTasksRes.body)).toBe(clinicianRes.body?.data?.openTasks);

    const deniedRes = await request(app)
      .get('/api/v1/dashboard/team')
      .query({ scopeType: 'team', scopeId: teamBId })
      .set('Authorization', `Bearer ${clinicianSession.token}`)
      .set('X-CSRF-Token', 'test');

    expect(deniedRes.status).toBe(403);
    expect(deniedRes.body?.code).toBe('TEAM_SCOPE_FORBIDDEN');
  });

  it('allows manager parent-team and program consolidated views', async () => {
    const parentRes = await request(app)
      .get('/api/v1/dashboard/team')
      .query({ scopeType: 'parent_team', scopeId: parentTeamId })
      .set('Authorization', `Bearer ${managerSession.token}`)
      .set('X-CSRF-Token', 'test');

    expect(parentRes.status).toBe(200);
    expect(parentRes.body?.data?.totals?.activePatients).toBe(2);
    expect(parentRes.body?.data?.totals?.openEpisodes).toBe(2);
    expect(parentRes.body?.data?.totals?.didNotAttendAppointments).toBe(1);
    expect(parentRes.body?.data?.totals?.openTasks).toBe(3);
    expect(parentRes.body?.data?.teamBreakdown?.length).toBeGreaterThanOrEqual(2);

    const programRes = await request(app)
      .get('/api/v1/dashboard/team')
      .query({ scopeType: 'program', scopeId: programId })
      .set('Authorization', `Bearer ${managerSession.token}`)
      .set('X-CSRF-Token', 'test');

    expect(programRes.status).toBe(200);
    expect(programRes.body?.data?.totals?.activePatients).toBe(2);
    expect(programRes.body?.data?.totals?.openEpisodes).toBe(2);
    expect(programRes.body?.data?.totals?.openTasks).toBe(3);
  });

  it('allows clinical director clinic-wide and consolidated team scopes', async () => {
    const scopeRes = await request(app)
      .get('/api/v1/dashboard/team/scopes')
      .set('Authorization', `Bearer ${clinicalDirectorSession.token}`)
      .set('X-CSRF-Token', 'test');

    expect(scopeRes.status).toBe(200);
    expect(scopeRes.body?.data?.canViewClinic).toBe(true);

    const clinicRes = await request(app)
      .get('/api/v1/dashboard/team')
      .query({ scopeType: 'clinic' })
      .set('Authorization', `Bearer ${clinicalDirectorSession.token}`)
      .set('X-CSRF-Token', 'test');

    expect(clinicRes.status).toBe(200);
    expect(clinicRes.body?.data?.totals?.activePatients).toBe(2);
    expect(clinicRes.body?.data?.totals?.openEpisodes).toBe(2);
    expect(clinicRes.body?.data?.totals?.openTasks).toBe(3);
  });

  it('applies period window to upcoming signal counts', async () => {
    const todayRes = await request(app)
      .get('/api/v1/dashboard/team')
      .query({ scopeType: 'team', scopeId: teamAId, period: 'today' })
      .set('Authorization', `Bearer ${clinicianSession.token}`)
      .set('X-CSRF-Token', 'test');
    expect(todayRes.status).toBe(200);
    expect(todayRes.body?.data?.totals?.upcomingLai).toBe(0);
    expect(todayRes.body?.data?.totals?.upcomingMha).toBe(0);

    const weekRes = await request(app)
      .get('/api/v1/dashboard/team')
      .query({ scopeType: 'team', scopeId: teamAId, period: 'week' })
      .set('Authorization', `Bearer ${clinicianSession.token}`)
      .set('X-CSRF-Token', 'test');
    expect(weekRes.status).toBe(200);
    expect(weekRes.body?.data?.totals?.upcomingLai).toBe(1);
    expect(weekRes.body?.data?.totals?.upcomingMha).toBe(1);
  });
});
