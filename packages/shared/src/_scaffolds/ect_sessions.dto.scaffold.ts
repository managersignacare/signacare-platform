// AUTO-GENERATED scaffold by scripts/generate-types-from-migrations.ts
// DO NOT EDIT MANUALLY. Hand-written DTO must `extends` this scaffold's
// Zod schema OR carry a `// @scaffold-divergence: <reason>` annotation.
// The scaffold-extension guard (Phase 0b.1b) enforces this at merge gate.

import { z } from 'zod';

export const EctSessionsDtoScaffoldSchema = z.object({
  id: z.string().uuid(),
  courseId: z.string().uuid(),
  clinicId: z.string().uuid(),
  sessionNumber: z.number().int(),
  sessionDate: z.string(),
  stimulusDoseMc: z.string().regex(/^-?\d{1,6}(\.\d{0,2})?$/).nullable().optional(),
  seizureDurationSec: z.number().int().nullable().optional(),
  electrodePlacement: z.string().max(30),
  anaestheticAgent: z.string().max(100).nullable().optional(),
  muscleRelaxant: z.string().max(100).nullable().optional(),
  preTreatmentBp: z.string().max(20).nullable().optional(),
  postTreatmentBp: z.string().max(20).nullable().optional(),
  mmseScore: z.number().int().nullable().optional(),
  adverseEvents: z.string().nullable().optional(),
  clinicianNotes: z.string().nullable().optional(),
  administeredBy: z.string().uuid(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

export type EctSessionsDtoScaffold = z.infer<typeof EctSessionsDtoScaffoldSchema>;
