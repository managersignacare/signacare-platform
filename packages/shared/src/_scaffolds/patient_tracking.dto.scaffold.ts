// AUTO-GENERATED scaffold by scripts/generate-types-from-migrations.ts
// DO NOT EDIT MANUALLY. Hand-written DTO must `extends` this scaffold's
// Zod schema OR carry a `// @scaffold-divergence: <reason>` annotation.
// The scaffold-extension guard (Phase 0b.1b) enforces this at merge gate.

import { z } from 'zod';

export const PatientTrackingDtoScaffoldSchema = z.object({
  id: z.string().uuid(),
  clinicId: z.string().uuid(),
  patientId: z.string().uuid(),
  trackingType: z.string().max(30),
  value: z.string().regex(/^-?\d{1,8}(\.\d{0,2})?$/),
  note: z.string().nullable().optional(),
  recordedAt: z.string().datetime(),
  source: z.string().max(20),
  createdAt: z.string().datetime(),
});

export type PatientTrackingDtoScaffold = z.infer<typeof PatientTrackingDtoScaffoldSchema>;
