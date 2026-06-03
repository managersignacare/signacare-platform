// apps/web/src/features/lists/queryKeys.ts
//
// Phase 0.7 PR2 Class F — React Query key factory for the clinical
// list pages (admission waitlist, hot spots, LAI/MHA/clozapine/team
// rosters). Single source of truth so mutation invalidations always
// match their queries (CLAUDE.md §4.1).
//
// Cross-feature namespace note: the list pages also read from
// ['patients', ...], ['staff', 'lookup'], and ['team-summary', ...]
// which are owned by other features. Those literal prefixes are
// preserved here verbatim — we do NOT import other feature factories.

export const admissionWaitlistKeys = {
  all: ['admission-waitlist'] as const,
  list: () => [...admissionWaitlistKeys.all] as const,
} as const;

export const hotspotsKeys = {
  all: ['hotspots'] as const,
  active: (teamFilter: string) => [...hotspotsKeys.all, 'active', teamFilter] as const,
  resolved: () => [...hotspotsKeys.all, 'resolved'] as const,
} as const;

// ── Cross-feature namespaces used by list pages ───────────────────────────
// These prefixes belong to other features (patients, staff, escalations).
// We preserve them literally here so invalidations stay consistent with
// those features — do NOT import another feature's factory.

export const listsCrossFeatureKeys = {
  staffLookup: () => ['staff', 'lookup'] as const,
  patientsTeamAssignments: () => ['patients', 'team-assignments'] as const,
  patientsAll: () => ['patients', 'all'] as const,
  laiSchedulesActive: () => ['lai', 'active-schedules'] as const,
  clozapineRegistrationsActive: () => ['clozapine', 'active-registrations'] as const,
  legalOrdersActive: () => ['legal-orders', 'active'] as const,
  reportsClinicalAlerts: () => ['reports', 'clinical-alerts'] as const,
  patientsAllRoot: () => ['patients'] as const,
  patientsSearch: (search: string) => ['patients', 'search', search] as const,
  teamSummary: (orgUnitId: string | undefined) => ['team-summary', orgUnitId] as const,
} as const;
