// apps/web/src/features/obs-gyne/queryKeys.ts
// Phase 0.7 PR2 Class F — React Query key factory for obs-gyne (CLAUDE.md §4.1).
export const obsGyneKeys = {
  all: ['obs-gyne'] as const,
  pregnancies: (patientId: string) =>
    [...obsGyneKeys.all, 'pregnancies', patientId] as const,
  visitsAll: () => [...obsGyneKeys.all, 'visits'] as const,
  visits: (pregnancyId: string) =>
    [...obsGyneKeys.all, 'visits', pregnancyId] as const,
} as const;
