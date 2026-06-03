import { randomUUID } from 'crypto';
import { db, dbAdmin } from '../../db/db';
import type { TaskCreateDTO, TaskUpdateDTO, TaskListQuery } from '@signacare/shared';
import { applyTeamTaskScopeFilter } from './taskScopeSql';
import { updateWithOptimisticLock } from '../../shared/db/optimisticLock';

type TaskCreateWriteInput = TaskCreateDTO & {
  taskType?: string
  status?: string
}

// DB schema for tasks (verified against psql \d tasks):
//   id, clinic_id, patient_id, episode_id, assigned_to_id, assigned_by_id,
//   title, description, task_type, priority, status, due_date,
//   completed_at, completed_by_id, notes, created_at, updated_at.
//   NO deleted_at column, NO created_by_id, NO team_id, NO due_at.

export async function create(
  clinicId: string,
  createdById: string,
  dto: TaskCreateWriteInput,
): Promise<Record<string, unknown>> {
  const taskId = randomUUID();
  await db('tasks')
    .insert({
      id: taskId,
      clinic_id: clinicId,
      assigned_by_id: createdById,
      assigned_to_id: dto.assignedToId ?? null,
      patient_id: dto.patientId ?? null,
      episode_id: dto.episodeId ?? null,
      title: dto.title,
      description: dto.description ?? null,
      priority: dto.priority ?? 'medium',
      status: dto.status ?? 'pending',
      task_type: dto.taskType ?? null,
      due_date: dto.dueDate ?? null,
      updated_at: db.fn.now(),
    });
  const row = await findById(clinicId, taskId);
  if (!row) throw new Error('Task insert failed');
  return row;
}

/**
 * BUG-262 — admin-variant for background-job (worker) context with no
 * AsyncLocalStorage-based RLS scope. Mirrors the BUG-238 pattern on
 * pathologyRepository. Uses dbAdmin + explicit clinic_id in the WHERE
 * so tenant isolation is preserved at the app layer while bypassing
 * the RLS policy that the app_user pool enforces.
 */
export async function createAdmin(
  clinicId: string,
  createdById: string,
  dto: TaskCreateWriteInput,
): Promise<Record<string, unknown>> {
  const taskId = randomUUID();
  await dbAdmin('tasks')
    .insert({
      id: taskId,
      clinic_id: clinicId,
      assigned_by_id: createdById,
      assigned_to_id: dto.assignedToId ?? null,
      patient_id: dto.patientId ?? null,
      episode_id: dto.episodeId ?? null,
      title: dto.title,
      description: dto.description ?? null,
      priority: dto.priority ?? 'medium',
      status: dto.status ?? 'pending',
      task_type: dto.taskType ?? null,
      due_date: dto.dueDate ?? null,
      updated_at: dbAdmin.fn.now(),
    });
  const row = await findByIdAdmin(clinicId, taskId);
  if (!row) throw new Error('Task insert failed');
  return row;
}

export async function findByIdAdmin(
  clinicId: string,
  id: string,
): Promise<Record<string, unknown> | undefined> {
  return dbAdmin('tasks as t')
    .leftJoin('staff as creator', 'creator.id', 't.assigned_by_id')
    .leftJoin('staff as assignee', 'assignee.id', 't.assigned_to_id')
    .leftJoin('patients as p', 'p.id', 't.patient_id')
    .where({ 't.id': id, 't.clinic_id': clinicId })
    .select(
      't.*',
      dbAdmin.raw(`COALESCE(creator.given_name || ' ' || creator.family_name, '') as created_by_staff_name`),
      dbAdmin.raw(`CASE WHEN t.assigned_to_id IS NOT NULL THEN COALESCE(assignee.given_name || ' ' || assignee.family_name, '') ELSE NULL END as assigned_to_staff_name`),
      dbAdmin.raw(`CASE WHEN t.patient_id IS NOT NULL THEN COALESCE(p.given_name || ' ' || p.family_name, '') ELSE NULL END as patient_name`),
    )
    .first() as Promise<Record<string, unknown> | undefined>;
}

export async function findById(
  clinicId: string,
  id: string,
): Promise<Record<string, unknown> | undefined> {
  return db('tasks as t')
    .leftJoin('staff as creator', 'creator.id', 't.assigned_by_id')
    .leftJoin('staff as assignee', 'assignee.id', 't.assigned_to_id')
    .leftJoin('patients as p', 'p.id', 't.patient_id')
    .where({ 't.id': id, 't.clinic_id': clinicId })
    .select(
      't.*',
      db.raw(`COALESCE(creator.given_name || ' ' || creator.family_name, '') as created_by_staff_name`),
      db.raw(`CASE WHEN t.assigned_to_id IS NOT NULL THEN COALESCE(assignee.given_name || ' ' || assignee.family_name, '') ELSE NULL END as assigned_to_staff_name`),
      db.raw(`CASE WHEN t.patient_id IS NOT NULL THEN COALESCE(p.given_name || ' ' || p.family_name, '') ELSE NULL END as patient_name`),
    )
    .first() as Promise<Record<string, unknown> | undefined>;
}

