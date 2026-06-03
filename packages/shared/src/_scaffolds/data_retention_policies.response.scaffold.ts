// AUTO-GENERATED scaffold by scripts/generate-types-from-migrations.ts
// DO NOT EDIT MANUALLY. Hand-written Response must `extends` this
// scaffold's Zod schema OR carry a `// @scaffold-divergence: <reason>`
// annotation. The scaffold-extension guard (Phase 0b.1b) enforces this.

import { z } from 'zod';

export const DataRetentionPoliciesResponseScaffoldSchema = z.object({
  id: z.string().uuid(),
  clinicId: z.string().uuid(),
  dataCategory: z.string().max(100),
  retentionYears: z.number().int(),
  legalBasis: z.string().nullable().optional(),
  disposalMethod: z.string().nullable().optional(),
  isActive: z.boolean(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

export type DataRetentionPoliciesResponseScaffold = z.infer<typeof DataRetentionPoliciesResponseScaffoldSchema>;
