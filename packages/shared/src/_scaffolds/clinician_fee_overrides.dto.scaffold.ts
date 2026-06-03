// AUTO-GENERATED scaffold by scripts/generate-types-from-migrations.ts
// DO NOT EDIT MANUALLY. Hand-written DTO must `extends` this scaffold's
// Zod schema OR carry a `// @scaffold-divergence: <reason>` annotation.
// The scaffold-extension guard (Phase 0b.1b) enforces this at merge gate.

import { z } from 'zod';

export const ClinicianFeeOverridesDtoScaffoldSchema = z.object({
  id: z.string().uuid(),
  clinicId: z.string().uuid(),
  staffId: z.string().uuid(),
  itemNumber: z.string().max(20),
  providerFeeCents: z.number().int(),
  gapCents: z.number().int(),
  bulkBillEligible: z.boolean(),
  notes: z.string().nullable().optional(),
  isActive: z.boolean(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

export type ClinicianFeeOverridesDtoScaffold = z.infer<typeof ClinicianFeeOverridesDtoScaffoldSchema>;
