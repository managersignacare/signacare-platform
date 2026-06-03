import { z } from 'zod';

export const FIRST_VISIT_CHART_REVIEW_GATED_NOTE_TYPES = [
  'progress',
  'intake',
  'review',
  'ward_round',
] as const;

export const RECENT_RISK_ASSESSMENT_GATED_NOTE_TYPES = [
  'progress',
  'intake',
  'review',
  'ward_round',
] as const;

export const RECENT_RISK_ASSESSMENT_WINDOW_HOURS = 48;

export const FirstVisitChartReviewAttestationSchema = z.object({
  recentLabsReviewed: z.literal(true),
  recentImagingReviewed: z.literal(true),
  recentMedicationsReviewed: z.literal(true),
  reviewedAt: z.string().datetime().optional(),
});
export type FirstVisitChartReviewAttestationDTO =
  z.infer<typeof FirstVisitChartReviewAttestationSchema>;

export function isFirstVisitChartReviewGatedNoteType(
  noteType: string | null | undefined,
): noteType is (typeof FIRST_VISIT_CHART_REVIEW_GATED_NOTE_TYPES)[number] {
  if (typeof noteType !== 'string') return false;
  return (FIRST_VISIT_CHART_REVIEW_GATED_NOTE_TYPES as readonly string[]).includes(noteType);
}

export function isRecentRiskAssessmentGatedNoteType(
  noteType: string | null | undefined,
): noteType is (typeof RECENT_RISK_ASSESSMENT_GATED_NOTE_TYPES)[number] {
  if (typeof noteType !== 'string') return false;
  return (RECENT_RISK_ASSESSMENT_GATED_NOTE_TYPES as readonly string[]).includes(noteType);
}

export const CreateClinicalNoteInlineSchema = z.object({
  episodeId: z.string().uuid().optional(),
  consentId: z.string().uuid().optional(),
  templateId: z.string().uuid().optional(),
  title: z.string().min(1).max(500),
  noteType: z.string().min(1).max(50).default('progress'),
  content: z.string().max(100000).default(''),
  foiContent: z.string().max(100000).optional(),
  foiExempt: z.boolean().optional(),
  status: z.enum(['draft', 'signed', 'addendum']).default('draft'),
  didNotAttend: z.boolean().optional(),
  isReportableContact: z.boolean().optional(),
  contactMeta: z.record(z.unknown()).optional(),
  soapSubjective: z.string().max(50000).optional(),
  soapObjective: z.string().max(50000).optional(),
  soapAssessment: z.string().max(50000).optional(),
  soapPlan: z.string().max(50000).optional(),
  isAiDraft: z.boolean().optional(),
  reviewedAndAdopted: z.boolean().optional(),
  firstVisitChartReview: FirstVisitChartReviewAttestationSchema.optional(),
});
export type CreateClinicalNoteInlineDTO = z.infer<typeof CreateClinicalNoteInlineSchema>;

export const UpdateClinicalNoteInlineSchema = CreateClinicalNoteInlineSchema.partial();
export type UpdateClinicalNoteInlineDTO = z.infer<typeof UpdateClinicalNoteInlineSchema>;