export async function findActiveTeamIdsForStaff(
  clinicId: string,
  staffId: string,
): Promise<string[]> {
  const teamRows = await db('staff_team_assignments')
    .where({
      clinic_id: clinicId,
      staff_id: staffId,
      is_active: true,
    })
    .where(function activeDate() {
      this.whereNull('end_date').orWhereRaw('end_date >= CURRENT_DATE');
    })
    .select('org_unit_id');

  const roleRows = await db('staff_role_assignments')
    .where({
      clinic_id: clinicId,
      staff_id: staffId,
      is_active: true,
    })
    .where(function activeDate() {
      this.whereNull('end_date').orWhereRaw('end_date >= CURRENT_DATE');
    })
    .select('org_unit_id');

  return Array.from(
    new Set([
      ...teamRows.map((row) => String(row.org_unit_id)),
      ...roleRows.map((row) => String(row.org_unit_id)),
    ]),
  );
}

export async function findMany(
  clinicId: string,
  filters: TaskListQuery,
  scopedTeamIds?: string[],
): Promise<Record<string, unknown>[]> {
  const query = db('tasks as t')
    .leftJoin('staff as creator', 'creator.id', 't.assigned_by_id')
    .leftJoin('staff as assignee', 'assignee.id', 't.assigned_to_id')
    .leftJoin('patients as p', 'p.id', 't.patient_id')
    .where({ 't.clinic_id': clinicId });
  if (filters.patientId) query.where('t.patient_id', filters.patientId);
  if (filters.episodeId) query.where('t.episode_id', filters.episodeId);
  if (filters.assignedToId) query.where('t.assigned_to_id', filters.assignedToId);
  const effectiveTeamIds = filters.teamId
    ? [filters.teamId]
    : filters.teamScope === 'mine'
      ? (scopedTeamIds ?? [])
      : [];
  if (effectiveTeamIds.length > 0) {
    applyTeamTaskScopeFilter(query, clinicId, effectiveTeamIds);
  } else if (filters.teamScope === 'mine') {
    query.whereRaw('1 = 0');
  }
  if (filters.status) {
    // Frontend may send 'open' for backwards compat; DB stores 'pending'
    const dbStatus = filters.status === ('open' as string) ? 'pending' : filters.status;
    query.where('t.status', dbStatus);
  }
  if (filters.priority) query.where('t.priority', filters.priority);
  if (filters.dueBefore) query.where('t.due_date', '<=', filters.dueBefore);
  return query
    .select(
      't.*',
      db.raw(`COALESCE(creator.given_name || ' ' || creator.family_name, '') as created_by_staff_name`),
      db.raw(`CASE WHEN t.assigned_to_id IS NOT NULL THEN COALESCE(assignee.given_name || ' ' || assignee.family_name, '') ELSE NULL END as assigned_to_staff_name`),
      db.raw(`CASE WHEN t.patient_id IS NOT NULL THEN COALESCE(p.given_name || ' ' || p.family_name, '') ELSE NULL END as patient_name`),
    )
    .orderBy('t.due_date', 'asc')
    .orderBy('t.created_at', 'desc')
    .limit(500) as Promise<Record<string, unknown>[]>; // BUG-437 — list-ceiling clinic-wide tasks
}

export async function update(
  clinicId: string,
  id: string,
  dto: TaskUpdateDTO,
  expectedLockVersion: number,
  actorStaffId?: string,
): Promise<Record<string, unknown> | undefined> {
  const patch: Record<string, unknown> = {};
  if (dto.title !== undefined) patch['title'] = dto.title;
  if (dto.description !== undefined) patch['description'] = dto.description;
  if (dto.priority !== undefined) patch['priority'] = dto.priority;
  if (dto.assignedToId !== undefined) patch['assigned_to_id'] = dto.assignedToId;
  if (dto.dueDate !== undefined) patch['due_date'] = dto.dueDate;
  if (dto.status !== undefined) {
    // Frontend may send 'open' for backwards compat; DB stores 'pending'
    patch['status'] = dto.status === ('open' as string) ? 'pending' : dto.status;
    if (dto.status === 'completed') {
      patch['completed_at'] = db.fn.now();
      patch['completed_by_id'] = actorStaffId ?? null;
    } else {
      patch['completed_at'] = null;
      patch['completed_by_id'] = null;
    }
  }
  await updateWithOptimisticLock<Record<string, unknown>>({
    table: 'tasks',
    where: { id, clinic_id: clinicId },
    expectedLockVersion,
    patch,
    returning: ['id'],
  });
  return findById(clinicId, id);
}

/**
 * Hard delete — tasks table has no deleted_at column.
 */
export async function hardDelete(clinicId: string, id: string): Promise<void> {
  await db('tasks')
    .where({ id, clinic_id: clinicId })
    .delete();
}
