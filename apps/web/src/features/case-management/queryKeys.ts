// apps/web/src/features/case-management/queryKeys.ts
// Phase 0.7 PR2 Class F — React Query key factory for case management
// (caseload, care-plan goals, community resources). CLAUDE.md §4.1.
//
// outcomesKey is namespaced under ['outcomes'] so a global outcomes
// invalidation also drops the case-management view.
export const caseManagementKeys = {
  all: ['case-management'] as const,
  caseload: () => ['caseload'] as const,
  carePlanGoals: (patientId: string) => ['care-plan-goals', patientId] as const,
  outcomes: (patientId: string) => ['outcomes', patientId] as const,
  communityResources: () => ['community-resources'] as const,
} as const;
