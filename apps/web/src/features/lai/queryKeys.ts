// apps/web/src/features/lai/queryKeys.ts
//
// Phase 0.7 PR2 Class F — React Query key factory for the Long-Acting
// Injectable (LAI) feature. Mutation invalidations must match query keys
// exactly to avoid stale caches (CLAUDE.md §4.1).
export const laiKeys = {
  all: ['lai'] as const,
  schedules: (patientId: string) =>
    ['lai-schedules', patientId] as const,
  given: (scheduleId: string) =>
    ['lai-given', scheduleId] as const,
  aims: (patientId: string, scheduleId?: string) =>
    ['aims-assessments', patientId, scheduleId ?? 'all'] as const,
} as const;
