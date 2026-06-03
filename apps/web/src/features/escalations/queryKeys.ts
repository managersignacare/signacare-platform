// apps/web/src/features/escalations/queryKeys.ts
//
// Phase 0.7 PR2 Class F — React Query key factory for escalations (CLAUDE.md §4.1).
// Single source of truth so mutation invalidations always match queries.
export const escalationKeys = {
  root: ['escalations'] as const,
  all: (patientId: string) => ['escalations', patientId] as const,
  byEpisode: (patientId: string, episodeId: string) =>
    ['escalations', patientId, 'episode', episodeId] as const,
  detail: (id: string) => ['escalations', 'detail', id] as const,
} as const;
