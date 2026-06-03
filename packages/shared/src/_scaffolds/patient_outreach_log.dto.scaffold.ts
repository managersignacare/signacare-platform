// AUTO-GENERATED scaffold by scripts/generate-types-from-migrations.ts
// DO NOT EDIT MANUALLY. Hand-written DTO must `extends` this scaffold's
// Zod schema OR carry a `// @scaffold-divergence: <reason>` annotation.
// The scaffold-extension guard (Phase 0b.1b) enforces this at merge gate.

import { z } from 'zod';

export const PatientOutreachLogDtoScaffoldSchema = z.object({
  id: z.string().uuid(),
  clinicId: z.string().uuid(),
  patientId: z.string().uuid(),
  kind: z.string().max(60),
  channel: z.string().max(20),
  skipReason: z.string().max(60).nullable().optional(),
  providerMessageId: z.string().nullable().optional(),
  title: z.string().nullable().optional(),
  body: z.string().nullable().optional(),
  deepLink: z.string().nullable().optional(),
  overrideChannel: z.string().max(20).nullable().optional(),
  overrideReason: z.string().nullable().optional(),
  overrideByStaffId: z.string().uuid().nullable().optional(),
  attemptedAt: z.string().datetime(),
  deliveredAt: z.string().datetime().nullable().optional(),
  failedAt: z.string().datetime().nullable().optional(),
  errorMessage: z.string().nullable().optional(),
});

export type PatientOutreachLogDtoScaffold = z.infer<typeof PatientOutreachLogDtoScaffoldSchema>;
