// apps/web/src/features/notifications/queryKeys.ts
//
// Phase 10B — React Query key factory for the notification centre.
// Single source of truth for the cache keys so mutation invalidations
// always match the corresponding queries (CLAUDE.md §4.1).
export const notificationKeys = {
  all: ['notifications'] as const,
  list: (filters: { unread?: boolean } = {}) =>
    [...notificationKeys.all, 'list', filters] as const,
  unreadCount: () => [...notificationKeys.all, 'unread-count'] as const,
} as const;
