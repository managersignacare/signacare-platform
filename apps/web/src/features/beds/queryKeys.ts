// apps/web/src/features/beds/queryKeys.ts
// Phase 0.7 PR2 Class F — React Query key factory for beds (CLAUDE.md §4.1).
export const bedsKeys = {
  all: ['bed-board'] as const,
  board: () => bedsKeys.all,
  list: () => ['beds', 'all'] as const,
} as const;
