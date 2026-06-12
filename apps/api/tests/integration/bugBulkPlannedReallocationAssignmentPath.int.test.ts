import { randomUUID } from 'crypto';
import type { Knex } from 'knex';
import request from 'supertest';
import { describe, expect, test } from 'vitest';
import app from '../../src/server';
import { dbAdmin } from '../../src/db/db';
import {
  CANONICAL_PASSWORD,
  CANONICAL_PERSONAS,
} from '../fixtures/canonical-personas';
import { isIntegrationReady, loginAsAdmin } from './_helpers';

const READY = await isIntegrationReady();
const TEST_TAG = `BUG-REALLOC-ASSIGNMENT-PATH-${Date.now()}`;
const SECONDARY_CLINIC_ID = CANONICAL_PERSONAS.otherClinicClinician.clinicId;

type Session = {
  token: string;
  clinicId: string;
  userId: string;
};

type ScenarioRows = {
  staffIds: string[];
  orgUnitIds: string[];
  clinicalRoleIds: string[];
  staffRoleAssignmentIds: string[];
  patientIds: string[];
  episodeIds: string[];
  transitionIds: string[];
  reallocationIds: string[];
};

function createScenarioRows(): ScenarioRows {
  return {
    staffIds: [],
    orgUnitIds: [],
    clinicalRoleIds: [],
    staffRoleAssignmentIds: [],
    patientIds: [],
    episodeIds: [],
    transitionIds: [],
    reallocationIds: [],
  };
}

async function withClinicContext<T>(
  clinicId: string,
  work: (trx: Knex.Transaction) => Promise<T>,
): Promise<T> {
  return dbAdmin.transaction(async (trx) => {
    await trx.raw("SELECT set_config('app.clinic_id', ?, true)", [clinicId]);
    return work(trx);
  });
}

function authHeaders(token: string): Record<string, string> {
  return {
    Authorization: `Bearer ${token}`,
    'X-CSRF-Token': 'test',
    'X-Client': 'mobile',
  };
}

function mutationHeaders(token: string, idempotencyKey: string = randomUUID()): Record<string, string> {
  return {
    ...authHeaders(token),
    'Idempotency-Key': idempotencyKey,
  };
}

function assignmentPatientId(assignment: Record<string, unknown>): string | null {
  const value = assignment.patientId ?? assignment.patient_id;
  return typeof value === 'string' ? value : null;
}

function assignmentPrimaryClinicianId(assignment: Record<string, unknown>): string | null {
  const value = assignment.primaryClinicianId ?? assignment.primary_clinician_id;
  return typeof value === 'string' ? value : null;
}

function assignmentEffectivePrimaryClinicianId(assignment: Record<string, unknown>): string | null {
  const value = assignment.effectivePrimaryClinicianId ?? assignment.effective_primary_clinician_id;
  return typeof value === 'string' ? value : null;
}

function assignmentClinicianName(assignment: Record<string, unknown>): string {
  const value = assignment.clinicianName ?? assignment.clinician_name;
  return typeof value === 'string' ? value : '';
}

async function waitForAssertion<T>(args: {
  read: () => Promise<T>;
  ok: (value: T) => boolean;
  timeoutMs?: number;
  stepMs?: number;
}): Promise<T> {
  const timeoutMs = args.timeoutMs ?? 3_000;
  const stepMs = args.stepMs ?? 75;
  const started = Date.now();

  let lastValue = await args.read();
  while (!args.ok(lastValue) && Date.now() - started < timeoutMs) {
    await new Promise((resolve) => setTimeout(resolve, stepMs));
    lastValue = await args.read();
  }
  return lastValue;
}

