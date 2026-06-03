import { z } from 'zod';

export const EpisodeTypeSchema = z.enum([
  'inpatient',
  'outpatient',
  'community',
  'crisis',
  'dayprogram',
  'telehealth',
]);

export const ReportFiltersSchema = z.object({
  dateFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  dateTo: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  clinicianStaffId: z.string().uuid().optional(),
  episodeType: EpisodeTypeSchema.optional(),
  format: z.enum(['json', 'csv', 'pdf']).default('json'),
});
export type ReportFilters = z.infer<typeof ReportFiltersSchema>;

export const EncounterReportRowSchema = z.object({
  encounterId: z.string().uuid(),
  patientId: z.string().uuid(),
  patientName: z.string(),
  encounterDate: z.string(),
  encounterType: z.string(),
  clinicianName: z.string(),
  episodeType: z.string().nullable(),
  durationMinutes: z.number().nullable(),
  status: z.string(),
});
export type EncounterReportRow = z.infer<typeof EncounterReportRowSchema>;

export const OutcomeMeasurePointSchema = z.object({
  date: z.string(),
  patientId: z.string().uuid(),
  instrument: z.enum(['PHQ9', 'GAD7', 'K10', 'HONOS', 'BPRS', 'DASS21']),
  score: z.number(),
  interpretation: z.string().nullable(),
  clinicianName: z.string().optional(),
});
export type OutcomeMeasurePoint = z.infer<typeof OutcomeMeasurePointSchema>;

export const OutcomeMeasureTrendSchema = z.object({
  patientId: z.string().uuid(),
  patientName: z.string(),
  instrument: OutcomeMeasurePointSchema.shape.instrument,
  dataPoints: z.array(OutcomeMeasurePointSchema),
  baselineScore: z.number().nullable(),
  latestScore: z.number().nullable(),
  trend: z.enum(['improving', 'stable', 'deteriorating', 'insufficientdata']),
});
export type OutcomeMeasureTrend = z.infer<typeof OutcomeMeasureTrendSchema>;

export const OutcomeDashboardDataSchema = z.object({
  filters: ReportFiltersSchema,
  trends: z.array(OutcomeMeasureTrendSchema),
  cohortAverageByDate: z.array(
    z.object({
      date: z.string(),
      instrument: z.string(),
      avgScore: z.number(),
      count: z.number(),
    }),
  ),
  generatedAt: z.string().datetime(),
});
export type OutcomeDashboardData = z.infer<typeof OutcomeDashboardDataSchema>;

export const ReportSummarySchema = z.object({
  reportId: z.string().uuid(),
  reportType: z.string(),
  filters: ReportFiltersSchema,
  totalRows: z.number(),
  generatedAt: z.string().datetime(),
  downloadUrl: z.string().url().optional(),
});
export type ReportSummary = z.infer<typeof ReportSummarySchema>;

export const StaffOptionSchema = z.object({
  id: z.string().uuid(),
  fullName: z.string(),
  profession: z.string().optional(),
});
export type StaffOption = z.infer<typeof StaffOptionSchema>;

export const GenerateReportSchema = z.object({
  reportType: z.enum([
    'encounters',
    'outcomes',
    'billing',
    'referrals',
    'missedappointments',
  ]),
  dateFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  dateTo: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  clinicianStaffId: z.string().uuid().optional(),
  episodeType: EpisodeTypeSchema.optional(),
  format: z.enum(['json', 'csv', 'pdf']).default('json'),
});
export type GenerateReportDTO = z.infer<typeof GenerateReportSchema>;
