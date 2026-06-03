import { z } from 'zod';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export const AdminReportPeriodSchema = z.enum([
  'week',
  'month',
  'quarter',
  'year',
  'custom',
]);
export type AdminReportPeriod = z.infer<typeof AdminReportPeriodSchema>;

export const AdminReportTrendGranularitySchema = z.enum([
  'day',
  'week',
  'month',
]);
export type AdminReportTrendGranularity = z.infer<typeof AdminReportTrendGranularitySchema>;

export const AdminReportMetricKeySchema = z.enum([
  'total_consumers',
  'new_consumer',
  'transfer_to_outpatients',
  'transfer_to_acis',
  'currently_admitted',
  'currently_in_parcs',
  'discharged_from_cct',
  'discharged_from_ipu',
  'discharged_from_parcs',
  'on_single_lai',
  'on_multiple_lai',
  'total_lai_consumer',
  'total_on_mha',
  'upcoming_mha_review',
  'upcoming_tribunal_hearing',
  'dna_last_week',
  'number_of_clozapine',
  'upcoming_mha_application',
  'overdue_kc_review',
  'overdue_jmo_review',
  'overdue_consultant_review',
  'overdue_91d_review',
  'overdue_lai',
  'incomplete_craam',
  'incomplete_registration_form',
  'incomplete_recovery_plan',
  'incomplete_gp_pp_contact',
  'incomplete_family_contact',
]);

export type AdminReportMetricKey = z.infer<typeof AdminReportMetricKeySchema>;

export const ADMIN_REPORT_METRIC_META: ReadonlyArray<{
  key: AdminReportMetricKey;
  label: string;
  group: 'consumer' | 'medication' | 'legal' | 'overdue' | 'incomplete';
}> = [
  { key: 'total_consumers', label: 'Total consumers', group: 'consumer' },
  { key: 'new_consumer', label: 'New consumer', group: 'consumer' },
  { key: 'transfer_to_outpatients', label: 'Transfer to Outpatients', group: 'consumer' },
  { key: 'transfer_to_acis', label: 'Transfer to ACIS', group: 'consumer' },
  { key: 'currently_admitted', label: 'Currently admitted', group: 'consumer' },
  { key: 'currently_in_parcs', label: 'Currently in PARCS', group: 'consumer' },
  { key: 'discharged_from_cct', label: 'Discharged from CCT', group: 'consumer' },
  { key: 'discharged_from_ipu', label: 'Discharged from IPU', group: 'consumer' },
  { key: 'discharged_from_parcs', label: 'Discharged from PARCS', group: 'consumer' },
  { key: 'on_single_lai', label: 'On single LAI', group: 'medication' },
  { key: 'on_multiple_lai', label: 'On multiple LAI', group: 'medication' },
  { key: 'total_lai_consumer', label: 'Total LAI consumer', group: 'medication' },
  { key: 'total_on_mha', label: 'Total on MHA', group: 'legal' },
  { key: 'upcoming_mha_review', label: 'Upcoming MHA review', group: 'legal' },
  { key: 'upcoming_tribunal_hearing', label: 'Upcoming tribunal hearing', group: 'legal' },
  { key: 'dna_last_week', label: 'DNA last week', group: 'consumer' },
  { key: 'number_of_clozapine', label: 'No of clozapine', group: 'medication' },
  { key: 'upcoming_mha_application', label: 'Upcoming MHA application', group: 'legal' },
  { key: 'overdue_kc_review', label: 'Overdue KC review', group: 'overdue' },
  { key: 'overdue_jmo_review', label: 'Overdue JMO review', group: 'overdue' },
  { key: 'overdue_consultant_review', label: 'Overdue consultant review', group: 'overdue' },
  { key: 'overdue_91d_review', label: 'Overdue 91d review', group: 'overdue' },
  { key: 'overdue_lai', label: 'Overdue LAI', group: 'overdue' },
  { key: 'incomplete_craam', label: 'Incomplete CRAAM', group: 'incomplete' },
  { key: 'incomplete_registration_form', label: 'Incomplete Registration form', group: 'incomplete' },
  { key: 'incomplete_recovery_plan', label: 'Incomplete Recovery plan', group: 'incomplete' },
  { key: 'incomplete_gp_pp_contact', label: 'Incomplete GP/PP contact', group: 'incomplete' },
  { key: 'incomplete_family_contact', label: 'Incomplete Family Contact', group: 'incomplete' },
];

export const AdminReportMetricMetaSchema = z.object({
  key: AdminReportMetricKeySchema,
  label: z.string().min(1),
  group: z.string().min(1),
});

export type AdminReportMetricMeta = z.infer<typeof AdminReportMetricMetaSchema>;

export const AdminReportMetadataTeamSchema = z.object({
  id: z.string().uuid(),
  name: z.string().min(1),
});

export type AdminReportMetadataTeam = z.infer<typeof AdminReportMetadataTeamSchema>;

