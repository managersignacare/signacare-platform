// apps/web/src/features/org-settings/queryKeys.ts
// Phase 0.7 PR2 Class F — React Query key factory for org-settings (CLAUDE.md §4.1).
// Note: staffLookup uses the cross-feature 'staff' namespace prefix so it
// stays compatible with any staff-owned invalidations.
export const orgSettingsKeys = {
  all: ['org-settings'] as const,
  staffLookup: () => ['staff', 'lookup'] as const,
} as const;
