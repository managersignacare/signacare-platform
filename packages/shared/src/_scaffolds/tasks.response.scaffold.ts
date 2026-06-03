// AUTO-GENERATED scaffold by scripts/generate-types-from-migrations.ts
// DO NOT EDIT MANUALLY. Hand-written Response must `extends` this
// scaffold's Zod schema OR carry a `// @scaffold-divergence: <reason>`
// annotation. The scaffold-extension guard (Phase 0b.1b) enforces this.

import { z } from 'zod';

export const TasksResponseScaffoldSchema = z.object({
  id: z.string().uuid(),
  clinicId: z.string().uuid(),
  patientId: z.string().uuid().nullable().optional(),
  episodeId: z.string().uuid().nullable().optional(),
  assignedToId: z.string().uuid().nullable().optional(),
  assignedById: z.string().uuid().nullable().optional(),
  title: z.string().max(300),
  description: z.string().nullable().optional(),
  taskType: z.string().max(50).nullable().optional(),
  priority: z.string().max(30).nullable().optional(),
  status: z.string().max(30).nullable().optional(),
  dueDate: z.string().nullable().optional(),
  completedAt: z.string().datetime().nullable().optional(),
  completedById: z.string().uuid().nullable().optional(),
  notes: z.string().nullable().optional(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  lockVersion: z.number().int(),
});

export type TasksResponseScaffold = z.infer<typeof TasksResponseScaffoldSchema>;
