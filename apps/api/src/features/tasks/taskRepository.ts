import { randomUUID } from 'crypto';
import { db, dbAdmin } from '../../db/db';
import {
  OPEN_TASK_STATUSES,
  type TaskCreateDTO,
  type TaskMonitoringSummary,
  type TaskUpdateDTO,
  type TaskListQuery,
} from '@signacare/shared';
import { applyTeamTaskScopeFilter } from './taskScopeSql';
import { updateWithOptimisticLock } from '../../shared/db/optimisticLock';
import type { Knex } from 'knex';

type TaskCreateWriteInput = TaskCreateDTO & {
  taskType?: string
  status?: string
}

// DB schema for tasks (verified against psql \d tasks):
//   id, clinic_id, patient_id, episode_id, assigned_to_id, assigned_by_id,
//   title, description, task_type, priority, status, due_date,
//   completed_at, completed_by_id, notes, created_at, updated_at.
//   NO deleted_at column, NO created_by_id, NO team_id, NO due_at.

function applyBaseFilters(
  query: Knex.QueryBuilder,
  clinicId: string,
  filters: TaskListQuery,
  scopedTeamIds?: string[],
): void {
  query.where({ 't.clinic_id': clinicId });
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
    if (filters.status === 'open') {
      query.whereIn('t.status', OPEN_TASK_STATUSES);
    } else {
      query.where('t.status', filters.status);
    }
  }
  if (filters.priority) query.where('t.priority', filters.priority);
  if (filters.dueBefore) query.where('t.due_date', '<=', filters.dueBefore);
  if (filters.ownership === 'assigned') query.whereNotNull('t.assigned_to_id');
  if (filters.ownership === 'unassigned') query.whereNull('t.assigned_to_id');

  switch (filters.dueBucket) {
    case 'overdue':
      query
        .whereNotNull('t.due_date')
        .whereRaw("t.due_date < CURRENT_DATE")
        .whereNotIn('t.status', ['completed', 'cancelled']);
      break;
    case 'today':
      query
        .where('t.due_date', db.raw('CURRENT_DATE'))
        .whereNotIn('t.status', ['completed', 'cancelled']);
      break;
    case 'next_7_days':
      query
        .whereRaw("t.due_date BETWEEN CURRENT_DATE AND CURRENT_DATE + INTERVAL '7 days'")
        .whereNotIn('t.status', ['completed', 'cancelled']);
      break;
    case 'undated':
      query
        .whereNull('t.due_date')
        .whereNotIn('t.status', ['completed', 'cancelled']);
      break;
    default:
      break;
  }
}

