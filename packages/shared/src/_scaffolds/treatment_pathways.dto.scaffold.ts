// AUTO-GENERATED scaffold by scripts/generate-types-from-migrations.ts
// DO NOT EDIT MANUALLY. Hand-written DTO must `extends` this scaffold's
// Zod schema OR carry a `// @scaffold-divergence: <reason>` annotation.
// The scaffold-extension guard (Phase 0b.1b) enforces this at merge gate.

import { z } from 'zod';

export const TreatmentPathwaysDtoScaffoldSchema = z.object({
  id: z.string().uuid(),
  patientId: z.string().uuid(),
  clinicId: z.string().uuid(),
  name: z.string().max(200),
  status: z.string().max(30),
  milestones: z.unknown().nullable().optional(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime().nullable().optional(),
  lockVersion: z.number().int(),
});

export type TreatmentPathwaysDtoScaffold = z.infer<typeof TreatmentPathwaysDtoScaffoldSchema>;
