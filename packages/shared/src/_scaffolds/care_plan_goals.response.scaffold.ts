// AUTO-GENERATED scaffold by scripts/generate-types-from-migrations.ts
// DO NOT EDIT MANUALLY. Hand-written Response must `extends` this
// scaffold's Zod schema OR carry a `// @scaffold-divergence: <reason>`
// annotation. The scaffold-extension guard (Phase 0b.1b) enforces this.

import { z } from 'zod';

export const CarePlanGoalsResponseScaffoldSchema = z.object({
  id: z.string().uuid(),
  clinicId: z.string().uuid(),
  treatmentPlanId: z.string().uuid(),
  goalText: z.string().max(500),
  description: z.string().nullable().optional(),
  goalType: z.string().max(50),
  targetDate: z.string().nullable().optional(),
  status: z.string().max(30),
  sortOrder: z.number().int(),
  measurable: z.string().nullable().optional(),
  patientSelfRated: z.string().nullable().optional(),
  createdById: z.string().uuid().nullable().optional(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

export type CarePlanGoalsResponseScaffold = z.infer<typeof CarePlanGoalsResponseScaffoldSchema>;
