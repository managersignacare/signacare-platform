// AUTO-GENERATED scaffold by scripts/generate-types-from-migrations.ts
// DO NOT EDIT MANUALLY. Hand-written DTO must `extends` this scaffold's
// Zod schema OR carry a `// @scaffold-divergence: <reason>` annotation.
// The scaffold-extension guard (Phase 0b.1b) enforces this at merge gate.

import { z } from 'zod';

export const PatientFcmTokensDtoScaffoldSchema = z.object({
  id: z.string().uuid(),
  clinicId: z.string().uuid(),
  patientId: z.string().uuid(),
  patientAppAccountId: z.string().uuid().nullable().optional(),
  deviceToken: z.string(),
  platform: z.string().max(10),
  lastSeenAt: z.string().datetime(),
  createdAt: z.string().datetime(),
  deletedAt: z.string().datetime().nullable().optional(),
});

export type PatientFcmTokensDtoScaffold = z.infer<typeof PatientFcmTokensDtoScaffoldSchema>;
