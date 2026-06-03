// AUTO-GENERATED scaffold by scripts/generate-types-from-migrations.ts
// DO NOT EDIT MANUALLY. Hand-written DTO must `extends` this scaffold's
// Zod schema OR carry a `// @scaffold-divergence: <reason>` annotation.
// The scaffold-extension guard (Phase 0b.1b) enforces this at merge gate.

import { z } from 'zod';

export const DataSharingAgreementsDtoScaffoldSchema = z.object({
  id: z.string().uuid(),
  clinicId: z.string().uuid(),
  partnerName: z.string().max(255),
  partnerType: z.string().max(50).nullable().optional(),
  purpose: z.string().nullable().optional(),
  dataCategories: z.unknown().nullable().optional(),
  startDate: z.string().nullable().optional(),
  endDate: z.string().nullable().optional(),
  conditions: z.string().nullable().optional(),
  status: z.string().max(30),
  approvedById: z.string().uuid().nullable().optional(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

export type DataSharingAgreementsDtoScaffold = z.infer<typeof DataSharingAgreementsDtoScaffoldSchema>;
