// AUTO-GENERATED scaffold by scripts/generate-types-from-migrations.ts
// DO NOT EDIT MANUALLY. Hand-written Response must `extends` this
// scaffold's Zod schema OR carry a `// @scaffold-divergence: <reason>`
// annotation. The scaffold-extension guard (Phase 0b.1b) enforces this.

import { z } from 'zod';

export const LaiValidationsResponseScaffoldSchema = z.object({
  id: z.string().uuid(),
  clinicId: z.string().uuid(),
  laiScheduleId: z.string().uuid(),
  patientId: z.string().uuid(),
  validatedByStaffId: z.string().uuid(),
  validationDate: z.string(),
  validUntil: z.string(),
  validationType: z.string().max(30),
  outcome: z.string().max(20),
  clinicalRationale: z.string().nullable().optional(),
  sideEffectsReviewed: z.string().nullable().optional(),
  consentConfirmed: z.boolean(),
  bloodTestsReviewed: z.boolean(),
  aimsReviewed: z.boolean(),
  notes: z.string().nullable().optional(),
  createdAt: z.string().datetime(),
});

export type LaiValidationsResponseScaffold = z.infer<typeof LaiValidationsResponseScaffoldSchema>;
