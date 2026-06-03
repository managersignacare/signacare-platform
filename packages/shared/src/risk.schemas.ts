// packages/shared/src/risk.schemas.ts
import { z } from 'zod';

function isFormalInstrumentAssessmentType(assessmentType: string): boolean {
  const normalized = assessmentType.trim().toLowerCase();
  return (
    normalized.includes('c-ssrs')
    || normalized.includes('cssrs')
    || normalized.includes('columbia')
    || normalized.includes('honos')
  );
}

const RiskAssessmentBaseSchema = z.object({
  patientId:           z.string().uuid(),
  episodeId:           z.string().uuid().optional(),
  templateInstanceId:  z.string().uuid().optional(),
  assessmentType:      z.string().max(100).default('clinical'),
  totalScore:          z.number().min(0).max(999999.99).optional(),
  scoreBand:           z.string().max(50).optional(),
  overallRiskLevel:    z.enum(['low', 'medium', 'high', 'very_high']).default('low'),
  suicideRisk:         z.boolean().default(false),
  selfHarmRisk:        z.boolean().default(false),
  harmToOthersRisk:    z.boolean().default(false),
  abscondingRisk:      z.boolean().default(false),
  vulnerabilityRisk:   z.boolean().default(false),
  protectiveFactors:   z.string().optional(),
  riskNarrative:       z.string().optional(),
  riskManagementPlan:  z.string().optional(),
  safetyPlanInPlace:   z.boolean().default(false),
  safetyPlanSummary:   z.string().optional(),
  assessmentDate:      z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  reviewDate:          z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});

export const RiskAssessmentCreateSchema = RiskAssessmentBaseSchema.superRefine((dto, ctx) => {
  if (!isFormalInstrumentAssessmentType(dto.assessmentType)) return;

  if (dto.totalScore === undefined) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['totalScore'],
      message: 'Formal instrument assessments require totalScore',
    });
  }
  if (!dto.scoreBand || dto.scoreBand.trim().length === 0) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['scoreBand'],
      message: 'Formal instrument assessments require scoreBand',
    });
  }
  if (!dto.riskNarrative || dto.riskNarrative.trim().length === 0) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['riskNarrative'],
      message: 'Formal instrument assessments require riskNarrative',
    });
  }
  if (!dto.riskManagementPlan || dto.riskManagementPlan.trim().length === 0) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['riskManagementPlan'],
      message: 'Formal instrument assessments require riskManagementPlan',
    });
  }
  if (!dto.reviewDate) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['reviewDate'],
      message: 'Formal instrument assessments require reviewDate',
    });
  }
});
export type RiskAssessmentCreateDTO = z.infer<typeof RiskAssessmentCreateSchema>;

export const RiskAssessmentResponseSchema = RiskAssessmentBaseSchema.extend({
  id:                z.string().uuid(),
  clinicId:          z.string().uuid(),
  // BUG-564 — opt-lock version. Future UPDATE paths require the client
  // to echo this back as `expectedLockVersion`; the helper increments
  // it monotonically. Today there is no UPDATE endpoint so the field
  // is read-only — preventive enforcement so any future UPDATE author
  // finds the column already present and routes through the helper.
  lockVersion:       z.number().int().nonnegative(),
  // Required on CREATE but nullable in response for legacy/seeded records
  assessedByStaffId: z.string().uuid().nullable(),
  assessorName:      z.string().optional(),
  createdAt:         z.string(),
  updatedAt:         z.string(),
});
export type RiskAssessmentResponse = z.infer<typeof RiskAssessmentResponseSchema>;
