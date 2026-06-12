// AUTO-GENERATED scaffold by scripts/generate-types-from-migrations.ts
// DO NOT EDIT MANUALLY. Hand-written Response must `extends` this
// scaffold's Zod schema OR carry a `// @scaffold-divergence: <reason>`
// annotation. The scaffold-extension guard (Phase 0b.1b) enforces this.

import { z } from 'zod';

export const TreatmentPathwaysResponseScaffoldSchema = z.object({
  id: z.string().uuid(),
  patientId: z.string().uuid(),
  clinicId: z.string().uuid(),
  name: z.string().max(200),
  status: z.string().max(30),
  milestones: z.unknown().nullable().optional(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime().nullable().optional(),
  lockVersion: z.number().int(),
  updatedByStaffId: z.string().uuid().nullable().optional(),
});

export type TreatmentPathwaysResponseScaffold = z.infer<typeof TreatmentPathwaysResponseScaffoldSchema>;
