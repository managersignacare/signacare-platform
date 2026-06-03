// AUTO-GENERATED scaffold by scripts/generate-types-from-migrations.ts
// DO NOT EDIT MANUALLY. Hand-written DTO must `extends` this scaffold's
// Zod schema OR carry a `// @scaffold-divergence: <reason>` annotation.
// The scaffold-extension guard (Phase 0b.1b) enforces this at merge gate.

import { z } from 'zod';

export const AntenatalVisitsDtoScaffoldSchema = z.object({
  id: z.string().uuid(),
  clinicId: z.string().uuid(),
  pregnancyId: z.string().uuid(),
  patientId: z.string().uuid(),
  visitNumber: z.number().int(),
  visitDate: z.string(),
  gaWeeks: z.number().int(),
  gaDays: z.number().int(),
  fundalHeightCm: z.string().regex(/^-?\d{1,3}(\.\d{0,2})?$/).nullable().optional(),
  fetalHeartRateBpm: z.number().int().nullable().optional(),
  bpSystolic: z.number().int().nullable().optional(),
  bpDiastolic: z.number().int().nullable().optional(),
  urineProtein: z.string().max(10).nullable().optional(),
  urineGlucose: z.string().max(10).nullable().optional(),
  oedema: z.boolean().nullable().optional(),
  note: z.string().nullable().optional(),
  seenBy: z.string().uuid().nullable().optional(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  deletedAt: z.string().datetime().nullable().optional(),
});

export type AntenatalVisitsDtoScaffold = z.infer<typeof AntenatalVisitsDtoScaffoldSchema>;
