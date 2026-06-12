import { z } from 'zod';

export const TASK_STATUS_VALUES = [
  'pending',
  'open',
  'todo',
  'in_progress',
  'blocked',
  'waiting_external',
  'review_pending',
  'completed',
  'cancelled',
] as const;
export const TaskStatusSchema = z.enum(TASK_STATUS_VALUES);
export type TaskStatus = z.infer<typeof TaskStatusSchema>;

export const OPEN_TASK_STATUSES = [
  'pending',
  'open',
  'todo',
  'in_progress',
  'blocked',
  'waiting_external',
  'review_pending',
] as const;

export const TaskPrioritySchema = z.enum(['low', 'medium', 'high', 'urgent']);
export type TaskPriority = z.infer<typeof TaskPrioritySchema>;

export const TaskDueBucketSchema = z.enum([
  'overdue',
  'today',
  'next_7_days',
  'undated',
]);
export type TaskDueBucket = z.infer<typeof TaskDueBucketSchema>;

export const TaskOwnershipFilterSchema = z.enum([
  'assigned',
  'unassigned',
]);
export type TaskOwnershipFilter = z.infer<typeof TaskOwnershipFilterSchema>;

export const TaskCreateSchema = z.object({
  patientId: z.string().uuid().optional(),
  episodeId: z.string().uuid().optional(),
  assignedToId: z.string().uuid().optional(),
  title: z.string().min(1).max(255),
  description: z.string().optional(),
  priority: TaskPrioritySchema.default('medium'),
  dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});
export type TaskCreateDTO = z.infer<typeof TaskCreateSchema>;

export const TaskUpdateSchema = z.object({
  assignedToId: z.string().uuid().nullable().optional(),
  title: z.string().min(1).max(255).optional(),
  description: z.string().nullable().optional(),
  priority: TaskPrioritySchema.optional(),
  status: TaskStatusSchema.optional(),
  dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
}).refine((d) => Object.keys(d).length > 0, { message: 'At least one field required' });
export type TaskUpdateDTO = z.infer<typeof TaskUpdateSchema>;

export const TaskResponseSchema = z.object({
  id: z.string().uuid(),
  clinicId: z.string().uuid(),
  createdById: z.string().uuid(),
  assignedToId: z.string().uuid().nullable(),
  patientId: z.string().uuid().nullable(),
  episodeId: z.string().uuid().nullable(),
  title: z.string(),
  description: z.string().nullable(),
  priority: TaskPrioritySchema,
  status: TaskStatusSchema,
  dueDate: z.string().nullable(),
  completedAt: z.string().datetime().nullable(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type TaskResponse = z.infer<typeof TaskResponseSchema>;

export const TaskListQuerySchema = z.object({
  patientId: z.string().uuid().optional(),
  episodeId: z.string().uuid().optional(),
  assignedToId: z.string().uuid().optional(),
  teamId: z.string().uuid().optional(),
  teamScope: z.enum(['mine']).optional(),
  status: TaskStatusSchema.optional(),
  priority: TaskPrioritySchema.optional(),
  dueBefore: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  dueBucket: TaskDueBucketSchema.optional(),
  ownership: TaskOwnershipFilterSchema.optional(),
});
export type TaskListQuery = z.infer<typeof TaskListQuerySchema>;

export const TaskSummaryCountSchema = z.object({
  key: z.string().min(1),
  label: z.string().min(1),
  count: z.number().int().nonnegative(),
});
export type TaskSummaryCount = z.infer<typeof TaskSummaryCountSchema>;

export const TaskAssigneeWorkloadSchema = z.object({
  staffId: z.string().uuid().nullable(),
  displayName: z.string(),
  openCount: z.number().int().nonnegative(),
  overdueCount: z.number().int().nonnegative(),
  dueTodayCount: z.number().int().nonnegative(),
  blockedCount: z.number().int().nonnegative(),
  waitingExternalCount: z.number().int().nonnegative(),
});
export type TaskAssigneeWorkload = z.infer<typeof TaskAssigneeWorkloadSchema>;

export const TaskMonitoringSummarySchema = z.object({
  totals: z.object({
    open: z.number().int().nonnegative(),
    overdue: z.number().int().nonnegative(),
    dueToday: z.number().int().nonnegative(),
    dueNext7Days: z.number().int().nonnegative(),
    undated: z.number().int().nonnegative(),
    blocked: z.number().int().nonnegative(),
    waitingExternal: z.number().int().nonnegative(),
    reviewPending: z.number().int().nonnegative(),
    unassigned: z.number().int().nonnegative(),
    urgent: z.number().int().nonnegative(),
    completed: z.number().int().nonnegative(),
  }),
  dueBuckets: z.array(TaskSummaryCountSchema),
  statusBreakdown: z.array(TaskSummaryCountSchema),
  priorityBreakdown: z.array(TaskSummaryCountSchema),
  assigneeBreakdown: z.array(TaskAssigneeWorkloadSchema),
});
export type TaskMonitoringSummary = z.infer<typeof TaskMonitoringSummarySchema>;
