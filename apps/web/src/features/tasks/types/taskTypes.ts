// apps/web/src/features/tasks/types/taskTypes.ts
//
// Phase 0.7 PR2 Class D (TYPEDUP:TaskResponse) — TaskResponse, TaskPriority,
// TaskStatus, CreateTaskDTO, UpdateTaskDTO are all imported from the
// @signacare/shared package (single source of truth). The frontend only
// adds the three display fields the backend service populates via JOIN:
// createdByName, assignedToName, patientName. Those live on the view-type
// extension below, not on a parallel TaskResponse schema.
//
// Before this phase the frontend re-declared TaskResponse locally with
// different field names (createdByName vs backend createdByStaffName),
// which meant the task list columns silently rendered undefined for
// months. Fix documented in docs/fix-registry.md under TYPEDUP:TaskResponse.
import { z } from 'zod';
import {
  TaskCreateSchema as SharedTaskCreateSchema,
  TaskPrioritySchema as SharedTaskPrioritySchema,
  TaskUpdateSchema as SharedTaskUpdateSchema,
  TaskResponseSchema as SharedTaskResponseSchema,
  TaskStatusSchema as SharedTaskStatusSchema,
  type TaskCreateDTO as SharedTaskCreateDTO,
  type TaskPriority as SharedTaskPriority,
  type TaskStatus as SharedTaskStatus,
  type TaskUpdateDTO as SharedTaskUpdateDTO,
  type TaskResponse as SharedTaskResponse,
} from '@signacare/shared';

// Priority + status enums — the shared schema declares them inline inside
// the Task*Schema z.object() definitions, so re-declare them here as
// named exports for the frontend call sites that reference them.
export const TaskPrioritySchema = SharedTaskPrioritySchema;
export type TaskPriority = SharedTaskPriority;

export const TaskStatusSchema = SharedTaskStatusSchema;
export type TaskStatus = SharedTaskStatus;

// Re-export shared DTO schemas + types under the historical local names.
export const CreateTaskSchema = SharedTaskCreateSchema;
export type CreateTaskDTO = SharedTaskCreateDTO;

export const UpdateTaskSchema = SharedTaskUpdateSchema;
export type UpdateTaskDTO = SharedTaskUpdateDTO;

// Re-export the canonical shared TaskResponse so callers can import it
// from this file under its original name (for historical API compat).
export type { SharedTaskResponse as TaskResponseApi };

// View-type extension: the three JOIN-populated display fields. Backend
// taskService.mapTask() populates these in the response. Optional so raw
// shared TaskResponse objects still satisfy this type. This is the type
// frontend components should import when they render task cards.
//
// Named TaskResponseView (not TaskResponse) so the CI guard
// `check-no-duplicate-api-types.sh` sees TaskResponse is no longer
// declared locally — the only declaration of that name is now in
// @signacare/shared, making shared the single source of truth.
export type TaskResponseView = SharedTaskResponse & {
  createdByName?: string;
  assignedToName?: string | null;
  patientName?: string | null;
  // Audit Tier 9.5 — task_type arrives from the backend in either
  // snake_case (raw row) or camelCase (mapped response). We keep both
  // optional on the view type and provide a `getTaskType()` helper
  // that normalises the access — no more `(task as any).task_type`
  // scattered across pages.
  task_type?: string;
  taskType?: string;
  related_entity_id?: string | null;
  episodeId?: string | null;
};

/**
 * Audit Tier 9.5 — normaliser for the `task_type` field that the
 * backend returns in either snake_case or camelCase depending on the
 * API boundary. Callers prefer task.category when neither is present
 * (older rows). Accepts any task-shaped object carrying these
 * optional fields — typed narrowly enough to catch missing fields
 * while not requiring the full TaskResponseView in every caller.
 */
export interface TaskTypeCarrier {
  task_type?: string;
  taskType?: string;
  category?: string;
}
export function getTaskType(task: TaskTypeCarrier): string {
  return task.task_type ?? task.taskType ?? task.category ?? '';
}

// Schema for consumers that still need runtime validation. The shared
// schema is extended with the three optional display fields.
export const TaskResponseViewSchema = SharedTaskResponseSchema.extend({
  createdByName: z.string().optional(),
  assignedToName: z.string().nullable().optional(),
  patientName: z.string().nullable().optional(),
});
