// apps/web/src/features/reports/types/reportTypes.ts
//
// Phase 0.7 PR3 Class D — every report type was a line-for-line literal
// duplicate of @signacare/shared/src/report.schemas.ts. Replaced with
// pure re-exports so shared is the single source of truth.
//
// TYPEDUP: EncounterReportRow, OutcomeDashboardData, OutcomeMeasurePoint,
//          OutcomeMeasureTrend, ReportFilters, ReportSummary, StaffOption.
export {
  EpisodeTypeSchema,
  ReportFiltersSchema,
  EncounterReportRowSchema,
  OutcomeMeasurePointSchema,
  OutcomeMeasureTrendSchema,
  OutcomeDashboardDataSchema,
  ReportSummarySchema,
  StaffOptionSchema,
} from '@signacare/shared';
export type {
  ReportFilters,
  EncounterReportRow,
  OutcomeMeasurePoint,
  OutcomeMeasureTrend,
  OutcomeDashboardData,
  ReportSummary,
  StaffOption,
} from '@signacare/shared';
