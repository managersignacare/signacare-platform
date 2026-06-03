// AUTO-GENERATED scaffold by scripts/generate-types-from-migrations.ts
// DO NOT EDIT MANUALLY. Hand-written Response must `extends` this
// scaffold's Zod schema OR carry a `// @scaffold-divergence: <reason>`
// annotation. The scaffold-extension guard (Phase 0b.1b) enforces this.

import { z } from 'zod';

export const InsulinRegimensResponseScaffoldSchema = z.object({
  id: z.string().uuid(),
  clinicId: z.string().uuid(),
  patientId: z.string().uuid(),
  episodeId: z.string().uuid().nullable().optional(),
  basalDrug: z.string().max(100).nullable().optional(),
  basalDoseUnits: z.string().regex(/^-?\d{1,5}(\.\d{0,2})?$/).nullable().optional(),
  basalFrequency: z.string().max(50).nullable().optional(),
  bolusDrug: z.string().max(100).nullable().optional(),
  bolusDoses: z.unknown().nullable().optional(),
  correctionFactor: z.string().regex(/^-?\d{1,4}(\.\d{0,2})?$/).nullable().optional(),
  carbRatio: z.string().regex(/^-?\d{1,4}(\.\d{0,2})?$/).nullable().optional(),
  targetLow: z.string().regex(/^-?\d{1,4}(\.\d{0,2})?$/).nullable().optional(),
  targetHigh: z.string().regex(/^-?\d{1,4}(\.\d{0,2})?$/).nullable().optional(),
  validFrom: z.string().datetime(),
  validTo: z.string().datetime().nullable().optional(),
  note: z.string().nullable().optional(),
  prescribedBy: z.string().uuid().nullable().optional(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  deletedAt: z.string().datetime().nullable().optional(),
});

export type InsulinRegimensResponseScaffold = z.infer<typeof InsulinRegimensResponseScaffoldSchema>;
