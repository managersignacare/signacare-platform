import { z } from 'zod';

export const PatientSummarySectionSchema = z.enum([
  'longitudinal_summary',
  'clinical_formulation',
  'life_chart',
  'care_provision_summary',
  'diagnosis_summary',
]);
export type PatientSummarySection = z.infer<typeof PatientSummarySectionSchema>;

export const SummaryReviewIntervalMonthsSchema = z.union([z.literal(3), z.literal(6)]);
export type SummaryReviewIntervalMonths = z.infer<typeof SummaryReviewIntervalMonthsSchema>;

export const SignPatientSummarySchema = z.object({
  section: PatientSummarySectionSchema,
  reviewIntervalMonths: SummaryReviewIntervalMonthsSchema.default(6),
});
export type SignPatientSummaryDTO = z.infer<typeof SignPatientSummarySchema>;

export const PatientSummarySignoffSchema = z.object({
  section: PatientSummarySectionSchema,
  signedOffAt: z.string().datetime(),
  signedOffById: z.string().uuid(),
  signedOffByName: z.string(),
  reviewDueDate: z.string(),
  reminderTaskId: z.string().uuid().nullable(),
});
export type PatientSummarySignoff = z.infer<typeof PatientSummarySignoffSchema>;

export const PatientSummarySignoffListSchema = z.object({
  signoffs: z.array(PatientSummarySignoffSchema),
});
export type PatientSummarySignoffList = z.infer<typeof PatientSummarySignoffListSchema>;

