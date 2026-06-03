// AUTO-GENERATED scaffold by scripts/generate-types-from-migrations.ts
// DO NOT EDIT MANUALLY. Hand-written DTO must `extends` this scaffold's
// Zod schema OR carry a `// @scaffold-divergence: <reason>` annotation.
// The scaffold-extension guard (Phase 0b.1b) enforces this at merge gate.

import { z } from 'zod';

export const RiskAssessmentsDtoScaffoldSchema = z.object({
  id: z.string().uuid(),
  clinicId: z.string().uuid(),
  patientId: z.string().uuid(),
  episodeId: z.string().uuid().nullable().optional(),
  templateSubmissionId: z.string().uuid().nullable().optional(),
  assessmentType: z.string().max(50),
  totalScore: z.string().regex(/^-?\d{1,6}(\.\d{0,2})?$/).nullable().optional(),
  scoreBand: z.string().max(50).nullable().optional(),
  interpretationDetail: z.unknown().nullable().optional(),
  overallRiskLevel: z.string().max(30),
  suicideRisk: z.boolean(),
  selfHarmRisk: z.boolean(),
  harmToOthersRisk: z.boolean(),
  abscondingRisk: z.boolean(),
  vulnerabilityRisk: z.boolean(),
  protectiveFactors: z.string().nullable().optional(),
  riskNarrative: z.string().nullable().optional(),
  riskManagementPlan: z.string().nullable().optional(),
  safetyPlanInPlace: z.boolean(),
  safetyPlanSummary: z.string().nullable().optional(),
  assessedById: z.string().uuid(),
  assessmentDate: z.string(),
  reviewDate: z.string().nullable().optional(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  deletedAt: z.string().datetime().nullable().optional(),
  lockVersion: z.number().int(),
});

export type RiskAssessmentsDtoScaffold = z.infer<typeof RiskAssessmentsDtoScaffoldSchema>;
