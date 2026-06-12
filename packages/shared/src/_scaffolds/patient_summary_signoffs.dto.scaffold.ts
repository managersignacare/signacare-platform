// AUTO-GENERATED scaffold by scripts/generate-types-from-migrations.ts
// DO NOT EDIT MANUALLY. Hand-written DTO must `extends` this scaffold's
// Zod schema OR carry a `// @scaffold-divergence: <reason>` annotation.
// The scaffold-extension guard (Phase 0b.1b) enforces this at merge gate.

import { z } from 'zod';

export const PatientSummarySignoffsDtoScaffoldSchema = z.object({
  id: z.string().uuid(),
  clinicId: z.string().uuid(),
  patientId: z.string().uuid(),
  summarySection: z.string().max(64),
  signedOffById: z.string().uuid(),
  signedOffAt: z.string().datetime(),
  reviewDueDate: z.string(),
  reviewIntervalMonths: z.number().int(),
  reminderTaskId: z.string().uuid().nullable().optional(),
  lockVersion: z.number().int(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

export type PatientSummarySignoffsDtoScaffold = z.infer<typeof PatientSummarySignoffsDtoScaffoldSchema>;
