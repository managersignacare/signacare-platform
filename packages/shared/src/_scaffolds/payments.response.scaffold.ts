// AUTO-GENERATED scaffold by scripts/generate-types-from-migrations.ts
// DO NOT EDIT MANUALLY. Hand-written Response must `extends` this
// scaffold's Zod schema OR carry a `// @scaffold-divergence: <reason>`
// annotation. The scaffold-extension guard (Phase 0b.1b) enforces this.

import { z } from 'zod';

export const PaymentsResponseScaffoldSchema = z.object({
  id: z.string().uuid(),
  invoiceId: z.string().uuid().nullable().optional(),
  clinicId: z.string().uuid(),
  amountCents: z.number().int().nullable().optional(),
  paymentMethod: z.string().max(50).nullable().optional(),
  reference: z.string().max(100).nullable().optional(),
  status: z.string().max(30).nullable().optional(),
  paidAt: z.string().datetime().nullable().optional(),
  createdAt: z.string().datetime(),
  receivedById: z.string().uuid().nullable().optional(),
  paymentDate: z.string().nullable().optional(),
  claimStatus: z.string().max(30).nullable().optional(),
  claimReference: z.string().max(100).nullable().optional(),
  notes: z.string().nullable().optional(),
  updatedAt: z.string().datetime().nullable().optional(),
});

export type PaymentsResponseScaffold = z.infer<typeof PaymentsResponseScaffoldSchema>;
