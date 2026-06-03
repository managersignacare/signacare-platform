// AUTO-GENERATED scaffold by scripts/generate-types-from-migrations.ts
// DO NOT EDIT MANUALLY. Hand-written Response must `extends` this
// scaffold's Zod schema OR carry a `// @scaffold-divergence: <reason>`
// annotation. The scaffold-extension guard (Phase 0b.1b) enforces this.

import { z } from 'zod';

export const PatientBehavioralSegmentsResponseScaffoldSchema = z.object({
  id: z.string().uuid(),
  clinicId: z.string().uuid(),
  patientId: z.string().uuid(),
  segmentCode: z.string().max(40),
  confidenceScore: z.string().regex(/^-?\d{1,2}(\.\d{0,4})?$/),
  rationale: z.unknown(),
  computedAt: z.string().datetime(),
  overrideByStaffId: z.string().uuid().nullable().optional(),
  overrideReason: z.string().nullable().optional(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

export type PatientBehavioralSegmentsResponseScaffold = z.infer<typeof PatientBehavioralSegmentsResponseScaffoldSchema>;
