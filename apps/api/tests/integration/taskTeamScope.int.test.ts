import { randomUUID } from 'crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Knex } from 'knex';
import {
  authedAgent,
  isIntegrationReady,
  loginAsAdmin,
  loginAsClinician,
} from './_helpers';
import { dbAdmin } from '../../src/db/db';

const READY = await isIntegrationReady();
const RUN_TAG = `taskTeamScope_${Date.now().toString(36)}`;

describe.skipIf(!READY)('Tasks team scope filter', () => {
  let token = '';
  let clinicianToken = '';
  let clinicId = '';
  let staffAId = '';
  let staffBId = '';
  let createdPatientId = '';
  let createdEpisodeId = '';
  const teamAId = randomUUID();
  const teamBId = randomUUID();
  const teamAssignmentIds: string[] = [];
  const createdTaskIds: string[] = [];

  async function withClinicContext<T>(work: (trx: Knex.Transaction) => Promise<T>): Promise<T> {
    if (!clinicId) {
      throw new Error('clinicId not initialized for task team scope test');
    }
    return dbAdmin.transaction(async (trx: Knex.Transaction) => {
      await trx.raw("SELECT set_config('app.clinic_id', ?, true)", [clinicId]);
      return work(trx);
    });
  }

  beforeAll(async () => {
    const [adminLogin, clinicianLogin] = await Promise.all([
      loginAsAdmin(),
      loginAsClinician(),
    ]);
    token = adminLogin.token;
    clinicianToken = clinicianLogin.token;
    clinicId = adminLogin.clinicId;
    staffAId = clinicianLogin.userId;

    const clinicians = await withClinicContext((trx) =>
      trx('staff')
        .where({ clinic_id: clinicId, role: 'clinician' })
        .whereNull('deleted_at')
        .select('id')
        .whereNot('id', staffAId)
        .limit(1),
    );
    if (clinicians.length < 1) {
      throw new Error(`Need at least 1 additional clinician in clinic ${clinicId} for team-scope task test`);
    }
    staffBId = String(clinicians[0]!.id);

    const now = new Date().toISOString();
    await withClinicContext((trx) =>
      trx('org_units').insert([
        {
          id: teamAId,
          clinic_id: clinicId,
          name: `${RUN_TAG}-team-a`,
          level: '3',
          parent_id: null,
          sort_order: 1,
          is_active: true,
          created_at: now,
          updated_at: now,
        },
        {
          id: teamBId,
          clinic_id: clinicId,
          name: `${RUN_TAG}-team-b`,
          level: '3',
          parent_id: null,
          sort_order: 2,
          is_active: true,
          created_at: now,
          updated_at: now,
        },
      ]),
    );

    const startDate = new Date().toISOString().slice(0, 10);
    const assignAId = randomUUID();
    const assignBId = randomUUID();
    teamAssignmentIds.push(assignAId, assignBId);
    await withClinicContext((trx) =>
      trx('staff_team_assignments').insert([
        {
          id: assignAId,
          clinic_id: clinicId,
          staff_id: staffAId,
          org_unit_id: teamAId,
          start_date: startDate,
          end_date: null,
          is_active: true,
          created_at: now,
          updated_at: now,
        },
        {
          id: assignBId,
          clinic_id: clinicId,
          staff_id: staffBId,
          org_unit_id: teamBId,
          start_date: startDate,
          end_date: null,
          is_active: true,
          created_at: now,
          updated_at: now,
        },
      ]),
    );

    createdPatientId = randomUUID();
    await withClinicContext((trx) =>
      trx('patients').insert({
        id: createdPatientId,
        clinic_id: clinicId,
        given_name: 'Team',
        family_name: `${RUN_TAG}_Patient`,
        emr_number: `TS${Date.now().toString().slice(-7)}`,
        date_of_birth: '1990-01-01',
        gender: 'male',
        created_at: now,
        updated_at: now,
      }),
    );

    createdEpisodeId = randomUUID();
    await withClinicContext(async (trx) => {
      await trx('episodes').insert({
        id: createdEpisodeId,
        patient_id: createdPatientId,
        clinic_id: clinicId,
        episode_type: `${RUN_TAG}-open`,
        status: 'open',
        start_date: startDate,
        team_id: teamAId,
        specialty_code: 'mental_health',
        primary_clinician_id: staffAId,
        created_at: now,
        updated_at: now,
        lock_version: 1,
      });

      await trx('patient_team_assignments').insert({
        id: randomUUID(),
        patient_id: createdPatientId,
        org_unit_id: teamAId,
        primary_clinician_id: staffAId,
        is_active: true,
        referral_status: 'accepted',
        created_at: now,
        updated_at: now,
      });
    });

    const taskBase = {
      clinic_id: clinicId,
      patient_id: createdPatientId,
      title: `${RUN_TAG} task`,
      description: 'team-scope-test',
      task_type: 'follow-up',
      priority: 'medium',
      status: 'pending',
      due_date: startDate,
      created_at: now,
      updated_at: now,
    };

    const t1 = randomUUID(); // include: assigned clinician belongs to team A
    const t2 = randomUUID(); // exclude: assigned clinician belongs to team B
    const t3 = randomUUID(); // include: unassigned + episode belongs to team A
    const t4 = randomUUID(); // include: unassigned + patient assigned to team A
    const t5 = randomUUID(); // exclude: assigned outsider even if episode in team A
    createdTaskIds.push(t1, t2, t3, t4, t5);
    await withClinicContext((trx) =>
      trx('tasks').insert([
        {
          ...taskBase,
          id: t1,
          title: `${RUN_TAG} assigned-team-member`,
          episode_id: createdEpisodeId,
          assigned_to_id: staffAId,
          assigned_by_id: staffAId,
        },
        {
          ...taskBase,
          id: t2,
          title: `${RUN_TAG} assigned-other-team`,
          episode_id: createdEpisodeId,
          assigned_to_id: staffBId,
          assigned_by_id: staffAId,
        },
        {
          ...taskBase,
          id: t3,
          title: `${RUN_TAG} unassigned-episode-team`,
          episode_id: createdEpisodeId,
          assigned_to_id: null,
          assigned_by_id: staffAId,
        },
        {
          ...taskBase,
          id: t4,
          title: `${RUN_TAG} unassigned-patient-team`,
          episode_id: null,
          assigned_to_id: null,
          assigned_by_id: staffAId,
        },
        {
          ...taskBase,
          id: t5,
          title: `${RUN_TAG} assigned-outsider`,
          episode_id: createdEpisodeId,
          assigned_to_id: staffBId,
          assigned_by_id: staffAId,
        },
      ]),
    );
  });

  afterAll(async () => {
    await withClinicContext(async (trx) => {
      if (createdTaskIds.length > 0) {
        await trx('tasks').whereIn('id', createdTaskIds).delete().catch(() => undefined);
      }
      if (createdPatientId) {
        await trx('patient_team_assignments').where({ patient_id: createdPatientId }).delete().catch(() => undefined);
        await trx('episodes').where({ id: createdEpisodeId }).delete().catch(() => undefined);
        await trx('patients').where({ id: createdPatientId }).delete().catch(() => undefined);
      }
      if (teamAssignmentIds.length > 0) {
        await trx('staff_team_assignments').whereIn('id', teamAssignmentIds).delete().catch(() => undefined);
      }
      await trx('org_units').whereIn('id', [teamAId, teamBId]).delete().catch(() => undefined);
    }).catch(() => undefined);
  });

  it('returns team tasks as: assigned to team members OR unassigned tasks belonging to the team', async () => {
    const agent = authedAgent(token);
    const res = await agent.get('/api/v1/tasks').query({ teamId: teamAId });
    expect(res.status).toBe(200);

    const rows = Array.isArray(res.body) ? res.body : (res.body?.data ?? []);
    const ids = new Set<string>(rows.map((r: { id: string }) => String(r.id)));

    const expectedInclude = createdTaskIds.slice(0, 1).concat(createdTaskIds[2]!, createdTaskIds[3]!);
    const expectedExclude = [createdTaskIds[1]!, createdTaskIds[4]!];

    for (const id of expectedInclude) {
      expect(ids.has(id)).toBe(true);
    }
    for (const id of expectedExclude) {
      expect(ids.has(id)).toBe(false);
    }
  });

  it('returns teamScope=mine tasks from all teams assigned to the clinician', async () => {
    const agent = authedAgent(clinicianToken);
    const res = await agent.get('/api/v1/tasks').query({ teamScope: 'mine' });
    expect(res.status).toBe(200);

    const rows = Array.isArray(res.body) ? res.body : (res.body?.data ?? []);
    const ids = new Set<string>(rows.map((r: { id: string }) => String(r.id)));

    // Assigned team member + unassigned team-owned tasks should be in scope.
    expect(ids.has(createdTaskIds[0]!)).toBe(true);
    expect(ids.has(createdTaskIds[2]!)).toBe(true);
    expect(ids.has(createdTaskIds[3]!)).toBe(true);

    // Tasks routed to other-team clinician should remain out of scope.
    expect(ids.has(createdTaskIds[1]!)).toBe(false);
    expect(ids.has(createdTaskIds[4]!)).toBe(false);
  });
});
