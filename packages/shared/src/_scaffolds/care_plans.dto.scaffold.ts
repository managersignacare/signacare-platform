// AUTO-GENERATED scaffold by scripts/generate-types-from-migrations.ts
// DO NOT EDIT MANUALLY. Hand-written DTO must `extends` this scaffold's
// Zod schema OR carry a `// @scaffold-divergence: <reason>` annotation.
// The scaffold-extension guard (Phase 0b.1b) enforces this at merge gate.

import { z } from 'zod';

export const CarePlansDtoScaffoldSchema = z.object({
  id: z.string().uuid(),
  clinicId: z.string().uuid(),
  patientId: z.string().uuid(),
  episodeId: z.string().uuid().nullable().optional(),
  title: z.string().max(300).nullable().optional(),
  description: z.string().nullable().optional(),
  status: z.string().max(30),
  transitionChecklist: z.unknown().nullable().optional(),
  transitionStatus: z.string().max(30).nullable().optional(),
  transitionTargetDate: z.string().nullable().optional(),
  recoveryStarScores: z.unknown().nullable().optional(),
  recoveryStarUpdatedAt: z.string().datetime().nullable().optional(),
  recoveryStarUpdatedBy: z.string().uuid().nullable().optional(),
  createdById: z.string().uuid().nullable().optional(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  deletedAt: z.string().datetime().nullable().optional(),
});

export type CarePlansDtoScaffold = z.infer<typeof CarePlansDtoScaffoldSchema>;
