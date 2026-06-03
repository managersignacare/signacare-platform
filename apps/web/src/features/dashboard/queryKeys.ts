// apps/web/src/features/dashboard/queryKeys.ts
//
// Phase 0.7 PR2 Class F — React Query key factory for the dashboard
// feature. Single source of truth so mutation invalidations always match
// the corresponding queries (CLAUDE.md §4.1).
//
// The dashboard has two namespaces:
//   1. ['dashboard', ...] — role-scoped metrics / alerts queries.
//   2. ['dash', ...]      — per-card queries on DashboardPage.
//
// NOTE:
// React Query prefix invalidation matches ARRAY segments, not partial
// string fragments. We therefore keep an explicit array root ('dash')
// instead of flat string keys like ['dash-caseload'].

export type DashboardPeriod = string | undefined;
export type DashboardClinicScope = string | undefined;

function clinicScopeToken(clinicScope: DashboardClinicScope): string {
  return clinicScope && clinicScope.trim().length > 0
    ? `clinic:${clinicScope}`
    : 'clinic:session';
}

export const dashboardKeys = {
  // Namespace 1: ['dashboard', ...]
  all: (clinicScope: DashboardClinicScope) =>
    ['dashboard', clinicScopeToken(clinicScope)] as const,
  alerts: (clinicScope: DashboardClinicScope, role: string) =>
    ['dashboard', clinicScopeToken(clinicScope), 'alerts', role] as const,
  clinician: (
    clinicScope: DashboardClinicScope,
    period: DashboardPeriod,
    team: string | undefined,
  ) => ['dashboard', clinicScopeToken(clinicScope), 'clinician', period, team] as const,
  manager: (
    clinicScope: DashboardClinicScope,
    period: DashboardPeriod,
    team: string | undefined,
  ) => ['dashboard', clinicScopeToken(clinicScope), 'manager', period, team] as const,
  team: (
    clinicScope: DashboardClinicScope,
    period: DashboardPeriod,
    scopeType: string | undefined,
    scopeId: string | undefined,
  ) => ['dashboard', clinicScopeToken(clinicScope), 'team', period, scopeType, scopeId] as const,
  teamScopes: (clinicScope: DashboardClinicScope) =>
    ['dashboard', clinicScopeToken(clinicScope), 'team-scopes'] as const,

  // Namespace 2: ['dash', ...] — per-card keys on DashboardPage.
  dashAll: (clinicScope: DashboardClinicScope) =>
    ['dash', clinicScopeToken(clinicScope)] as const,
  myClinic: (clinicScope: DashboardClinicScope) =>
    ['dash', clinicScopeToken(clinicScope), 'my-clinic'] as const,
  caseload: (clinicScope: DashboardClinicScope) =>
    ['dash', clinicScopeToken(clinicScope), 'caseload'] as const,
  contactsKpi: (clinicScope: DashboardClinicScope, period: DashboardPeriod) =>
    ['dash', clinicScopeToken(clinicScope), 'contacts-kpi', period] as const,
  staffCaseload: (clinicScope: DashboardClinicScope) =>
    ['dash', clinicScopeToken(clinicScope), 'staff-caseload'] as const,
  dnaRates: (clinicScope: DashboardClinicScope) =>
    ['dash', clinicScopeToken(clinicScope), 'dna-rates'] as const,
  workloadAlerts: (clinicScope: DashboardClinicScope) =>
    ['dash', clinicScopeToken(clinicScope), 'workload-alerts'] as const,
  phoneTriage: (clinicScope: DashboardClinicScope) =>
    ['dash', clinicScopeToken(clinicScope), 'phone-triage'] as const,
  clinicalAlerts: (
    clinicScope: DashboardClinicScope,
    teamFilter: string,
    period: DashboardPeriod,
  ) => ['dash', clinicScopeToken(clinicScope), 'clinical-alerts', teamFilter, period] as const,
  todayAppts: (clinicScope: DashboardClinicScope) =>
    ['dash', clinicScopeToken(clinicScope), 'today-appts'] as const,
  reviewStatus: (clinicScope: DashboardClinicScope) =>
    ['dash', clinicScopeToken(clinicScope), 'review-status'] as const,
  myAppts: (clinicScope: DashboardClinicScope, period: DashboardPeriod) =>
    ['dash', clinicScopeToken(clinicScope), 'my-appts', period] as const,
  myTasks: (clinicScope: DashboardClinicScope, staffId: string | undefined) =>
    ['dash', clinicScopeToken(clinicScope), 'my-tasks', staffId ?? 'session'] as const,
  handoverSummary: (clinicScope: DashboardClinicScope) =>
    ['dash', clinicScopeToken(clinicScope), 'handover-summary'] as const,
} as const;
