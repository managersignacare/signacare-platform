// AUTO-GENERATED scaffold by scripts/generate-types-from-migrations.ts
// DO NOT EDIT MANUALLY. Hand-written DTO must `extends` this scaffold's
// Zod schema OR carry a `// @scaffold-divergence: <reason>` annotation.
// The scaffold-extension guard (Phase 0b.1b) enforces this at merge gate.

import { z } from 'zod';

export const ReferralClinicianOffersDtoScaffoldSchema = z.object({
  id: z.string().uuid(),
  clinicId: z.string().uuid(),
  referralId: z.string().uuid(),
  staffId: z.string().uuid(),
  offeredAt: z.string().datetime(),
  response: z.string().max(20),
  respondedAt: z.string().datetime().nullable().optional(),
  declineReason: z.string().nullable().optional(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

export type ReferralClinicianOffersDtoScaffold = z.infer<typeof ReferralClinicianOffersDtoScaffoldSchema>;
