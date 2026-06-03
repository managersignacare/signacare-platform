// AUTO-GENERATED scaffold by scripts/generate-types-from-migrations.ts
// DO NOT EDIT MANUALLY. Hand-written DTO must `extends` this scaffold's
// Zod schema OR carry a `// @scaffold-divergence: <reason>` annotation.
// The scaffold-extension guard (Phase 0b.1b) enforces this at merge gate.

import { z } from 'zod';

export const BillingQueueDtoScaffoldSchema = z.object({
  id: z.string().uuid(),
  clinicId: z.string().uuid(),
  invoiceId: z.string().uuid(),
  claimType: z.string().max(20),
  status: z.string().max(20),
  submittedAt: z.string().datetime().nullable().optional(),
  responseCode: z.string().max(50).nullable().optional(),
  responseMessage: z.string().nullable().optional(),
  createdAt: z.string().datetime(),
});

export type BillingQueueDtoScaffold = z.infer<typeof BillingQueueDtoScaffoldSchema>;