function summarizeRows(rows: Array<{
  assigned_to_id: string | null;
  assigned_to_staff_name: string | null;
  status: string;
  priority: string;
  due_date: string | null;
}>): TaskMonitoringSummary {
  const todayKey = new Date().toISOString().slice(0, 10);
  const openRows = rows.filter((row) => !['completed', 'cancelled'].includes(row.status));
  const totals = {
    open: openRows.length,
    overdue: 0,
    dueToday: 0,
    dueNext7Days: 0,
    undated: 0,
    blocked: 0,
    waitingExternal: 0,
    reviewPending: 0,
    unassigned: 0,
    urgent: 0,
    completed: rows.filter((row) => row.status === 'completed').length,
  };

  const dueBuckets = new Map<string, { label: string; count: number }>([
    ['overdue', { label: 'Overdue', count: 0 }],
    ['today', { label: 'Today', count: 0 }],
    ['next_7_days', { label: 'Next 7 Days', count: 0 }],
    ['undated', { label: 'Undated', count: 0 }],
  ]);
  const statusBreakdown = new Map<string, number>();
  const priorityBreakdown = new Map<string, number>();
  const assigneeBreakdown = new Map<string, {
    staffId: string | null;
    displayName: string;
    openCount: number;
    overdueCount: number;
    dueTodayCount: number;
    blockedCount: number;
    waitingExternalCount: number;
  }>();

  for (const row of rows) {
    statusBreakdown.set(row.status, (statusBreakdown.get(row.status) ?? 0) + 1);
    priorityBreakdown.set(row.priority, (priorityBreakdown.get(row.priority) ?? 0) + 1);

    const bucketKey = row.assigned_to_id ?? 'unassigned';
    const bucket = assigneeBreakdown.get(bucketKey) ?? {
      staffId: row.assigned_to_id,
      displayName: row.assigned_to_staff_name ?? 'Unassigned',
      openCount: 0,
      overdueCount: 0,
      dueTodayCount: 0,
      blockedCount: 0,
      waitingExternalCount: 0,
    };

    const isOpen = !['completed', 'cancelled'].includes(row.status);
    if (!isOpen) {
      assigneeBreakdown.set(bucketKey, bucket);
      continue;
    }

    bucket.openCount += 1;
    if (row.assigned_to_id == null) totals.unassigned += 1;
    if (row.priority === 'urgent') totals.urgent += 1;
    if (row.status === 'blocked') {
      totals.blocked += 1;
      bucket.blockedCount += 1;
    }
    if (row.status === 'waiting_external') {
      totals.waitingExternal += 1;
      bucket.waitingExternalCount += 1;
    }
    if (row.status === 'review_pending') totals.reviewPending += 1;

    if (!row.due_date) {
      totals.undated += 1;
      dueBuckets.get('undated')!.count += 1;
    } else if (row.due_date < todayKey) {
      totals.overdue += 1;
      bucket.overdueCount += 1;
      dueBuckets.get('overdue')!.count += 1;
    } else if (row.due_date === todayKey) {
      totals.dueToday += 1;
      bucket.dueTodayCount += 1;
      dueBuckets.get('today')!.count += 1;
      totals.dueNext7Days += 1;
      dueBuckets.get('next_7_days')!.count += 1;
    } else {
      const deltaDays = Math.floor(
        (new Date(`${row.due_date}T00:00:00Z`).getTime() - new Date(`${todayKey}T00:00:00Z`).getTime()) / 86_400_000,
      );
      if (deltaDays <= 7) {
        totals.dueNext7Days += 1;
        dueBuckets.get('next_7_days')!.count += 1;
      }
    }

    assigneeBreakdown.set(bucketKey, bucket);
  }

  return {
    totals,
    dueBuckets: [...dueBuckets.entries()].map(([key, value]) => ({
      key,
      label: value.label,
      count: value.count,
    })),
    statusBreakdown: [...statusBreakdown.entries()].map(([key, count]) => ({
      key,
      label: key.replace(/_/g, ' '),
      count,
    })),
    priorityBreakdown: [...priorityBreakdown.entries()].map(([key, count]) => ({
      key,
      label: key,
      count,
    })),
    assigneeBreakdown: [...assigneeBreakdown.values()]
      .sort((a, b) => (
        b.overdueCount - a.overdueCount
        || b.dueTodayCount - a.dueTodayCount
        || b.openCount - a.openCount
        || a.displayName.localeCompare(b.displayName)
      )),
  };
}

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
    .leftJoin('patients as p', 'p.id', 't.patient_id');
  applyBaseFilters(query, clinicId, filters, scopedTeamIds);
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

export async function summarize(
  clinicId: string,
  filters: TaskListQuery,
  scopedTeamIds?: string[],
): Promise<TaskMonitoringSummary> {
  const rows = await db('tasks as t')
    .leftJoin('staff as assignee', 'assignee.id', 't.assigned_to_id')
    .modify((query) => applyBaseFilters(query, clinicId, filters, scopedTeamIds))
    .select(
      't.assigned_to_id',
      db.raw(`CASE WHEN t.assigned_to_id IS NOT NULL THEN COALESCE(assignee.given_name || ' ' || assignee.family_name, '') ELSE NULL END as assigned_to_staff_name`),
      't.status',
      't.priority',
      't.due_date',
    ) as Array<{
    assigned_to_id: string | null;
    assigned_to_staff_name: string | null;
    status: string;
    priority: string;
    due_date: string | null;
  }>;

  return summarizeRows(rows);
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
