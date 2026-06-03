// AUTO-GENERATED scaffold by scripts/generate-types-from-migrations.ts
// DO NOT EDIT MANUALLY. Hand-written DTO must `extends` this scaffold's
// Zod schema OR carry a `// @scaffold-divergence: <reason>` annotation.
// The scaffold-extension guard (Phase 0b.1b) enforces this at merge gate.

import { z } from 'zod';

export const ReferralValidityDtoScaffoldSchema = z.object({
  id: z.string().uuid(),
  clinicId: z.string().uuid(),
  patientId: z.string().uuid(),
  referringProviderName: z.string().max(200),
  referringProviderNumber: z.string().max(30).nullable().optional(),
  referralType: z.string().max(20),
  referralDate: z.string(),
  expiresAt: z.string(),
  isActive: z.boolean(),
  notes: z.string().nullable().optional(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

export type ReferralValidityDtoScaffold = z.infer<typeof ReferralValidityDtoScaffoldSchema>;
