// AUTO-GENERATED scaffold by scripts/generate-types-from-migrations.ts
// DO NOT EDIT MANUALLY. Hand-written DTO must `extends` this scaffold's
// Zod schema OR carry a `// @scaffold-divergence: <reason>` annotation.
// The scaffold-extension guard (Phase 0b.1b) enforces this at merge gate.

import { z } from 'zod';

export const PatientSyncPreferencesDtoScaffoldSchema = z.object({
  id: z.string().uuid(),
  clinicId: z.string().uuid(),
  patientId: z.string().uuid(),
  moduleKey: z.string().max(40),
  enabled: z.boolean(),
  updatedByPatient: z.boolean(),
  updatedByStaffId: z.string().uuid().nullable().optional(),
  updatedAt: z.string().datetime(),
  createdAt: z.string().datetime(),
});

export type PatientSyncPreferencesDtoScaffold = z.infer<typeof PatientSyncPreferencesDtoScaffoldSchema>;
