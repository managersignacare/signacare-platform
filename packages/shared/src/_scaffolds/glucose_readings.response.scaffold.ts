// AUTO-GENERATED scaffold by scripts/generate-types-from-migrations.ts
// DO NOT EDIT MANUALLY. Hand-written Response must `extends` this
// scaffold's Zod schema OR carry a `// @scaffold-divergence: <reason>`
// annotation. The scaffold-extension guard (Phase 0b.1b) enforces this.

import { z } from 'zod';

export const GlucoseReadingsResponseScaffoldSchema = z.object({
  id: z.string().uuid(),
  clinicId: z.string().uuid(),
  patientId: z.string().uuid(),
  episodeId: z.string().uuid().nullable().optional(),
  value: z.string().regex(/^-?\d{1,4}(\.\d{0,2})?$/),
  unit: z.string().max(10),
  source: z.string().max(20),
  mealContext: z.string().max(20).nullable().optional(),
  measuredAt: z.string().datetime(),
  recordedBy: z.string().uuid().nullable().optional(),
  note: z.string().nullable().optional(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  deletedAt: z.string().datetime().nullable().optional(),
});

export type GlucoseReadingsResponseScaffold = z.infer<typeof GlucoseReadingsResponseScaffoldSchema>;
