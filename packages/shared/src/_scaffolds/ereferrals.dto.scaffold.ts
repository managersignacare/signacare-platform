// AUTO-GENERATED scaffold by scripts/generate-types-from-migrations.ts
// DO NOT EDIT MANUALLY. Hand-written DTO must `extends` this scaffold's
// Zod schema OR carry a `// @scaffold-divergence: <reason>` annotation.
// The scaffold-extension guard (Phase 0b.1b) enforces this at merge gate.

import { z } from 'zod';

export const EreferralsDtoScaffoldSchema = z.object({
  id: z.string().uuid(),
  patientId: z.string().uuid().nullable().optional(),
  clinicId: z.string().uuid(),
  referrerName: z.string().max(200).nullable().optional(),
  referrerOrg: z.string().max(200).nullable().optional(),
  referrerPhone: z.string().max(30).nullable().optional(),
  referrerEmail: z.string().max(255).nullable().optional(),
  priority: z.string().max(30),
  status: z.string().max(30),
  content: z.unknown().nullable().optional(),
  reason: z.string().nullable().optional(),
  clinicalSummary: z.string().nullable().optional(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime().nullable().optional(),
});

export type EreferralsDtoScaffold = z.infer<typeof EreferralsDtoScaffoldSchema>;
