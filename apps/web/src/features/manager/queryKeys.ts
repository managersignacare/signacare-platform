// apps/web/src/features/manager/queryKeys.ts
//
// Phase 0.7 PR2 Class F — React Query key factory for the manager dashboard.
// Centralized so any future manager-facing mutations invalidate the matching
// cache slice without literal-array drift (CLAUDE.md §4.1).
export const managerKeys = {
  all: ['manager'] as const,
  contactsKpi: () => [...managerKeys.all, 'contacts-kpi'] as const,
  caseload: () => [...managerKeys.all, 'caseload'] as const,
  dnaRate: () => [...managerKeys.all, 'dna-rate'] as const,
  bedOccupancy: () => [...managerKeys.all, 'bed-occupancy'] as const,
  staffLeave: () => [...managerKeys.all, 'staff-leave'] as const,
  workloadAlerts: () => [...managerKeys.all, 'workload-alerts'] as const,
} as const;
