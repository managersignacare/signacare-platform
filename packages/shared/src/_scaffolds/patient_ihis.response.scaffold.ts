// AUTO-GENERATED scaffold by scripts/generate-types-from-migrations.ts
// DO NOT EDIT MANUALLY. Hand-written Response must `extends` this
// scaffold's Zod schema OR carry a `// @scaffold-divergence: <reason>`
// annotation. The scaffold-extension guard (Phase 0b.1b) enforces this.

import { z } from 'zod';

export const PatientIhisResponseScaffoldSchema = z.object({
  id: z.string().uuid(),
  clinicId: z.string().uuid(),
  patientId: z.string().uuid(),
  ihiValue: z.string(),
  ihiLookup: z.string(),
  recordStatus: z.string(),
  numberStatus: z.string(),
  source: z.string(),
  hiVerifiedAt: z.string().datetime(),
  hiDisplayNameOriginal: z.string().nullable().optional(),
  hiDisplayName40: z.string().nullable().optional(),
  hiNameWasTruncated: z.boolean(),
  createdByStaffId: z.string().uuid().nullable().optional(),
  createdAt: z.string().datetime(),
});

export type PatientIhisResponseScaffold = z.infer<typeof PatientIhisResponseScaffoldSchema>;
