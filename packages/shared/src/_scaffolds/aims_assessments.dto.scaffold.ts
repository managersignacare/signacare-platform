// AUTO-GENERATED scaffold by scripts/generate-types-from-migrations.ts
// DO NOT EDIT MANUALLY. Hand-written DTO must `extends` this scaffold's
// Zod schema OR carry a `// @scaffold-divergence: <reason>` annotation.
// The scaffold-extension guard (Phase 0b.1b) enforces this at merge gate.

import { z } from 'zod';

export const AimsAssessmentsDtoScaffoldSchema = z.object({
  id: z.string().uuid(),
  clinicId: z.string().uuid(),
  patientId: z.string().uuid(),
  laiScheduleId: z.string().uuid().nullable().optional(),
  assessedByStaffId: z.string().uuid(),
  assessmentDate: z.string(),
  itemScores: z.unknown(),
  totalScore: z.number().int().nullable().optional(),
  interpretation: z.string().max(100).nullable().optional(),
  globalSeverity: z.number().int().nullable().optional(),
  incapacitation: z.number().int().nullable().optional(),
  patientAwareness: z.number().int().nullable().optional(),
  currentDentalProblems: z.boolean(),
  dentures: z.boolean(),
  clinicalNotes: z.string().nullable().optional(),
  isBaseline: z.boolean(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  deletedAt: z.string().datetime().nullable().optional(),
});

export type AimsAssessmentsDtoScaffold = z.infer<typeof AimsAssessmentsDtoScaffoldSchema>;
