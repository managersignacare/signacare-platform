// apps/web/src/features/waitlist/queryKeys.ts
//
// Phase 0.7 PR2 Class F — React Query key factory for the waitlist feature.
// Single source of truth for cache keys so mutation invalidations always
// match the corresponding queries (CLAUDE.md §4.1).
export const waitlistKeys = {
  all: ['waitlist'] as const,
  lists: () => [...waitlistKeys.all, 'list'] as const,
  list: (params: { patientId?: string; status?: string; priority?: string }) =>
    [...waitlistKeys.lists(), params] as const,
  detail: (id: string) => [...waitlistKeys.all, 'detail', id] as const,
} as const;