async function cleanupScenario(rows: ScenarioRows): Promise<void> {
  if (rows.staffRoleAssignmentIds.length > 0) {
    await withClinicContext(CANONICAL_PERSONAS.admin.clinicId, (trx) =>
      trx('staff_role_assignments')
        .whereIn('id', rows.staffRoleAssignmentIds)
        .delete()
        .catch(() => undefined),
    );
  }

  if (rows.reallocationIds.length > 0) {
    await withClinicContext(CANONICAL_PERSONAS.admin.clinicId, (trx) =>
      trx('patient_team_reallocations')
        .whereIn('id', rows.reallocationIds)
        .delete()
        .catch(() => undefined),
    );
  }

  if (rows.transitionIds.length > 0) {
    await withClinicContext(CANONICAL_PERSONAS.admin.clinicId, (trx) =>
      trx('planned_transition_assignments')
        .whereIn('transition_id', rows.transitionIds)
        .delete()
        .catch(() => undefined),
    );
    await withClinicContext(CANONICAL_PERSONAS.admin.clinicId, (trx) =>
      trx('planned_transitions')
        .whereIn('id', rows.transitionIds)
        .delete()
        .catch(() => undefined),
    );
  }

  if (rows.episodeIds.length > 0) {
    await withClinicContext(CANONICAL_PERSONAS.admin.clinicId, (trx) =>
      trx('episodes').whereIn('id', rows.episodeIds).delete().catch(() => undefined),
    );
  }

  if (rows.patientIds.length > 0) {
    await withClinicContext(CANONICAL_PERSONAS.admin.clinicId, (trx) =>
      trx('patient_team_assignments')
        .whereIn('patient_id', rows.patientIds)
        .delete()
        .catch(() => undefined),
    );
    await withClinicContext(CANONICAL_PERSONAS.admin.clinicId, (trx) =>
      trx('patients').whereIn('id', rows.patientIds).delete().catch(() => undefined),
    );
  }

  if (rows.clinicalRoleIds.length > 0) {
    await withClinicContext(CANONICAL_PERSONAS.admin.clinicId, (trx) =>
      trx('clinical_roles')
        .whereIn('id', rows.clinicalRoleIds)
        .delete()
        .catch(() => undefined),
    );
  }

  if (rows.orgUnitIds.length > 0) {
    await withClinicContext(CANONICAL_PERSONAS.admin.clinicId, (trx) =>
      trx('org_units').whereIn('id', rows.orgUnitIds).delete().catch(() => undefined),
    );
    await withClinicContext(SECONDARY_CLINIC_ID, (trx) =>
      trx('org_units').whereIn('id', rows.orgUnitIds).delete().catch(() => undefined),
    );
  }

  if (rows.staffIds.length > 0) {
    await withClinicContext(CANONICAL_PERSONAS.admin.clinicId, (trx) =>
      trx('staff').whereIn('id', rows.staffIds).delete().catch(() => undefined),
    );
    await withClinicContext(SECONDARY_CLINIC_ID, (trx) =>
      trx('staff').whereIn('id', rows.staffIds).delete().catch(() => undefined),
    );
  }
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

async function createStaff(
  session: Session,
  rows: ScenarioRows,
  suffix: string,
): Promise<string> {
  return createStaffInClinic(session.clinicId, rows, suffix);
}

async function createStaffInClinic(
  clinicId: string,
  rows: ScenarioRows,
  suffix: string,
): Promise<string> {
  const id = randomUUID();
  rows.staffIds.push(id);
  await withClinicContext(clinicId, (trx) => trx('staff').insert({
    id,
    clinic_id: clinicId,
    email: `${suffix}.${Date.now()}@example.invalid`,
    password_hash: 'stub',
    given_name: suffix,
    family_name: TEST_TAG.slice(-8),
    role: 'clinician',
    is_active: true,
    created_at: new Date(),
    updated_at: new Date(),
  }));
  return id;
}

async function createTeam(
  session: Session,
  rows: ScenarioRows,
  suffix: string,
): Promise<string> {
  const id = randomUUID();
  rows.orgUnitIds.push(id);
  await withClinicContext(session.clinicId, (trx) => trx('org_units').insert({
    id,
    clinic_id: session.clinicId,
    name: `${suffix}-${TEST_TAG}`,
    level: 'team',
    parent_id: null,
    sort_order: 1,
    is_active: true,
    created_at: new Date(),
    updated_at: new Date(),
  }));
  return id;
}

async function createPatient(
  session: Session,
  rows: ScenarioRows,
  suffix: string,
): Promise<string> {
  const id = randomUUID();
  rows.patientIds.push(id);
  await withClinicContext(session.clinicId, (trx) => trx('patients').insert({
    id,
    clinic_id: session.clinicId,
    given_name: 'Realloc',
    family_name: suffix,
    emr_number: `${suffix}-${Date.now()}`.slice(0, 40),
    date_of_birth: '1990-01-01',
    status: 'active',
    created_at: new Date(),
    updated_at: new Date(),
  }));
  return id;
}

async function createEpisode(
  session: Session,
  rows: ScenarioRows,
  patientId: string,
  primaryClinicianId: string,
  teamId: string,
  suffix: string,
  keyWorkerId?: string | null,
): Promise<string> {
  const id = randomUUID();
  rows.episodeIds.push(id);
  await withClinicContext(session.clinicId, (trx) => trx('episodes').insert({
    id,
    clinic_id: session.clinicId,
    patient_id: patientId,
    primary_clinician_id: primaryClinicianId,
    key_worker_id: keyWorkerId ?? null,
    team_id: teamId,
    episode_type: `realloc-${suffix}`,
    presenting_problem: TEST_TAG,
    status: 'open',
    start_date: new Date(),
    created_at: new Date(),
    updated_at: new Date(),
  }));
  return id;
}

async function createPatientTeamAssignment(
  clinicId: string,
  patientId: string,
  teamId: string,
  primaryClinicianId: string | null,
): Promise<void> {
  await withClinicContext(clinicId, (trx) => trx('patient_team_assignments').insert({
    id: randomUUID(),
    patient_id: patientId,
    org_unit_id: teamId,
    primary_clinician_id: primaryClinicianId,
    is_active: true,
    referral_status: 'accepted',
    created_at: new Date(),
    updated_at: new Date(),
  }));
}

async function createMdtRoleAssignment(
  session: Session,
  rows: ScenarioRows,
  staffId: string,
  teamId: string,
  roleName: string,
): Promise<void> {
  const clinicalRoleId = randomUUID();
  const roleAssignmentId = randomUUID();
  rows.clinicalRoleIds.push(clinicalRoleId);
  rows.staffRoleAssignmentIds.push(roleAssignmentId);

  await withClinicContext(session.clinicId, async (trx) => {
    await trx('clinical_roles').insert({
      id: clinicalRoleId,
      clinic_id: session.clinicId,
      name: `${roleName}-${TEST_TAG}`,
      is_active: true,
      sort_order: 100,
      created_at: new Date(),
      updated_at: new Date(),
    });

    await trx('staff_role_assignments').insert({
      id: roleAssignmentId,
      clinic_id: session.clinicId,
      staff_id: staffId,
      org_unit_id: teamId,
      clinical_role_id: clinicalRoleId,
      role_type: 'mdt',
      start_date: new Date().toISOString().slice(0, 10),
      end_date: null,
      is_active: true,
      created_at: new Date(),
      updated_at: new Date(),
    });
  });
}

describe.skipIf(!READY)('BUG-REALLOC-ASSIGNMENT-PATH', () => {
  test('bulk clinician reassign updates episodes, patient_team_assignments, and team-assignments API', async () => {
    const session = await loginAsAdmin();
    const rows = createScenarioRows();

    try {
      const fromStaffId = await createStaff(session, rows, 'bulk-from');
      const toStaffId = await createStaff(session, rows, 'bulk-to');
      const teamId = await createTeam(session, rows, 'bulk-team');
      const patientId = await createPatient(session, rows, 'bulk-patient');
      const episodeId = await createEpisode(
        session,
        rows,
        patientId,
        fromStaffId,
        teamId,
        'bulk',
      );
      await createPatientTeamAssignment(session.clinicId, patientId, teamId, fromStaffId);

      const reassignRes = await request(app)
        .post('/api/v1/staff-settings/bulk-reassign')
        .set(mutationHeaders(session.token))
        .send({
          type: 'clinician',
          fromId: fromStaffId,
          toId: toStaffId,
          patientIds: [patientId],
        });

      expect(reassignRes.status).toBe(200);
      expect(reassignRes.body?.ok).toBe(true);
      expect(Number(reassignRes.body?.count ?? 0)).toBeGreaterThanOrEqual(1);

      const episodeRow = await waitForAssertion({
        read: () => withClinicContext(session.clinicId, (trx) =>
          trx('episodes')
            .where({ id: episodeId, clinic_id: session.clinicId })
            .first('primary_clinician_id'),
        ),
        ok: (row) => row?.primary_clinician_id === toStaffId,
      });
      expect(episodeRow?.primary_clinician_id).toBe(toStaffId);

      const assignmentRow = await withClinicContext(session.clinicId, (trx) =>
        trx('patient_team_assignments')
          .where({ patient_id: patientId, org_unit_id: teamId })
          .first('primary_clinician_id', 'is_active'),
      );
      expect(assignmentRow?.is_active).toBe(true);
      expect(assignmentRow?.primary_clinician_id).toBe(toStaffId);

      const teamAssignmentsRes = await request(app)
        .get('/api/v1/patients/team-assignments')
        .set(authHeaders(session.token));
      expect(teamAssignmentsRes.status).toBe(200);

      const assignment = ((teamAssignmentsRes.body?.assignments as Array<Record<string, unknown>> | undefined) ?? [])
        .find((row) => assignmentPatientId(row) === patientId);
      expect(assignment).toBeTruthy();
      expect(assignmentPrimaryClinicianId(assignment as Record<string, unknown>)).toBe(toStaffId);
    } finally {
      await cleanupScenario(rows);
    }
  });

  test('bulk clinician reassign updates key-worker ownership when source clinician is key worker', async () => {
    const session = await loginAsAdmin();
    const rows = createScenarioRows();

    try {
      const sourceKeyWorkerId = await createStaff(session, rows, 'bulk-kw-src');
      const toStaffId = await createStaff(session, rows, 'bulk-kw-dst');
      const primaryClinicianId = await createStaff(session, rows, 'bulk-kw-primary');
      const teamId = await createTeam(session, rows, 'bulk-kw-team');
      const patientId = await createPatient(session, rows, 'bulk-kw-patient');
      const episodeId = await createEpisode(
        session,
        rows,
        patientId,
        primaryClinicianId,
        teamId,
        'bulk-kw',
        sourceKeyWorkerId,
      );
      await createPatientTeamAssignment(session.clinicId, patientId, teamId, primaryClinicianId);

      const reassignRes = await request(app)
        .post('/api/v1/staff-settings/bulk-reassign')
        .set(mutationHeaders(session.token))
        .send({
          type: 'clinician',
          fromId: sourceKeyWorkerId,
          toId: toStaffId,
          patientIds: [patientId],
        });

      expect(reassignRes.status).toBe(200);
      expect(reassignRes.body?.ok).toBe(true);
      expect(Number(reassignRes.body?.count ?? 0)).toBe(1);

      const episodeRow = await waitForAssertion({
        read: () => withClinicContext(session.clinicId, (trx) =>
          trx('episodes')
            .where({ id: episodeId, clinic_id: session.clinicId })
            .first('primary_clinician_id', 'key_worker_id'),
        ),
        ok: (row) =>
          row?.primary_clinician_id === primaryClinicianId
          && row?.key_worker_id === toStaffId,
      });
      expect(episodeRow?.primary_clinician_id).toBe(primaryClinicianId);
      expect(episodeRow?.key_worker_id).toBe(toStaffId);

      const assignmentRow = await withClinicContext(session.clinicId, (trx) =>
        trx('patient_team_assignments')
          .where({ patient_id: patientId, org_unit_id: teamId })
          .first('primary_clinician_id'),
      );
      expect(assignmentRow?.primary_clinician_id).toBe(primaryClinicianId);
    } finally {
      await cleanupScenario(rows);
    }
  });

  test('team-assignments uses open-episode clinician fallback when assignment clinician is missing/stale', async () => {
    const session = await loginAsAdmin();
    const rows = createScenarioRows();

    try {
      const fromStaffId = await createStaff(session, rows, 'fallback-from');
      const teamId = await createTeam(session, rows, 'fallback-team');
      const patientId = await createPatient(session, rows, 'fallback-patient');
      await createEpisode(
        session,
        rows,
        patientId,
        fromStaffId,
        teamId,
        'fallback',
      );
      await createPatientTeamAssignment(session.clinicId, patientId, teamId, null);

      const teamAssignmentsRes = await request(app)
        .get('/api/v1/patients/team-assignments')
        .set(authHeaders(session.token));
      expect(teamAssignmentsRes.status).toBe(200);

      const assignment = ((teamAssignmentsRes.body?.assignments as Array<Record<string, unknown>> | undefined) ?? [])
        .find((row) => assignmentPatientId(row) === patientId);
      expect(assignment).toBeTruthy();
      expect(assignmentPrimaryClinicianId(assignment as Record<string, unknown>)).toBeNull();
      expect(assignmentEffectivePrimaryClinicianId(assignment as Record<string, unknown>)).toBe(fromStaffId);
    } finally {
      await cleanupScenario(rows);
    }
  });

  test('team-assignments includes patients with open episodes even when no patient_team_assignments row exists', async () => {
    const session = await loginAsAdmin();
    const rows = createScenarioRows();

    try {
      const primaryStaffId = await createStaff(session, rows, 'episode-only-staff');
      const teamId = await createTeam(session, rows, 'episode-only-team');
      const patientId = await createPatient(session, rows, 'episode-only-patient');
      const episodeId = await createEpisode(
        session,
        rows,
        patientId,
        primaryStaffId,
        teamId,
        'episode-only',
      );

      const teamAssignmentsRes = await request(app)
        .get('/api/v1/patients/team-assignments')
        .set(authHeaders(session.token));
      expect(teamAssignmentsRes.status).toBe(200);

      const assignment = ((teamAssignmentsRes.body?.assignments as Array<Record<string, unknown>> | undefined) ?? [])
        .find((row) => assignmentPatientId(row) === patientId);
      expect(assignment).toBeTruthy();
      expect(assignmentPrimaryClinicianId(assignment as Record<string, unknown>)).toBeNull();
      expect(assignmentEffectivePrimaryClinicianId(assignment as Record<string, unknown>)).toBe(primaryStaffId);
      expect((assignment as Record<string, unknown>).episodeId ?? (assignment as Record<string, unknown>).episode_id).toBe(episodeId);
    } finally {
      await cleanupScenario(rows);
    }
  });

  test('team-assignments populates MDT from open episode team when assignment team is stale', async () => {
    const session = await loginAsAdmin();
    const rows = createScenarioRows();

    try {
      const primaryStaffId = await createStaff(session, rows, 'mdt-primary');
      const consultantStaffId = await createStaff(session, rows, 'mdt-consultant');
      const staleAssignmentTeamId = await createTeam(session, rows, 'mdt-stale-team');
      const episodeTeamId = await createTeam(session, rows, 'mdt-episode-team');
      const patientId = await createPatient(session, rows, 'mdt-patient');
      const episodeId = await createEpisode(
        session,
        rows,
        patientId,
        primaryStaffId,
        episodeTeamId,
        'mdt-effective-team',
      );
      await createPatientTeamAssignment(session.clinicId, patientId, staleAssignmentTeamId, primaryStaffId);
      await createMdtRoleAssignment(
        session,
        rows,
        consultantStaffId,
        episodeTeamId,
        'Consultant Psychiatrist',
      );

      const teamAssignmentsRes = await request(app)
        .get('/api/v1/patients/team-assignments')
        .set(authHeaders(session.token));
      expect(teamAssignmentsRes.status).toBe(200);

      const assignment = ((teamAssignmentsRes.body?.assignments as Array<Record<string, unknown>> | undefined) ?? [])
        .find((row) => assignmentPatientId(row) === patientId);
      expect(assignment).toBeTruthy();
      expect((assignment as Record<string, unknown>).episodeId ?? (assignment as Record<string, unknown>).episode_id).toBe(episodeId);
      expect((assignment as Record<string, unknown>).orgUnitId ?? (assignment as Record<string, unknown>).org_unit_id).toBe(episodeTeamId);
      expect((assignment as Record<string, unknown>).openEpisodeTeamId ?? (assignment as Record<string, unknown>).open_episode_team_id).toBe(episodeTeamId);

      const mdt = ((assignment as Record<string, unknown>).mdt as Array<Record<string, unknown>> | undefined) ?? [];
      expect(mdt).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            staffId: consultantStaffId,
            roleName: expect.stringContaining('Consultant Psychiatrist'),
          }),
        ]),
      );
    } finally {
      await cleanupScenario(rows);
    }
  });

  test('team-assignment patch requires assignment id (patient id path is rejected)', async () => {
    const session = await loginAsAdmin();
    const rows = createScenarioRows();

    try {
      const primaryStaffId = await createStaff(session, rows, 'patch-src');
      const teamId = await createTeam(session, rows, 'patch-team');
      const patientId = await createPatient(session, rows, 'patch-patient');
      await createEpisode(
        session,
        rows,
        patientId,
        primaryStaffId,
        teamId,
        'patch',
      );
      await createPatientTeamAssignment(session.clinicId, patientId, teamId, primaryStaffId);

      const patchByPatientIdRes = await request(app)
        .patch(`/api/v1/patients/team-assignments/${patientId}`)
        .set(mutationHeaders(session.token))
        .send({
          referralStatus: 'accepted',
          isActive: true,
        });

      expect(patchByPatientIdRes.status).toBe(404);
      expect(String(patchByPatientIdRes.body?.error ?? '').toLowerCase()).toContain('not found');
    } finally {
      await cleanupScenario(rows);
    }
  });

  test('bulk clinician reassign rejects destination clinicians outside clinic and rolls back', async () => {
    const session = await loginAsAdmin();
    const rows = createScenarioRows();

    try {
      const fromStaffId = await createStaff(session, rows, 'rollback-from');
      const teamId = await createTeam(session, rows, 'rollback-team');
      const patientId = await createPatient(session, rows, 'rollback-patient');
      const episodeId = await createEpisode(
        session,
        rows,
        patientId,
        fromStaffId,
        teamId,
        'rollback',
      );
      await createPatientTeamAssignment(session.clinicId, patientId, teamId, fromStaffId);

      const foreignStaffId = await createStaffInClinic(SECONDARY_CLINIC_ID, rows, 'rollback-foreign');

      const reassignRes = await request(app)
        .post('/api/v1/staff-settings/bulk-reassign')
        .set(mutationHeaders(session.token))
        .send({
          type: 'clinician',
          fromId: fromStaffId,
          toId: foreignStaffId,
          patientIds: [patientId],
        });

      expect(reassignRes.status).toBe(400);
      expect(String(reassignRes.body?.error ?? '').toLowerCase()).toContain('clinic');

      const episodeRow = await withClinicContext(session.clinicId, (trx) =>
        trx('episodes')
          .where({ id: episodeId, clinic_id: session.clinicId })
          .first('primary_clinician_id'),
      );
      expect(episodeRow?.primary_clinician_id).toBe(fromStaffId);

      const assignmentRow = await withClinicContext(session.clinicId, (trx) =>
        trx('patient_team_assignments')
          .where({ patient_id: patientId, org_unit_id: teamId })
          .first('primary_clinician_id'),
      );
      expect(assignmentRow?.primary_clinician_id).toBe(fromStaffId);
    } finally {
      await cleanupScenario(rows);
    }
  });

  test('team-assignments keeps clinic boundary on clinician names and falls back to open-episode clinician', async () => {
    const session = await loginAsAdmin();
    const rows = createScenarioRows();

    try {
      const localStaffId = await createStaff(session, rows, 'leak-local');
      const teamId = await createTeam(session, rows, 'leak-team');
      const patientId = await createPatient(session, rows, 'leak-patient');
      await createEpisode(
        session,
        rows,
        patientId,
        localStaffId,
        teamId,
        'leak',
      );

      const foreignStaffId = await createStaffInClinic(SECONDARY_CLINIC_ID, rows, 'leak-foreign');
      await createPatientTeamAssignment(session.clinicId, patientId, teamId, foreignStaffId);

      const teamAssignmentsRes = await request(app)
        .get('/api/v1/patients/team-assignments')
        .set(authHeaders(session.token));
      expect(teamAssignmentsRes.status).toBe(200);

      const assignment = ((teamAssignmentsRes.body?.assignments as Array<Record<string, unknown>> | undefined) ?? [])
        .find((row) => assignmentPatientId(row) === patientId);
      expect(assignment).toBeTruthy();
      expect(assignmentPrimaryClinicianId(assignment as Record<string, unknown>)).toBe(foreignStaffId);
      expect(assignmentClinicianName(assignment as Record<string, unknown>)).toBe('');
      expect(assignmentEffectivePrimaryClinicianId(assignment as Record<string, unknown>)).toBe(localStaffId);
    } finally {
      await cleanupScenario(rows);
    }
  });

  test('planned transition execute updates episodes, patient_team_assignments, and team-assignments API', async () => {
    const session = await loginAsAdmin();
    const rows = createScenarioRows();

    try {
      const fromStaffId = await createStaff(session, rows, 'planned-from');
      const toStaffId = await createStaff(session, rows, 'planned-to');
      const fromTeamId = await createTeam(session, rows, 'planned-from-team');
      const toTeamId = await createTeam(session, rows, 'planned-to-team');
      const patientId = await createPatient(session, rows, 'planned-patient');
      const episodeId = await createEpisode(
        session,
        rows,
        patientId,
        fromStaffId,
        fromTeamId,
        'planned',
      );
      await createPatientTeamAssignment(session.clinicId, patientId, fromTeamId, fromStaffId);

      const createPlanRes = await request(app)
        .post('/api/v1/staff-settings/transitions')
        .set(mutationHeaders(session.token))
        .send({
          fromStaffId,
          reason: `${TEST_TAG} planned transfer`,
          effectiveDate: '2026-06-01',
          notes: 'integration test',
          assignments: [
            {
              patientId,
              episodeId,
              toStaffId,
              toTeam: toTeamId,
              handoverNotes: 'handover for regression guard',
            },
          ],
        });

      expect(createPlanRes.status).toBe(201);
      const transitionId = createPlanRes.body?.transition?.id as string | undefined;
      expect(typeof transitionId).toBe('string');
      if (!transitionId) {
        throw new Error('Expected transition id in create response');
      }
      rows.transitionIds.push(transitionId);

      const executePlanRes = await request(app)
        .post(`/api/v1/staff-settings/transitions/${transitionId}/execute`)
        .set(mutationHeaders(session.token))
        .send({});

      expect(executePlanRes.status).toBe(200);
      expect(executePlanRes.body?.ok).toBe(true);
      expect(executePlanRes.body?.executed).toBe(1);
      expect(executePlanRes.body?.total).toBe(1);

      const transitionAssignmentRow = await waitForAssertion({
        read: () => withClinicContext(session.clinicId, (trx) =>
          trx('planned_transition_assignments')
            .where({ transition_id: transitionId, patient_id: patientId })
            .orderBy('updated_at', 'desc')
            .first('status', 'executed_at'),
        ),
        ok: (row) => row?.status === 'executed',
      });
      expect(transitionAssignmentRow?.status).toBe('executed');
      expect(transitionAssignmentRow?.executed_at).toBeTruthy();

      const episodeRow = await withClinicContext(session.clinicId, (trx) =>
        trx('episodes')
          .where({ id: episodeId, clinic_id: session.clinicId })
          .first('primary_clinician_id', 'team_id'),
      );
      expect(episodeRow?.primary_clinician_id).toBe(toStaffId);
      expect(episodeRow?.team_id).toBe(toTeamId);

      const assignmentRow = await withClinicContext(session.clinicId, (trx) =>
        trx('patient_team_assignments')
          .where({ patient_id: patientId, org_unit_id: toTeamId })
          .first('primary_clinician_id', 'org_unit_id'),
      );
      expect(assignmentRow?.org_unit_id).toBe(toTeamId);
      expect(assignmentRow?.primary_clinician_id).toBe(toStaffId);

      const teamAssignmentsRes = await request(app)
        .get('/api/v1/patients/team-assignments')
        .set(authHeaders(session.token));
      expect(teamAssignmentsRes.status).toBe(200);

      const assignment = ((teamAssignmentsRes.body?.assignments as Array<Record<string, unknown>> | undefined) ?? [])
        .find((row) => assignmentPatientId(row) === patientId);
      expect(assignment).toBeTruthy();
      expect(assignmentPrimaryClinicianId(assignment as Record<string, unknown>)).toBe(toStaffId);
    } finally {
      await cleanupScenario(rows);
    }
  });

  test('planned transition execute updates key-worker ownership when source clinician is key worker', async () => {
    const session = await loginAsAdmin();
    const rows = createScenarioRows();

    try {
      const sourceKeyWorkerId = await createStaff(session, rows, 'planned-kw-from');
      const toStaffId = await createStaff(session, rows, 'planned-kw-to');
      const primaryClinicianId = await createStaff(session, rows, 'planned-kw-primary');
      const teamId = await createTeam(session, rows, 'planned-kw-team');
      const patientId = await createPatient(session, rows, 'planned-kw-patient');
      const episodeId = await createEpisode(
        session,
        rows,
        patientId,
        primaryClinicianId,
        teamId,
        'planned-kw',
        sourceKeyWorkerId,
      );
      await createPatientTeamAssignment(session.clinicId, patientId, teamId, primaryClinicianId);

      const createPlanRes = await request(app)
        .post('/api/v1/staff-settings/transitions')
        .set(mutationHeaders(session.token))
        .send({
          fromStaffId: sourceKeyWorkerId,
          reason: `${TEST_TAG} planned key-worker transfer`,
          effectiveDate: '2026-06-02',
          notes: 'integration test key-worker ownership transfer',
          assignments: [
            {
              patientId,
              episodeId,
              toStaffId,
              toTeam: teamId,
            },
          ],
        });

      expect(createPlanRes.status).toBe(201);
      const transitionId = createPlanRes.body?.transition?.id as string | undefined;
      expect(typeof transitionId).toBe('string');
      if (!transitionId) throw new Error('Expected transition id in create response');
      rows.transitionIds.push(transitionId);

      const executePlanRes = await request(app)
        .post(`/api/v1/staff-settings/transitions/${transitionId}/execute`)
        .set(mutationHeaders(session.token))
        .send({});

      expect(executePlanRes.status).toBe(200);
      expect(executePlanRes.body?.ok).toBe(true);
      expect(executePlanRes.body?.executed).toBe(1);
      expect(executePlanRes.body?.total).toBe(1);

      const episodeRow = await waitForAssertion({
        read: () => withClinicContext(session.clinicId, (trx) =>
          trx('episodes')
            .where({ id: episodeId, clinic_id: session.clinicId })
            .first('primary_clinician_id', 'key_worker_id'),
        ),
        ok: (row) =>
          row?.primary_clinician_id === primaryClinicianId
          && row?.key_worker_id === toStaffId,
      });
      expect(episodeRow?.primary_clinician_id).toBe(primaryClinicianId);
      expect(episodeRow?.key_worker_id).toBe(toStaffId);

      const assignmentRow = await withClinicContext(session.clinicId, (trx) =>
        trx('patient_team_assignments')
          .where({ patient_id: patientId, org_unit_id: teamId })
          .first('primary_clinician_id'),
      );
      expect(assignmentRow?.primary_clinician_id).toBe(primaryClinicianId);
    } finally {
      await cleanupScenario(rows);
    }
  });

  test('manager caseload + workload alerts use the same assignment semantics for key-worker allocations', async () => {
    const session = await loginAsAdmin();
    const rows = createScenarioRows();

    try {
      const primaryClinicianId = await createStaff(session, rows, 'caseload-primary');
      const keyWorkerId = await createStaff(session, rows, 'caseload-key-worker');
      const teamId = await createTeam(session, rows, 'caseload-team');
      const patientId = await createPatient(session, rows, 'caseload-patient');

      await createEpisode(
        session,
        rows,
        patientId,
        primaryClinicianId,
        teamId,
        'caseload-shared-semantics',
        keyWorkerId,
      );

      const staffCaseloadRes = await request(app)
        .get('/api/v1/reports/staff-caseload')
        .set(authHeaders(session.token));
      expect(staffCaseloadRes.status).toBe(200);

      const staffCaseloadRows = (staffCaseloadRes.body?.data as Array<Record<string, unknown>> | undefined) ?? [];
      const keyWorkerCaseload = staffCaseloadRows.find((row) => {
        const clinicianId = row.clinician_id ?? row.clinicianId;
        return typeof clinicianId === 'string' && clinicianId === keyWorkerId;
      });
      expect(keyWorkerCaseload).toBeTruthy();
      const keyWorkerPatientCount = Number(
        keyWorkerCaseload?.patient_count ?? keyWorkerCaseload?.patientCount ?? 0,
      );
      expect(keyWorkerPatientCount).toBeGreaterThanOrEqual(1);

      const workloadAlertsRes = await request(app)
        .get('/api/v1/reports/workload-alerts')
        .set(authHeaders(session.token));
      expect(workloadAlertsRes.status).toBe(200);

      const overdueContacts = (workloadAlertsRes.body?.data?.overdueContacts as Array<Record<string, unknown>> | undefined) ?? [];
      const keyWorkerOverdue = overdueContacts.find((row) => {
        const staffId = row.id ?? row.staff_id;
        return typeof staffId === 'string' && staffId === keyWorkerId;
      });

      expect(keyWorkerOverdue).toBeTruthy();
      const overdueCount = Number(
        keyWorkerOverdue?.overdue_patients ?? keyWorkerOverdue?.overduePatients ?? 0,
      );
      expect(overdueCount).toBeGreaterThanOrEqual(1);
    } finally {
      await cleanupScenario(rows);
    }
  });

  test('reallocation request rejects destination clinicians outside clinic', async () => {
    const session = await loginByEmail(CANONICAL_PERSONAS.admin.email);
    const rows = createScenarioRows();

    try {
      const sourceStaffId = await createStaff(session, rows, 'realloc-src');
      const sourceTeamId = await createTeam(session, rows, 'realloc-src-team');
      const patientId = await createPatient(session, rows, 'realloc-src-patient');
      await createEpisode(
        session,
        rows,
        patientId,
        sourceStaffId,
        sourceTeamId,
        'realloc-src',
      );
      await createPatientTeamAssignment(session.clinicId, patientId, sourceTeamId, sourceStaffId);

      const targetTeamId = await createTeam(session, rows, 'realloc-target-team');
      const foreignClinicianId = await createStaffInClinic(SECONDARY_CLINIC_ID, rows, 'realloc-foreign');

      const requestRes = await request(app)
        .post('/api/v1/reallocations')
        .set(mutationHeaders(session.token))
        .send({
          patientId,
          targetOrgUnitId: targetTeamId,
          targetPrimaryClinicianId: foreignClinicianId,
          reason: 'cross clinic destination must fail',
        });

      expect(requestRes.status).toBe(400);
      expect(String(requestRes.body?.error ?? '').toLowerCase()).toContain('clinic');
    } finally {
      await cleanupScenario(rows);
    }
  });

  test('reallocation approve updates open episode + assignment to destination clinician/team', async () => {
    const requester = await loginByEmail(CANONICAL_PERSONAS.admin.email);
    const approver = await loginAsAdmin();
    const rows = createScenarioRows();

    try {
      expect(requester.clinicId).toBe(approver.clinicId);
      const sourceStaffId = await createStaff(requester, rows, 'realloc-approve-src');
      const targetStaffId = await createStaff(requester, rows, 'realloc-approve-dst');
      const sourceTeamId = await createTeam(requester, rows, 'realloc-approve-src-team');
      const targetTeamId = await createTeam(requester, rows, 'realloc-approve-dst-team');
      const patientId = await createPatient(requester, rows, 'realloc-approve-patient');
      const episodeId = await createEpisode(
        requester,
        rows,
        patientId,
        sourceStaffId,
        sourceTeamId,
        'realloc-approve',
      );
      await createPatientTeamAssignment(requester.clinicId, patientId, sourceTeamId, sourceStaffId);

      const requestRes = await request(app)
        .post('/api/v1/reallocations')
        .set(mutationHeaders(requester.token))
        .send({
          patientId,
          targetOrgUnitId: targetTeamId,
          targetPrimaryClinicianId: targetStaffId,
          reason: 'approve flow should update assignment + episode',
        });
      expect(requestRes.status).toBe(201);
      const reallocationId = requestRes.body?.reallocation?.id as string | undefined;
      expect(typeof reallocationId).toBe('string');
      if (!reallocationId) throw new Error('Expected reallocation id');
      rows.reallocationIds.push(reallocationId);

      const approveRes = await request(app)
        .post(`/api/v1/reallocations/${reallocationId}/approve`)
        .set(mutationHeaders(approver.token))
        .send({});
      expect(approveRes.status).toBe(200);
      expect(approveRes.body?.reallocation?.status).toBe('active');

      const episodeRow = await waitForAssertion({
        read: () => withClinicContext(requester.clinicId, (trx) =>
          trx('episodes')
            .where({ id: episodeId, clinic_id: requester.clinicId })
            .first('team_id', 'primary_clinician_id'),
        ),
        ok: (row) =>
          row?.team_id === targetTeamId
          && row?.primary_clinician_id === targetStaffId,
      });
      expect(episodeRow?.team_id).toBe(targetTeamId);
      expect(episodeRow?.primary_clinician_id).toBe(targetStaffId);

      const sourceAssignment = await withClinicContext(requester.clinicId, (trx) =>
        trx('patient_team_assignments')
          .where({ patient_id: patientId, org_unit_id: sourceTeamId })
          .first('is_active'),
      );
      expect(sourceAssignment?.is_active).toBe(false);

      const targetAssignment = await withClinicContext(requester.clinicId, (trx) =>
        trx('patient_team_assignments')
          .where({ patient_id: patientId, org_unit_id: targetTeamId })
          .first('is_active', 'primary_clinician_id'),
      );
      expect(targetAssignment?.is_active).toBe(true);
      expect(targetAssignment?.primary_clinician_id).toBe(targetStaffId);
    } finally {
      await cleanupScenario(rows);
    }
  });

  test('reallocation approve supports team-only moves without overwriting the episode primary clinician', async () => {
    const requester = await loginByEmail(CANONICAL_PERSONAS.admin.email);
    const approver = await loginAsAdmin();
    const rows = createScenarioRows();

    try {
      expect(requester.clinicId).toBe(approver.clinicId);
      const sourceStaffId = await createStaff(requester, rows, 'realloc-team-only-src');
      const sourceTeamId = await createTeam(requester, rows, 'realloc-team-only-src-team');
      const targetTeamId = await createTeam(requester, rows, 'realloc-team-only-dst-team');
      const patientId = await createPatient(requester, rows, 'realloc-team-only-patient');
      const episodeId = await createEpisode(
        requester,
        rows,
        patientId,
        sourceStaffId,
        sourceTeamId,
        'realloc-team-only',
      );
      await createPatientTeamAssignment(requester.clinicId, patientId, sourceTeamId, sourceStaffId);

      const requestRes = await request(app)
        .post('/api/v1/reallocations')
        .set(mutationHeaders(requester.token))
        .send({
          patientId,
          targetOrgUnitId: targetTeamId,
          targetPrimaryClinicianId: null,
          reason: 'team-only reallocation should preserve episode primary clinician',
        });
      expect(requestRes.status).toBe(201);
      const reallocationId = requestRes.body?.reallocation?.id as string | undefined;
      expect(typeof reallocationId).toBe('string');
      if (!reallocationId) throw new Error('Expected reallocation id');
      rows.reallocationIds.push(reallocationId);

      const approveRes = await request(app)
        .post(`/api/v1/reallocations/${reallocationId}/approve`)
        .set(mutationHeaders(approver.token))
        .send({});
      expect(approveRes.status).toBe(200);
      expect(approveRes.body?.reallocation?.status).toBe('active');

      const episodeRow = await waitForAssertion({
        read: () => withClinicContext(requester.clinicId, (trx) =>
          trx('episodes')
            .where({ id: episodeId, clinic_id: requester.clinicId })
            .first('team_id', 'primary_clinician_id'),
        ),
        ok: (row) =>
          row?.team_id === targetTeamId
          && row?.primary_clinician_id === sourceStaffId,
      });
      expect(episodeRow?.team_id).toBe(targetTeamId);
      expect(episodeRow?.primary_clinician_id).toBe(sourceStaffId);

      const sourceAssignment = await withClinicContext(requester.clinicId, (trx) =>
        trx('patient_team_assignments')
          .where({ patient_id: patientId, org_unit_id: sourceTeamId })
          .first('is_active'),
      );
      expect(sourceAssignment?.is_active).toBe(false);

      const targetAssignment = await withClinicContext(requester.clinicId, (trx) =>
        trx('patient_team_assignments')
          .where({ patient_id: patientId, org_unit_id: targetTeamId })
          .first('is_active', 'primary_clinician_id'),
      );
      expect(targetAssignment?.is_active).toBe(true);
      expect(targetAssignment?.primary_clinician_id).toBeNull();
    } finally {
      await cleanupScenario(rows);
    }
  });

  test('reallocation approve enforces four-eyes principle and leaves state pending', async () => {
    const requester = await loginByEmail(CANONICAL_PERSONAS.admin.email);
    const rows = createScenarioRows();

    try {
      const sourceStaffId = await createStaff(requester, rows, 'realloc-4eyes-src');
      const targetStaffId = await createStaff(requester, rows, 'realloc-4eyes-dst');
      const sourceTeamId = await createTeam(requester, rows, 'realloc-4eyes-src-team');
      const targetTeamId = await createTeam(requester, rows, 'realloc-4eyes-dst-team');
      const patientId = await createPatient(requester, rows, 'realloc-4eyes-patient');
      const episodeId = await createEpisode(
        requester,
        rows,
        patientId,
        sourceStaffId,
        sourceTeamId,
        'realloc-4eyes',
      );
      await createPatientTeamAssignment(requester.clinicId, patientId, sourceTeamId, sourceStaffId);

      const requestRes = await request(app)
        .post('/api/v1/reallocations')
        .set(mutationHeaders(requester.token))
        .send({
          patientId,
          targetOrgUnitId: targetTeamId,
          targetPrimaryClinicianId: targetStaffId,
          reason: 'four-eyes guard should block self approval',
        });
      expect(requestRes.status).toBe(201);
      const reallocationId = requestRes.body?.reallocation?.id as string | undefined;
      expect(typeof reallocationId).toBe('string');
      if (!reallocationId) throw new Error('Expected reallocation id');
      rows.reallocationIds.push(reallocationId);

      const selfApproveRes = await request(app)
        .post(`/api/v1/reallocations/${reallocationId}/approve`)
        .set(mutationHeaders(requester.token))
        .send({});

      expect(selfApproveRes.status).toBe(403);
      expect(String(selfApproveRes.body?.error ?? '').toLowerCase()).toContain('four-eyes');

      const row = await withClinicContext(requester.clinicId, (trx) =>
        trx('patient_team_reallocations')
          .where({ id: reallocationId, clinic_id: requester.clinicId })
          .first('status', 'reviewed_by_id'),
      );
      expect(row?.status).toBe('pending_approval');
      expect(row?.reviewed_by_id).toBeNull();

      const episodeRow = await withClinicContext(requester.clinicId, (trx) =>
        trx('episodes')
          .where({ id: episodeId, clinic_id: requester.clinicId })
          .first('team_id', 'primary_clinician_id'),
      );
      expect(episodeRow?.team_id).toBe(sourceTeamId);
      expect(episodeRow?.primary_clinician_id).toBe(sourceStaffId);

      const sourceAssignment = await withClinicContext(requester.clinicId, (trx) =>
        trx('patient_team_assignments')
          .where({ patient_id: patientId, org_unit_id: sourceTeamId })
          .first('is_active', 'primary_clinician_id'),
      );
      expect(sourceAssignment?.is_active).toBe(true);
      expect(sourceAssignment?.primary_clinician_id).toBe(sourceStaffId);
    } finally {
      await cleanupScenario(rows);
    }
  });

  test('reallocation reject preserves source episode/assignment and marks request rejected', async () => {
    const requester = await loginByEmail(CANONICAL_PERSONAS.admin.email);
    const approver = await loginAsAdmin();
    const rows = createScenarioRows();

    try {
      expect(requester.clinicId).toBe(approver.clinicId);
      const sourceStaffId = await createStaff(requester, rows, 'realloc-reject-src');
      const targetStaffId = await createStaff(requester, rows, 'realloc-reject-dst');
      const sourceTeamId = await createTeam(requester, rows, 'realloc-reject-src-team');
      const targetTeamId = await createTeam(requester, rows, 'realloc-reject-dst-team');
      const patientId = await createPatient(requester, rows, 'realloc-reject-patient');
      const episodeId = await createEpisode(
        requester,
        rows,
        patientId,
        sourceStaffId,
        sourceTeamId,
        'realloc-reject',
      );
      await createPatientTeamAssignment(requester.clinicId, patientId, sourceTeamId, sourceStaffId);

      const requestRes = await request(app)
        .post('/api/v1/reallocations')
        .set(mutationHeaders(requester.token))
        .send({
          patientId,
          targetOrgUnitId: targetTeamId,
          targetPrimaryClinicianId: targetStaffId,
          reason: 'reject path should not mutate active allocation',
        });
      expect(requestRes.status).toBe(201);
      const reallocationId = requestRes.body?.reallocation?.id as string | undefined;
      expect(typeof reallocationId).toBe('string');
      if (!reallocationId) throw new Error('Expected reallocation id');
      rows.reallocationIds.push(reallocationId);

      const rejectRes = await request(app)
        .post(`/api/v1/reallocations/${reallocationId}/reject`)
        .set(mutationHeaders(approver.token))
        .send({ rejectionReason: 'Retain with current team pending family meeting.' });

      expect(rejectRes.status).toBe(200);
      expect(rejectRes.body?.reallocation?.status).toBe('rejected');

      const row = await withClinicContext(requester.clinicId, (trx) =>
        trx('patient_team_reallocations')
          .where({ id: reallocationId, clinic_id: requester.clinicId })
          .first('status', 'rejection_reason', 'reviewed_by_id'),
      );
      expect(row?.status).toBe('rejected');
      expect(String(row?.rejection_reason ?? '')).toContain('Retain with current team');
      expect(row?.reviewed_by_id).toBe(approver.userId);

      const episodeRow = await withClinicContext(requester.clinicId, (trx) =>
        trx('episodes')
          .where({ id: episodeId, clinic_id: requester.clinicId })
          .first('team_id', 'primary_clinician_id'),
      );
      expect(episodeRow?.team_id).toBe(sourceTeamId);
      expect(episodeRow?.primary_clinician_id).toBe(sourceStaffId);

      const sourceAssignment = await withClinicContext(requester.clinicId, (trx) =>
        trx('patient_team_assignments')
          .where({ patient_id: patientId, org_unit_id: sourceTeamId })
          .first('is_active', 'primary_clinician_id'),
      );
      expect(sourceAssignment?.is_active).toBe(true);
      expect(sourceAssignment?.primary_clinician_id).toBe(sourceStaffId);

      const targetAssignment = await withClinicContext(requester.clinicId, (trx) =>
        trx('patient_team_assignments')
          .where({ patient_id: patientId, org_unit_id: targetTeamId })
          .first('is_active'),
      );
      expect(targetAssignment).toBeUndefined();
    } finally {
      await cleanupScenario(rows);
    }
  });
});
