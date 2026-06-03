// apps/web/src/features/surgery/queryKeys.ts
// Phase 0.7 PR2 Class F — React Query key factory for surgery (CLAUDE.md §4.1).
export const surgicalCaseKeys = {
  all: ['surgery'] as const,
  list: (patientId: string) => ['surgery', 'cases', patientId] as const,
} as const;
