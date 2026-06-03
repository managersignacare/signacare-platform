import { z } from 'zod';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export const ClinicalIntelligenceStateSchema = z.enum(['ok', 'partial', 'degraded']);
export type ClinicalIntelligenceState = z.infer<typeof ClinicalIntelligenceStateSchema>;

export const ClinicalIntelligenceSourceSchema = z.enum([
  'flags',
  'tasks',
  'appointments',
  'legal_orders',
  'lai_schedule',
  'clinical_notes',
  'outcomes',
  'patient_profile',
]);
export type ClinicalIntelligenceSource = z.infer<typeof ClinicalIntelligenceSourceSchema>;

export const ClinicalIntelligenceNowSchema = z.object({
  activeFlags: z.number().int().nonnegative(),
  highRiskFlags: z.number().int().nonnegative(),
  openTasks: z.number().int().nonnegative(),
  overdueTasks: z.number().int().nonnegative(),
  dnaLast90Days: z.number().int().nonnegative(),
});
export type ClinicalIntelligenceNow = z.infer<typeof ClinicalIntelligenceNowSchema>;

export const ClinicalIntelligenceDueSchema = z.object({
  upcomingAppointments7Days: z.number().int().nonnegative(),
  overdueMhaReviews: z.number().int().nonnegative(),
  upcomingMhaReviews30Days: z.number().int().nonnegative(),
  overdueLaiAdministrations: z.number().int().nonnegative(),
  upcomingLaiAdministrations7Days: z.number().int().nonnegative(),
  overdue91DayReview: z.boolean(),
  next91DayReviewDueDate: z.string().regex(DATE_RE).nullable(),
});
export type ClinicalIntelligenceDue = z.infer<typeof ClinicalIntelligenceDueSchema>;

export const ClinicalIntelligenceOutcomeDirectionSchema = z.enum([
  'improving',
  'worsening',
  'stable',
  'unknown',
]);
export type ClinicalIntelligenceOutcomeDirection = z.infer<typeof ClinicalIntelligenceOutcomeDirectionSchema>;

export const ClinicalIntelligenceTrendsSchema = z.object({
  daysSinceLastClinicalNote: z.number().int().nonnegative().nullable(),
  nextBirthdayInDays: z.number().int().nonnegative().nullable(),
  lastOutcomeScore: z.number().nullable(),
  previousOutcomeScore: z.number().nullable(),
  outcomeDirection: ClinicalIntelligenceOutcomeDirectionSchema,
});
export type ClinicalIntelligenceTrends = z.infer<typeof ClinicalIntelligenceTrendsSchema>;

export const ClinicalIntelligenceMetaSchema = z.object({
  generatedAt: z.string().datetime(),
  failedSources: z.array(ClinicalIntelligenceSourceSchema),
  state: ClinicalIntelligenceStateSchema,
  calibrationContext: z.object({
    diagnosisProgramBucket: z.enum([
      'mood',
      'psychotic',
      'anxiety_trauma',
      'personality',
      'substance',
      'neurodevelopmental',
      'other',
      'unknown',
    ]),
    serviceProgramBucket: z.enum([
      'community',
      'inpatient',
      'crisis',
      'day_program',
      'other',
      'unknown',
    ]),
  }).optional(),
});
export type ClinicalIntelligenceMeta = z.infer<typeof ClinicalIntelligenceMetaSchema>;

export const PatientClinicalIntelligenceSummarySchema = z.object({
  patientId: z.string().uuid(),
  now: ClinicalIntelligenceNowSchema,
  due: ClinicalIntelligenceDueSchema,
  trends: ClinicalIntelligenceTrendsSchema,
  meta: ClinicalIntelligenceMetaSchema,
});
export type PatientClinicalIntelligenceSummary = z.infer<typeof PatientClinicalIntelligenceSummarySchema>;
