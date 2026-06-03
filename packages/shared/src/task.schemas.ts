import { z } from 'zod';

export const TASK_STATUS_VALUES = [
  'pending',
  'open',
  'todo',
  'in_progress',
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
] as const;

export const TaskCreateSchema = z.object({
  patientId: z.string().uuid().optional(),
  episodeId: z.string().uuid().optional(),
  assignedToId: z.string().uuid().optional(),
  title: z.string().min(1).max(255),
  description: z.string().optional(),
  priority: z.enum(['low', 'medium', 'high', 'urgent']).default('medium'),
  dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});
export type TaskCreateDTO = z.infer<typeof TaskCreateSchema>;

export const TaskUpdateSchema = z.object({
  assignedToId: z.string().uuid().nullable().optional(),
  title: z.string().min(1).max(255).optional(),
  description: z.string().nullable().optional(),
  priority: z.enum(['low', 'medium', 'high', 'urgent']).optional(),
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
  priority: z.enum(['low', 'medium', 'high', 'urgent']),
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
  priority: z.enum(['low', 'medium', 'high', 'urgent']).optional(),
  dueBefore: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});
export type TaskListQuery = z.infer<typeof TaskListQuerySchema>;
