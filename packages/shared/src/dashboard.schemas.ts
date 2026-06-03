// packages/shared/src/dashboard.schemas.ts
import { z } from 'zod';

// ── Clinician slice ────────────────────────────────────────────────────────────

export const ClinicianAppointmentSummarySchema = z.object({
  id: z.string().uuid(),
  patientId: z.string().uuid(),
  // First name + family initial only in dashboard – minimal PHI surface
  patientDisplayName: z.string(),
  startTime: z.string().datetime(),
  endTime: z.string().datetime(),
  status: z.string(),
  type: z.string(),
  telehealthLink: z.string().url().nullable(),
});
export type ClinicianAppointmentSummary = z.infer<
  typeof ClinicianAppointmentSummarySchema
>;

export const OvernightAlertSchema = z.object({
  id: z.string().uuid(),
  type: z.enum([
    'escalation',
    'risk_assessment',
    'patient_flag',
    'mha_expiry',
    'clozapine_overdue',
  ]),
  patientId: z.string().uuid(),
  patientDisplayName: z.string(),
  summary: z.string(), // non-PHI clinical summary text
  severity: z.enum(['low', 'medium', 'high', 'critical']),
  occurredAt: z.string().datetime(),
  referenceId: z.string().uuid().nullable(),
});
export type OvernightAlert = z.infer<typeof OvernightAlertSchema>;

export const ClinicianDashboardSchema = z.object({
  todaysAppointments: z.array(ClinicianAppointmentSummarySchema),
  overnightAlerts: z.array(OvernightAlertSchema),
  newPathologyResults: z.number().int().nonnegative(),
  overduePathologyResults: z.number().int().nonnegative(),
  newReferrals: z.number().int().nonnegative(),
  openTasks: z.number().int().nonnegative(),
  unreadMessages: z.number().int().nonnegative(),
  generatedAt: z.string().datetime(),
});
export type ClinicianDashboard = z.infer<typeof ClinicianDashboardSchema>;

// ── Manager slice ─────────────────────────────────────────────────────────────

export const ReferralSlaSummarySchema = z.object({
  total: z.number().int().nonnegative(),
  withinSla: z.number().int().nonnegative(),
  breached: z.number().int().nonnegative(),
  slaBreachRate: z.number().min(0).max(1),
  avgDaysToFirstContact: z.number().nullable(),
});
export type ReferralSlaSummary = z.infer<typeof ReferralSlaSummarySchema>;

export const StaffActivityMetricSchema = z.object({
  userId: z.string().uuid(),
  displayName: z.string(),
  completedAppointments: z.number().int().nonnegative(),
  signedNotes: z.number().int().nonnegative(),
  overdueTasks: z.number().int().nonnegative(),
  lastActiveAt: z.string().datetime().nullable(),
});
export type StaffActivityMetric = z.infer<typeof StaffActivityMetricSchema>;

export const BillingKpiSchema = z.object({
  totalInvoiced: z.number().nonnegative(),
  totalCollected: z.number().nonnegative(),
  outstandingAmount: z.number().nonnegative(),
  collectionRate: z.number().min(0).max(1),
  bulkBillRate: z.number().min(0).max(1),
  invoiceCount: z.number().int().nonnegative(),
});
export type BillingKpi = z.infer<typeof BillingKpiSchema>;

export const ManagerDashboardSchema = z.object({
  referralSla: ReferralSlaSummarySchema,
  missedAppointmentRate: z.number().min(0).max(1),
  totalAppointmentsThisMonth: z.number().int().nonnegative(),
  overdueTasksByStaff: z.array(StaffActivityMetricSchema),
  staffActivity: z.array(StaffActivityMetricSchema),
  billingKpis: BillingKpiSchema,
  generatedAt: z.string().datetime(),
});
export type ManagerDashboard = z.infer<typeof ManagerDashboardSchema>;

// ── Team slice ───────────────────────────────────────────────────────────────

