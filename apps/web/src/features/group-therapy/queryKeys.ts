// apps/web/src/features/group-therapy/queryKeys.ts
//
// Phase 0.7 PR2 Class F — React Query key factory for group therapy (CLAUDE.md §4.1).
// Single source of truth so mutation invalidations always match queries.
//
// NOTE: `patientSearch` and `patientNotes` intentionally start with cross-feature
// prefixes (`patient-search`, `patient-notes`) so broad invalidations by the
// patients / notes features still drop these caches.
export const groupTherapyKeys = {
  all: ['group-therapy'] as const,
  attendees: (sessionId: string) =>
    [...groupTherapyKeys.all, sessionId, 'attendees'] as const,
  patientSearch: (query: string) =>
    ['patient-search', query] as const,
  patientNotes: (patientId: string) =>
    ['patient-notes', patientId] as const,
} as const;
