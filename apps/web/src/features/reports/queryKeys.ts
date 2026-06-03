// apps/web/src/features/reports/queryKeys.ts
//
// Phase 0.7 PR2 Class F — React Query key factory for the reports feature.
// Single source of truth for cache keys so mutation invalidations always
// match the corresponding queries (CLAUDE.md §4.1).
//
// The reports feature uses several distinct top-level namespaces
// (`reports`, `admin-overview`, `report-schedules`, `caseload-by-team`,
// `audit-templates`, `audit-runs`, `audit-run`). They all live in this one
// factory so every file in the feature imports from the same source.

// Cross-feature: 'staff' namespace belongs to the staff feature.
// Preserved here as a literal so we don't import another feature's factory.
export const staffLookupKeys = {
  all: ['staff', 'lookup'] as const,
} as const;

export const reportsKeys = {
  all: ['reports'] as const,
  complianceSummary: () => [...reportsKeys.all, 'compliance', 'summary'] as const,
  complianceShutdownObservability: () =>
    [...reportsKeys.all, 'compliance', 'shutdown-observability'] as const,
} as const;

type AdminReportFiltersKey = {
  period: string;
  from?: string;
  to?: string;
  teamId?: string;
  clinicianId?: string;
};

export const adminReportKeys = {
  all: ['admin-report'] as const,
  clinic: (clinicId: string | undefined) =>
    [...adminReportKeys.all, clinicId ?? 'no-clinic'] as const,
  metadata: (clinicId: string | undefined) =>
    [...adminReportKeys.clinic(clinicId), 'metadata'] as const,
  overview: (
    clinicId: string | undefined,
    filters: AdminReportFiltersKey,
  ) => [...adminReportKeys.clinic(clinicId), 'overview', filters] as const,
  details: (
    clinicId: string | undefined,
    metricKey: string,
    limit: number,
    filters: AdminReportFiltersKey,
  ) => [...adminReportKeys.clinic(clinicId), 'details', metricKey, limit, filters] as const,
  trends: (
    clinicId: string | undefined,
    metricsCsv: string,
    granularity: string,
    filters: AdminReportFiltersKey,
  ) => [...adminReportKeys.clinic(clinicId), 'trends', metricsCsv, granularity, filters] as const,
} as const;

export const adminOverviewKeys = {
  all: ['admin-overview'] as const,
  byPeriod: (period: string) => [...adminOverviewKeys.all, period] as const,
} as const;

export const reportSchedulesKeys = {
  all: ['report-schedules'] as const,
} as const;

export const caseloadByTeamKeys = {
  all: ['caseload-by-team'] as const,
} as const;

export const auditTemplatesKeys = {
  all: ['audit-templates'] as const,
} as const;

export const auditRunsKeys = {
  all: ['audit-runs'] as const,
} as const;

export const auditRunKeys = {
  all: ['audit-run'] as const,
  detail: (id: string | null | undefined) => [...auditRunKeys.all, id] as const,
} as const;