export const TeamDashboardScopeTypeSchema = z.enum([
  'team',
  'parent_team',
  'program',
  'clinic',
]);
export type TeamDashboardScopeType = z.infer<
  typeof TeamDashboardScopeTypeSchema
>;

export const TeamDashboardScopeSelectionSchema = z.object({
  scopeType: TeamDashboardScopeTypeSchema,
  scopeId: z.string().uuid().nullable(),
  scopeLabel: z.string(),
});
export type TeamDashboardScopeSelection = z.infer<
  typeof TeamDashboardScopeSelectionSchema
>;

export const TeamDashboardTotalsSchema = z.object({
  activePatients: z.number().int().nonnegative(),
  openEpisodes: z.number().int().nonnegative(),
  todaysAppointments: z.number().int().nonnegative(),
  didNotAttendAppointments: z.number().int().nonnegative(),
  overdueLai: z.number().int().nonnegative(),
  upcomingLai: z.number().int().nonnegative(),
  overdueMha: z.number().int().nonnegative(),
  upcomingMha: z.number().int().nonnegative(),
  overdueReviews91d: z.number().int().nonnegative(),
  upcomingReviews91d: z.number().int().nonnegative(),
  openTasks: z.number().int().nonnegative(),
  unreadMessages: z.number().int().nonnegative(),
  newReferrals: z.number().int().nonnegative(),
  urgentAlerts: z.number().int().nonnegative(),
});
export type TeamDashboardTotals = z.infer<typeof TeamDashboardTotalsSchema>;

export const TeamDashboardTeamMetricSchema = z.object({
  teamId: z.string().uuid(),
  teamName: z.string(),
  openEpisodes: z.number().int().nonnegative(),
  activePatients: z.number().int().nonnegative(),
});
export type TeamDashboardTeamMetric = z.infer<
  typeof TeamDashboardTeamMetricSchema
>;

export const TeamDashboardClinicianMetricSchema = z.object({
  staffId: z.string().uuid(),
  displayName: z.string(),
  teamId: z.string().uuid(),
  teamName: z.string(),
  openEpisodes: z.number().int().nonnegative(),
  activePatients: z.number().int().nonnegative(),
});
export type TeamDashboardClinicianMetric = z.infer<
  typeof TeamDashboardClinicianMetricSchema
>;

export const TeamDashboardSchema = z.object({
  scope: TeamDashboardScopeSelectionSchema,
  totals: TeamDashboardTotalsSchema,
  teamBreakdown: z.array(TeamDashboardTeamMetricSchema),
  clinicianBreakdown: z.array(TeamDashboardClinicianMetricSchema),
  generatedAt: z.string().datetime(),
});
export type TeamDashboard = z.infer<typeof TeamDashboardSchema>;

export const TeamDashboardScopeOptionSchema = z.object({
  scopeType: TeamDashboardScopeTypeSchema,
  scopeId: z.string().uuid().nullable(),
  label: z.string(),
  memberTeams: z.array(z.string().uuid()),
});
export type TeamDashboardScopeOption = z.infer<
  typeof TeamDashboardScopeOptionSchema
>;

export const TeamDashboardScopesSchema = z.object({
  teams: z.array(TeamDashboardScopeOptionSchema),
  parentTeams: z.array(TeamDashboardScopeOptionSchema),
  programs: z.array(TeamDashboardScopeOptionSchema),
  canViewClinic: z.boolean(),
});
export type TeamDashboardScopes = z.infer<typeof TeamDashboardScopesSchema>;

// ── Discriminated union response ──────────────────────────────────────────────

export const DashboardMetricsResponseSchema = z.discriminatedUnion('role', [
  z.object({ role: z.literal('clinician'), data: ClinicianDashboardSchema }),
  z.object({ role: z.literal('manager'), data: ManagerDashboardSchema }),
  z.object({ role: z.literal('team'), data: TeamDashboardSchema }),
]);
export type DashboardMetricsResponse = z.infer<
  typeof DashboardMetricsResponseSchema
>;
