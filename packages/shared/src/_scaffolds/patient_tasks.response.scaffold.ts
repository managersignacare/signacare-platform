// AUTO-GENERATED scaffold by scripts/generate-types-from-migrations.ts
// DO NOT EDIT MANUALLY. Hand-written Response must `extends` this
// scaffold's Zod schema OR carry a `// @scaffold-divergence: <reason>`
// annotation. The scaffold-extension guard (Phase 0b.1b) enforces this.

import { z } from 'zod';

export const PatientTasksResponseScaffoldSchema = z.object({
  id: z.string().uuid(),
  clinicId: z.string().uuid(),
  patientId: z.string().uuid(),
  title: z.string().max(255),
  description: z.string().nullable().optional(),
  dueDate: z.string().nullable().optional(),
  reminderTime: z.unknown().nullable().optional(),
  status: z.string().max(20),
  completedAt: z.string().datetime().nullable().optional(),
  createdBy: z.string().uuid().nullable().optional(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

export type PatientTasksResponseScaffold = z.infer<typeof PatientTasksResponseScaffoldSchema>;
