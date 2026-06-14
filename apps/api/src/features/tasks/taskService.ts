// apps/api/src/features/tasks/taskService.ts
//
// Audit Tier 3.3 (HIGH-D3) — service-layer AuthContext migration per
// CLAUDE.md §13. Public methods (createTask / listTasks / getTask /
// updateTask / deleteTask) accept AuthContext and enforce
// requirePatientRelationship when the task is linked to a patient.
//
// `createTaskInternal` is intentionally preserved with its raw
// (clinicId, createdById, dto) signature as the documented cross-service
// helper. It is only called from other services (pathology, referrals,
// billing) that have already performed their own authorization checks.
// Every public entry point (HTTP / MCP / etc.) MUST use the
// AuthContext-based methods in this file.
import type { AuthContext } from '@signacare/shared';
import * as taskRepo from './taskRepository';
import { AppError } from '../../shared/errors';
import { requirePatientReadAccess, requirePatientRelationship } from '../../shared/authGuards';
import type {
  TaskCreateDTO,
  TaskMonitoringSummary,
  TaskUpdateDTO,
  TaskResponse,
  TaskListQuery,
} from '@signacare/shared';
import {
  executeTaskCreateMutation,
  executeTaskDeleteMutation,
  executeTaskUpdateMutation,
  type InternalTaskCreateInput,
} from './taskMutationCommand'

function mapTask(row: Record<string, unknown>): TaskResponse & { createdByName: string; assignedToName: string | null; patientName: string | null } {
  return {
    id: row['id'] as string,
    clinicId: row['clinic_id'] as string,
    createdById: row['assigned_by_id'] as string,
    createdByName: (row['created_by_staff_name'] as string | null) ?? '',
    assignedToId: (row['assigned_to_id'] as string | null) ?? null,
    assignedToName: (row['assigned_to_staff_name'] as string | null) ?? null,
    patientId: (row['patient_id'] as string | null) ?? null,
    patientName: (row['patient_name'] as string | null) ?? null,
    episodeId: (row['episode_id'] as string | null) ?? null,
    title: row['title'] as string,
    description: (row['description'] as string | null) ?? null,
    priority: row['priority'] as TaskResponse['priority'],
    status: row['status'] as TaskResponse['status'],
    dueDate: (row['due_date'] as string | null) ?? null,
    completedAt: (row['completed_at'] as string | null) ?? null,
    createdAt: row['created_at'] as string,
    updatedAt: row['updated_at'] as string,
  };
}

function readExpectedLockVersion(row: Record<string, unknown>): number {
  const raw = row['lock_version'];
  if (typeof raw === 'number' && Number.isInteger(raw) && raw > 0) return raw;
  if (typeof raw === 'string') {
    const parsed = Number(raw);
    if (Number.isInteger(parsed) && parsed > 0) return parsed;
  }
  throw new AppError(
    'Task lock_version missing or invalid; optimistic locking cannot proceed',
    500,
    'TASK_LOCK_VERSION_MISSING',
  );
}

/**
 * Internal task creation — used by cross-service helpers (pathology,
 * referrals, billing) that have already performed their own
 * authorization. NEVER call this from a route handler; use the public
 * AuthContext-based `createTask` below instead.
 */
export async function createTaskInternal(
  clinicId: string,
  createdById: string,
  dto: InternalTaskCreateInput,
): Promise<TaskResponse> {
  const row = await executeTaskCreateMutation({
    clinicId,
    createdById,
    dto,
    mode: 'app_user',
  })
  return mapTask(row);
}

/**
 * BUG-262 — admin variant of createTaskInternal for background-worker
 * contexts with no AsyncLocalStorage-based RLS scope (HL7 inbound
 * ingestion creates critical-result flag tasks from the worker). Uses
 * the dbAdmin-based repo path. Same authorization assumption as
 * createTaskInternal (caller has done their own checks), just different
 * DB pool.
 */
export async function createTaskInternalAdmin(
  clinicId: string,
  createdById: string,
  dto: InternalTaskCreateInput,
): Promise<TaskResponse> {
  const row = await executeTaskCreateMutation({
    clinicId,
    createdById,
    dto,
    mode: 'db_admin',
  })
  return mapTask(row);
}

export async function createTask(
  auth: AuthContext,
  dto: TaskCreateDTO,
): Promise<TaskResponse> {
  if (dto.patientId) {
    await requirePatientRelationship(auth, dto.patientId);
  }
  return createTaskInternal(auth.clinicId, auth.staffId, dto);
}

export async function listTasks(
  auth: AuthContext,
  filters: TaskListQuery,
): Promise<TaskResponse[]> {
  // If filters scope to a single patient, require relationship on that
  // patient. Unscoped list (e.g. "my assigned tasks") remains usable
  // without a relationship check — the task list itself leaks only
  // task metadata that is visible by task assignment, not by patient.
  if (filters.patientId) {
    await requirePatientReadAccess(auth, filters.patientId);
  }
  const scopedTeamIds = filters.teamScope === 'mine'
    ? await taskRepo.findActiveTeamIdsForStaff(auth.clinicId, auth.staffId)
    : undefined;
  const rows = await taskRepo.findMany(auth.clinicId, filters, scopedTeamIds);
  return rows.map(mapTask);
}

export async function getTask(auth: AuthContext, taskId: string): Promise<TaskResponse> {
  const row = await taskRepo.findById(auth.clinicId, taskId);
  if (!row) throw new AppError('Task not found', 404, 'TASK_NOT_FOUND');
  const patientId = (row as { patient_id?: string | null }).patient_id;
  if (patientId) await requirePatientReadAccess(auth, patientId);
  return mapTask(row);
}

export async function getTaskMonitoringSummary(
  auth: AuthContext,
  filters: TaskListQuery,
): Promise<TaskMonitoringSummary> {
  if (filters.patientId) {
    await requirePatientReadAccess(auth, filters.patientId);
  }
  const scopedTeamIds = filters.teamScope === 'mine'
    ? await taskRepo.findActiveTeamIdsForStaff(auth.clinicId, auth.staffId)
    : undefined;
  return taskRepo.summarize(auth.clinicId, filters, scopedTeamIds);
}

export async function updateTask(
  auth: AuthContext,
  taskId: string,
  dto: TaskUpdateDTO,
): Promise<TaskResponse> {
  const existing = await taskRepo.findById(auth.clinicId, taskId);
  if (!existing) throw new AppError('Task not found', 404, 'TASK_NOT_FOUND');
  const patientId = (existing as { patient_id?: string | null }).patient_id;
  if (patientId) await requirePatientRelationship(auth, patientId);
  const expectedLockVersion = readExpectedLockVersion(existing as Record<string, unknown>);
  const row = await executeTaskUpdateMutation({
    clinicId: auth.clinicId,
    actorStaffId: auth.staffId,
    taskId,
    dto,
    expectedLockVersion,
  })
  if (!row) throw new AppError('Task not found', 404, 'TASK_NOT_FOUND');
  return mapTask(row);
}

export async function deleteTask(auth: AuthContext, taskId: string): Promise<void> {
  const existing = await taskRepo.findById(auth.clinicId, taskId);
  if (!existing) throw new AppError('Task not found', 404, 'TASK_NOT_FOUND');
  const patientId = (existing as { patient_id?: string | null }).patient_id;
  if (patientId) await requirePatientRelationship(auth, patientId);
  // tasks table has no deleted_at column — use hard delete.
  await executeTaskDeleteMutation({
    clinicId: auth.clinicId,
    taskId,
  })
}
