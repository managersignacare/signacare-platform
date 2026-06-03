// AUTO-GENERATED scaffold by scripts/generate-types-from-migrations.ts
// DO NOT EDIT MANUALLY. Hand-written Response must `extends` this
// scaffold's Zod schema OR carry a `// @scaffold-divergence: <reason>`
// annotation. The scaffold-extension guard (Phase 0b.1b) enforces this.

import { z } from 'zod';

export const SubscriptionsResponseScaffoldSchema = z.object({
  id: z.string().uuid(),
  clinicId: z.string().uuid(),
  planType: z.string().max(50),
  seats: z.number().int(),
  pricePerMonth: z.string().regex(/^-?\d{1,6}(\.\d{0,2})?$/),
  pricePerYear: z.string().regex(/^-?\d{1,6}(\.\d{0,2})?$/).nullable().optional(),
  discountPercent: z.string().regex(/^-?\d{1,6}(\.\d{0,2})?$/).nullable().optional(),
  discountAmount: z.string().regex(/^-?\d{1,6}(\.\d{0,2})?$/).nullable().optional(),
  status: z.string().max(30),
  startDate: z.string(),
  endDate: z.string().nullable().optional(),
  renewalDate: z.string().nullable().optional(),
  reminderDays: z.number().int(),
  notes: z.string().nullable().optional(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

export type SubscriptionsResponseScaffold = z.infer<typeof SubscriptionsResponseScaffoldSchema>;
