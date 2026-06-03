// AUTO-GENERATED scaffold by scripts/generate-types-from-migrations.ts
// DO NOT EDIT MANUALLY. Hand-written Response must `extends` this
// scaffold's Zod schema OR carry a `// @scaffold-divergence: <reason>`
// annotation. The scaffold-extension guard (Phase 0b.1b) enforces this.

import { z } from 'zod';

export const NursingAssessmentsResponseScaffoldSchema = z.object({
  id: z.string().uuid(),
  clinicId: z.string().uuid(),
  patientId: z.string().uuid(),
  episodeId: z.string().uuid().nullable().optional(),
  staffId: z.string().uuid().nullable().optional(),
  assessmentType: z.string().max(50),
  scores: z.unknown().nullable().optional(),
  assessmentData: z.unknown().nullable().optional(),
  totalScore: z.string().regex(/^-?\d{1,6}(\.\d{0,2})?$/).nullable().optional(),
  riskLevel: z.string().max(30).nullable().optional(),
  notes: z.string().nullable().optional(),
  plan: z.string().nullable().optional(),
  assessedAt: z.string().datetime(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  nextReviewAt: z.string().datetime().nullable().optional(),
});

export type NursingAssessmentsResponseScaffold = z.infer<typeof NursingAssessmentsResponseScaffoldSchema>;
