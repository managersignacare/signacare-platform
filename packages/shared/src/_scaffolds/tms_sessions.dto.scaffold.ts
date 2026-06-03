// AUTO-GENERATED scaffold by scripts/generate-types-from-migrations.ts
// DO NOT EDIT MANUALLY. Hand-written DTO must `extends` this scaffold's
// Zod schema OR carry a `// @scaffold-divergence: <reason>` annotation.
// The scaffold-extension guard (Phase 0b.1b) enforces this at merge gate.

import { z } from 'zod';

export const TmsSessionsDtoScaffoldSchema = z.object({
  id: z.string().uuid(),
  courseId: z.string().uuid(),
  clinicId: z.string().uuid(),
  sessionNumber: z.number().int(),
  sessionDate: z.string(),
  pulsesDelivered: z.number().int().nullable().optional(),
  intensityPercent: z.number().int().nullable().optional(),
  coilPosition: z.string().max(100).nullable().optional(),
  durationMinutes: z.number().int().nullable().optional(),
  adverseEvents: z.string().nullable().optional(),
  patientTolerance: z.string().max(20),
  administeredBy: z.string().uuid(),
  phq9Score: z.number().int().nullable().optional(),
  clinicianNotes: z.string().nullable().optional(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

export type TmsSessionsDtoScaffold = z.infer<typeof TmsSessionsDtoScaffoldSchema>;
