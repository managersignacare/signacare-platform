// apps/web/src/features/messaging/queryKeys.ts
//
// Phase 0.7 PR2 Class F — React Query key factory for the messaging
// feature (staff-to-staff message threads). Single source of truth so
// mutation invalidations always match queries (CLAUDE.md §4.1).
//
// Note: the cache root is `messages` (not `messaging`) to preserve
// the existing wire-level key prefix — invalidating `['messages']`
// must continue to drop all thread list, thread detail, and unread
// count queries.

const MESSAGES_ROOT = 'messages';

export const messagingKeys = {
  all: [MESSAGES_ROOT] as const,
  threads: (params: { patientId?: string; isArchived?: boolean }) =>
    [MESSAGES_ROOT, 'threads', params] as const,
  thread: (threadId: string) => [MESSAGES_ROOT, 'thread', threadId] as const,
  threadMessages: (threadId: string) =>
    [MESSAGES_ROOT, 'thread', threadId, 'messages'] as const,
  unreadCount: () => [MESSAGES_ROOT, 'unread-count'] as const,
} as const;

// ── Cross-feature namespaces used by messaging components ────────────────
// The NewThreadDialog has a staff-search autocomplete. The `staff-search`
// cache root is owned by the staff/directory surface; preserve the literal
// prefix so its invalidations (if any) keep working.

export const messagingCrossFeatureKeys = {
  staffSearch: (query: string) => ['staff-search', query] as const,
} as const;
