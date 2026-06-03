// AUTO-GENERATED scaffold by scripts/generate-types-from-migrations.ts
// DO NOT EDIT MANUALLY. Hand-written Response must `extends` this
// scaffold's Zod schema OR carry a `// @scaffold-divergence: <reason>`
// annotation. The scaffold-extension guard (Phase 0b.1b) enforces this.

import { z } from 'zod';

export const BillingQueueResponseScaffoldSchema = z.object({
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

export type BillingQueueResponseScaffold = z.infer<typeof BillingQueueResponseScaffoldSchema>;
