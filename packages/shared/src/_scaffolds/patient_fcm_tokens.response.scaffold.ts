// AUTO-GENERATED scaffold by scripts/generate-types-from-migrations.ts
// DO NOT EDIT MANUALLY. Hand-written Response must `extends` this
// scaffold's Zod schema OR carry a `// @scaffold-divergence: <reason>`
// annotation. The scaffold-extension guard (Phase 0b.1b) enforces this.

import { z } from 'zod';

export const PatientFcmTokensResponseScaffoldSchema = z.object({
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

export type PatientFcmTokensResponseScaffold = z.infer<typeof PatientFcmTokensResponseScaffoldSchema>;
