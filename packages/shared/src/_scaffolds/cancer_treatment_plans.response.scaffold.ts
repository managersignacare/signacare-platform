// AUTO-GENERATED scaffold by scripts/generate-types-from-migrations.ts
// DO NOT EDIT MANUALLY. Hand-written Response must `extends` this
// scaffold's Zod schema OR carry a `// @scaffold-divergence: <reason>`
// annotation. The scaffold-extension guard (Phase 0b.1b) enforces this.

import { z } from 'zod';

export const CancerTreatmentPlansResponseScaffoldSchema = z.object({
  id: z.string().uuid(),
  clinicId: z.string().uuid(),
  conditionId: z.string().uuid(),
  regimenName: z.string().max(200),
  intent: z.string().max(20),
  protocolRef: z.string().max(200).nullable().optional(),
  startDate: z.string(),
  endDate: z.string().nullable().optional(),
  status: z.string().max(20),
  notes: z.string().nullable().optional(),
  createdByStaffId: z.string().uuid().nullable().optional(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  deletedAt: z.string().datetime().nullable().optional(),
});

export type CancerTreatmentPlansResponseScaffold = z.infer<typeof CancerTreatmentPlansResponseScaffoldSchema>;
