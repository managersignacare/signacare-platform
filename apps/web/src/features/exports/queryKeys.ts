// apps/web/src/features/exports/queryKeys.ts
//
// Phase 0.7 PR2 Class F — React Query key factory for exports (CLAUDE.md §4.1).
// Single source of truth so mutation invalidations always match queries.
//
// NOTE: The patient-search factory intentionally starts with the cross-feature
// `['patients', ...]` prefix so broad invalidations on the patients namespace
// still drop export-scoped search caches.
export const exportsKeys = {
  all: ['exports'] as const,
  patientSearch: (query: string) =>
    ['patients', 'export-search', query] as const,
} as const;
