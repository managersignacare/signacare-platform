// AUTO-GENERATED scaffold by scripts/generate-types-from-migrations.ts
// DO NOT EDIT MANUALLY. Hand-written Response must `extends` this
// scaffold's Zod schema OR carry a `// @scaffold-divergence: <reason>`
// annotation. The scaffold-extension guard (Phase 0b.1b) enforces this.

import { z } from 'zod';

export const MhaReviewsResponseScaffoldSchema = z.object({
  id: z.string().uuid(),
  clinicId: z.string().uuid(),
  patientId: z.string().uuid(),
  legalOrderId: z.string().uuid(),
  orderId: z.string().uuid().nullable().optional(),
  reviewType: z.string().max(50),
  reviewDate: z.string(),
  outcome: z.string().max(50).nullable().optional(),
  notes: z.string().nullable().optional(),
  clinicalNotes: z.string().nullable().optional(),
  nextReviewDate: z.string().nullable().optional(),
  reviewedByStaffId: z.string().uuid().nullable().optional(),
  reviewedById: z.string().uuid().nullable().optional(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  deletedAt: z.string().datetime().nullable().optional(),
  lockVersion: z.number().int(),
});

export type MhaReviewsResponseScaffold = z.infer<typeof MhaReviewsResponseScaffoldSchema>;
