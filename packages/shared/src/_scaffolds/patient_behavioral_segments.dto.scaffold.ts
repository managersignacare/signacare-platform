// AUTO-GENERATED scaffold by scripts/generate-types-from-migrations.ts
// DO NOT EDIT MANUALLY. Hand-written DTO must `extends` this scaffold's
// Zod schema OR carry a `// @scaffold-divergence: <reason>` annotation.
// The scaffold-extension guard (Phase 0b.1b) enforces this at merge gate.

import { z } from 'zod';

export const PatientBehavioralSegmentsDtoScaffoldSchema = z.object({
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

export type PatientBehavioralSegmentsDtoScaffold = z.infer<typeof PatientBehavioralSegmentsDtoScaffoldSchema>;
