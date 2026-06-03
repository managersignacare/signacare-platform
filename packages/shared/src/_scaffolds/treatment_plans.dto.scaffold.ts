// AUTO-GENERATED scaffold by scripts/generate-types-from-migrations.ts
// DO NOT EDIT MANUALLY. Hand-written DTO must `extends` this scaffold's
// Zod schema OR carry a `// @scaffold-divergence: <reason>` annotation.
// The scaffold-extension guard (Phase 0b.1b) enforces this at merge gate.

import { z } from 'zod';

export const TreatmentPlansDtoScaffoldSchema = z.object({
  id: z.string().uuid(),
  patientId: z.string().uuid(),
  clinicId: z.string().uuid(),
  episodeId: z.string().uuid().nullable().optional(),
  staffId: z.string().uuid().nullable().optional(),
  title: z.string().max(300).nullable().optional(),
  status: z.string().max(30).nullable().optional(),
  goals: z.unknown().nullable().optional(),
  interventions: z.unknown().nullable().optional(),
  reviewDate: z.string().nullable().optional(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

export type TreatmentPlansDtoScaffold = z.infer<typeof TreatmentPlansDtoScaffoldSchema>;
