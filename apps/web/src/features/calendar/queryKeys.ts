// apps/web/src/features/calendar/queryKeys.ts
//
// Phase 13 PR3 — React Query key factory for the calendar feature.
// Single source of truth so mutation invalidations always match the
// queries that display the data (CLAUDE.md §4.1).

export const calendarKeys = {
  all: ['calendar'] as const,
  blocks: (clinicianId?: string) =>
    [...calendarKeys.all, 'blocks', clinicianId ?? 'me'] as const,
  preferences: () => [...calendarKeys.all, 'preferences'] as const,
  today: (clinicianId: string | undefined, date: string) =>
    [...calendarKeys.all, 'today', clinicianId ?? 'me', date] as const,
  /**
   * Audit Tier 9.2 — invalidation key for "today's calendar" broad
   * refresh after a block mutation. Intentionally broader than
   * `today(clinicianId, date)` so every today-view query (any
   * clinician, any date) re-renders.
   */
  todayAll: () => [...calendarKeys.all, 'today'] as const,
  ical: () => [...calendarKeys.all, 'ical'] as const,
} as const;