export const AdminReportMetadataClinicianSchema = z.object({
  id: z.string().uuid(),
  fullName: z.string().min(1),
});

export type AdminReportMetadataClinician = z.infer<typeof AdminReportMetadataClinicianSchema>;

export const AdminReportMetadataResponseSchema = z.object({
  metrics: z.array(AdminReportMetricMetaSchema),
  teams: z.array(AdminReportMetadataTeamSchema),
  clinicians: z.array(AdminReportMetadataClinicianSchema),
});

export type AdminReportMetadataResponse = z.infer<typeof AdminReportMetadataResponseSchema>;

export const AdminReportFiltersSchema = z.object({
  period: AdminReportPeriodSchema.default('month'),
  from: z.string().regex(DATE_RE).optional(),
  to: z.string().regex(DATE_RE).optional(),
  teamId: z.string().uuid().optional(),
  clinicianId: z.string().uuid().optional(),
});

export type AdminReportFilters = z.infer<typeof AdminReportFiltersSchema>;

export const AdminReportOverviewCardSchema = z.object({
  key: AdminReportMetricKeySchema,
  label: z.string().min(1),
  group: z.string().min(1),
  count: z.number().int().nonnegative(),
});

export type AdminReportOverviewCard = z.infer<typeof AdminReportOverviewCardSchema>;

export const AdminReportOverviewResponseSchema = z.object({
  filters: AdminReportFiltersSchema,
  resolvedFrom: z.string().regex(DATE_RE),
  resolvedTo: z.string().regex(DATE_RE),
  generatedAt: z.string().datetime(),
  cards: z.array(AdminReportOverviewCardSchema),
});

export type AdminReportOverviewResponse = z.infer<typeof AdminReportOverviewResponseSchema>;

export const AdminReportDetailRowSchema = z.object({
  patientId: z.string().uuid(),
  urNumber: z.string().nullable(),
  patientName: z.string(),
  dateOfBirth: z.string().regex(DATE_RE).nullable(),
  team: z.string().nullable(),
  clinician: z.string().nullable(),
  refSource: z.string().nullable(),
  refDate: z.string().regex(DATE_RE).nullable(),
  urgency: z.string().nullable(),
  status: z.string().nullable(),
  dueDate: z.string().regex(DATE_RE).nullable(),
  note: z.string().nullable(),
});

export type AdminReportDetailRow = z.infer<typeof AdminReportDetailRowSchema>;

export const AdminReportDetailsResponseSchema = z.object({
  metricKey: AdminReportMetricKeySchema,
  metricLabel: z.string().min(1),
  total: z.number().int().nonnegative(),
  rows: z.array(AdminReportDetailRowSchema),
});

export type AdminReportDetailsResponse = z.infer<typeof AdminReportDetailsResponseSchema>;

export const AdminReportTrendPointSchema = z.object({
  bucketStart: z.string().regex(DATE_RE),
  bucketEnd: z.string().regex(DATE_RE),
  count: z.number().int().nonnegative(),
});

export type AdminReportTrendPoint = z.infer<typeof AdminReportTrendPointSchema>;

export const AdminReportTrendSeriesSchema = z.object({
  metricKey: AdminReportMetricKeySchema,
  metricLabel: z.string().min(1),
  points: z.array(AdminReportTrendPointSchema),
});

export type AdminReportTrendSeries = z.infer<typeof AdminReportTrendSeriesSchema>;

export const AdminReportTrendsResponseSchema = z.object({
  filters: AdminReportFiltersSchema,
  granularity: AdminReportTrendGranularitySchema,
  generatedAt: z.string().datetime(),
  series: z.array(AdminReportTrendSeriesSchema),
});

export type AdminReportTrendsResponse = z.infer<typeof AdminReportTrendsResponseSchema>;

export const AdminReportDetailsQuerySchema = AdminReportFiltersSchema.extend({
  metricKey: AdminReportMetricKeySchema,
  limit: z.coerce.number().int().min(1).max(500).default(200),
});

export type AdminReportDetailsQuery = z.infer<typeof AdminReportDetailsQuerySchema>;

export const AdminReportTrendsQuerySchema = AdminReportFiltersSchema.extend({
  metrics: z.string().optional(),
  granularity: AdminReportTrendGranularitySchema.default('month'),
});

export type AdminReportTrendsQuery = z.infer<typeof AdminReportTrendsQuerySchema>;

export const AdminReportExportQuerySchema = AdminReportFiltersSchema.extend({
  metricKey: AdminReportMetricKeySchema.optional(),
  metrics: z.string().optional(),
  granularity: AdminReportTrendGranularitySchema.default('month'),
  view: z.enum(['overview', 'details', 'trends']).default('overview'),
  format: z.enum(['csv', 'pdf']).default('csv'),
  limit: z.coerce.number().int().min(1).max(500).default(200),
});

export type AdminReportExportQuery = z.infer<typeof AdminReportExportQuerySchema>;
