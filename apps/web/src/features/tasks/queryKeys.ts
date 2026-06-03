// apps/web/src/features/tasks/queryKeys.ts
//
// Phase 0.7 PR2 Class F — React Query key factory for the tasks feature.
// Single source of truth for cache keys so mutation invalidations always
// match the corresponding queries (CLAUDE.md §4.1).
// Cross-feature: 'staff' namespace belongs to the staff feature.
// Preserved here as a literal so we don't import another feature's factory.
export const staffLookupKeys = {
  all: ['staff', 'lookup'] as const,
} as const;

export const tasksKeys = {
  all: ['tasks'] as const,
  list: (
    params: {
      patientId?: string;
      assignedToId?: string;
      status?: string;
      priority?: string;
      teamId?: string;
      teamScope?: 'mine';
    } = {},
  ) => [...tasksKeys.all, 'list', params] as const,
  detail: (id: string) => [...tasksKeys.all, 'detail', id] as const,
} as const;
