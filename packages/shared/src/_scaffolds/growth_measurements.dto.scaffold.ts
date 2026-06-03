// AUTO-GENERATED scaffold by scripts/generate-types-from-migrations.ts
// DO NOT EDIT MANUALLY. Hand-written DTO must `extends` this scaffold's
// Zod schema OR carry a `// @scaffold-divergence: <reason>` annotation.
// The scaffold-extension guard (Phase 0b.1b) enforces this at merge gate.

import { z } from 'zod';

export const GrowthMeasurementsDtoScaffoldSchema = z.object({
  id: z.string().uuid(),
  clinicId: z.string().uuid(),
  patientId: z.string().uuid(),
  episodeId: z.string().uuid().nullable().optional(),
  measurementType: z.string().max(30),
  value: z.string().regex(/^-?\d{1,5}(\.\d{0,3})?$/),
  unit: z.string().max(10),
  ageAtMeasurementDays: z.number().int(),
  percentile: z.string().regex(/^-?\d{1,3}(\.\d{0,2})?$/).nullable().optional(),
  zScore: z.string().regex(/^-?\d{1,3}(\.\d{0,3})?$/).nullable().optional(),
  referenceSource: z.string().max(10).nullable().optional(),
  measuredAt: z.string().datetime(),
  recordedBy: z.string().uuid().nullable().optional(),
  note: z.string().nullable().optional(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  deletedAt: z.string().datetime().nullable().optional(),
});

export type GrowthMeasurementsDtoScaffold = z.infer<typeof GrowthMeasurementsDtoScaffoldSchema>;
