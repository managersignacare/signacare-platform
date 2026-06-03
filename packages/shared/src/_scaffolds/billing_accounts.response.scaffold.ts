// AUTO-GENERATED scaffold by scripts/generate-types-from-migrations.ts
// DO NOT EDIT MANUALLY. Hand-written Response must `extends` this
// scaffold's Zod schema OR carry a `// @scaffold-divergence: <reason>`
// annotation. The scaffold-extension guard (Phase 0b.1b) enforces this.

import { z } from 'zod';

export const BillingAccountsResponseScaffoldSchema = z.object({
  id: z.string().uuid(),
  clinicId: z.string().uuid(),
  patientId: z.string().uuid().nullable().optional(),
  accountType: z.string().max(50).nullable().optional(),
  medicareNumber: z.string().max(30).nullable().optional(),
  dvaNumber: z.string().max(30).nullable().optional(),
  privateHealthFund: z.string().max(100).nullable().optional(),
  memberNumber: z.string().max(50).nullable().optional(),
  isActive: z.boolean().nullable().optional(),
  createdAt: z.string().datetime(),
  billingType: z.string().max(30).nullable().optional(),
  healthFundName: z.string().max(100).nullable().optional(),
  healthFundMemberNumber: z.string().max(50).nullable().optional(),
  ndisNumber: z.string().max(30).nullable().optional(),
  ndisPackageManager: z.string().max(200).nullable().optional(),
  dvaCardType: z.string().max(10).nullable().optional(),
  notes: z.string().nullable().optional(),
  updatedAt: z.string().datetime().nullable().optional(),
});

export type BillingAccountsResponseScaffold = z.infer<typeof BillingAccountsResponseScaffoldSchema>;
