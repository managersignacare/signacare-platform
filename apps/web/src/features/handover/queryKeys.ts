// apps/web/src/features/handover/queryKeys.ts
//
// Phase 0.7 PR2 Class F — React Query key factory for the handover feature.
// Centralized so mutation invalidations stay aligned with query keys and
// never drift via literal arrays (CLAUDE.md §4.1).
//
// Cross-feature notes:
//   - handoverKeys.shiftHandovers() is namespaced under ['shift-handovers']
//     because invalidations in this page target that broader cache, and the
//     backend-resource name is the shared cache boundary.
export const handoverKeys = {
  all: ['handover'] as const,
  caseload: (userId: string | undefined) =>
    [...handoverKeys.all, 'caseload', userId] as const,
  notesToday: (shiftType: string, date: string) =>
    [...handoverKeys.all, 'notes-today', shiftType, date] as const,
  notesTodayAll: () => [...handoverKeys.all, 'notes-today'] as const,
  incoming: (date: string, userId: string | undefined) =>
    [...handoverKeys.all, 'incoming', date, userId] as const,
  shiftHandovers: () => ['shift-handovers'] as const,
} as const;
