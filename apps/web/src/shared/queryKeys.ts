// apps/web/src/shared/queryKeys.ts
//
// Phase 0.7 PR2 Class F + audit M3 (2026-04-16) — query-key factories
// for cross-cutting shared-component queries.
//
// Every feature directory under apps/web/src/features/ has its own
// queryKeys.ts factory (the Phase 0.7 PR2 migration landed 41 of
// them). But a handful of shared widgets under apps/web/src/shared/
// also call useQuery/useMutation — a digital signature uploader,
// a staff picker, a contact-form banner, a markdown letterhead.
// These components aren't a "feature" in their own right, but they
// still need factory keys to be covered by the invariant:
//
//   "every mutation's invalidation MUST share a prefix with the
//    query that displays the data"
//
// The audit uncovered 10 literal `queryKey: [...]` arrays in shared
// components that bypassed the Phase 0.7 PR2 guard entirely (the
// guard's FEATURES_DIR scan didn't walk shared/). This file is the
// single source of truth for those keys; the guard now also scans
// apps/web/src/shared/**, so a new literal array anywhere in
// shared/ fails CI.
//
// Naming: each factory object is `shared<Concern>Keys` to make it
// immediately obvious at the call site that the key lives here, not
// in a feature factory. Nothing in features/ should import from
// this file — these keys exist SPECIFICALLY for shared widgets.

// ── Staff lookups shared across unrelated widgets ────────────────

export const sharedStaffKeys = {
  /** Canonical base tuple for all shared-staff queries. */
  all: ['shared', 'staff'] as const,
  /**
   * Full staff roster for pickers (StaffPicker). Separate from
   * feature-staff keys because this payload is a lightweight
   * name+id projection, not the full staff row.
   */
  lookup: () => [...sharedStaffKeys.all, 'lookup'] as const,
  /**
   * The current user's saved signature blob. DigitalSignature
   * reads + writes this. Not in a feature factory because no
   * single feature owns "my signature" — it's a cross-cutting
   * piece of profile data.
   */
  mySignature: () => [...sharedStaffKeys.all, 'my-signature'] as const,
};

// ── Clinic profile used by the letterhead widget ─────────────────

export const sharedClinicProfileKeys = {
  all: ['shared', 'clinic-profile'] as const,
  /** The current clinic's branding (logo, legal name, address). */
  current: () => [...sharedClinicProfileKeys.all, 'current'] as const,
  /** Pathology request printouts reuse the clinic profile payload. */
  pathologyRequestPrint: () =>
    [...sharedClinicProfileKeys.all, 'pathology-request-print'] as const,
};

// ── Contact-form banner ───────────────────────────────────────────

export const sharedContactFormKeys = {
  all: ['shared', 'contact-records'] as const,
  /** List of incomplete contact records that the banner shows. */
  incomplete: () =>
    [...sharedContactFormKeys.all, 'incomplete'] as const,
};

// ── Specialty patient-scoped widgets (notes panel + MDT banner) ──

export const sharedSpecialtyKeys = {
  all: ['shared', 'specialty'] as const,
  /**
   * Patient clinical notes filtered by note type. Used by the
   * specialty-tab notes panel. Uses an `unknown` filter slot so
   * any noteType shape passes through unchanged.
   */
  patientNotes: (patientId: string, filters: unknown) =>
    [...sharedSpecialtyKeys.all, 'patient-notes', patientId, filters] as const,
  /** All episodes for a patient (MDT banner header). */
  patientEpisodes: (patientId: string) =>
    [...sharedSpecialtyKeys.all, 'episodes', patientId] as const,
  /** MDT allocation metadata for a single episode. */
  episodeAllocation: (episodeId: string | undefined) =>
    [...sharedSpecialtyKeys.all, 'episode-allocation', episodeId] as const,
};

// ── AI quick-task search (cross-patient search) ──────────────────

export const sharedPatientQuickTaskKeys = {
  all: ['shared', 'patients', 'quick-task-search'] as const,
  /** Cross-patient search for the AI quick-task picker. */
  search: (query: string) =>
    [...sharedPatientQuickTaskKeys.all, query] as const,
};

// ── Command palette (global cross-patient search) ────────────────

export const sharedCommandPaletteKeys = {
  all: ['shared', 'command-palette'] as const,
  /** Fuzzy patient search results for the Cmd-K palette. */
  patientSearch: (query: string) =>
    [...sharedCommandPaletteKeys.all, 'patient-search', query] as const,
};

// ── Breadcrumbs widget ────────────────────────────────────────────

export const sharedBreadcrumbsKeys = {
  all: ['shared', 'breadcrumbs'] as const,
  /** Patient-name lookup so breadcrumbs render the full name. */
  patient: (patientId: string) =>
    [...sharedBreadcrumbsKeys.all, 'patient', patientId] as const,
};

// ── Clinic branding (logo + colour palette) ─────────────────────

export const sharedBrandingKeys = {
  all: ['shared', 'branding'] as const,
  /** The current clinic's subscriber branding overrides. */
  mine: () => [...sharedBrandingKeys.all, 'me'] as const,
};

export const sharedClinicModulesKeys = {
  all: ['shared', 'clinic-modules'] as const,
  mine: () => [...sharedClinicModulesKeys.all, 'me'] as const,
};

export const sharedBuildKeys = {
  all: ['shared', 'build-stamp'] as const,
  apiHealth: () => [...sharedBuildKeys.all, 'api-health'] as const,
};

// ── Tab config (per-clinic navigation override) ──────────────────

export const sharedTabConfigKeys = {
  all: ['shared', 'tab-config'] as const,
  /** The current clinic's tab configuration. */
  current: () => [...sharedTabConfigKeys.all, 'current'] as const,
};

// ── Module visibility (per-user + per-patient) ───────────────────

export const sharedModuleVisibilityKeys = {
  all: ['shared', 'module-visibility'] as const,
  /** The current user's staff profile + module access grid. */
  myProfile: () =>
    [...sharedModuleVisibilityKeys.all, 'staff-profile', 'me'] as const,
  /** Active specialties for a given patient (drives tab visibility). */
  patientActiveSpecialties: (patientId: string) =>
    [
      ...sharedModuleVisibilityKeys.all,
      'patient-active-specialties',
      patientId,
    ] as const,
};

// ── SSE event-handler broadcast invalidations ────────────────────
//
// useEventStream receives SSE push events and broadcasts
// invalidations to the React Query cache. These are fan-out
// invalidations that target caches owned by OTHER features, so
// the correct long-term shape is to import the owning feature's
// factory and call its `.all` base tuple. For the handful of
// broadcast targets that don't have a feature factory (check-in
// scheduling, MAR administrations, admin overview) the literal
// base tuple lives here under the shared factory so the
// invalidation site is still pulling from a single source of
// truth.
export const sharedSseEventKeys = {
  checkinAppointments: () => ['checkin-appointments'] as const,
  marAdministrations: () => ['mar-administrations'] as const,
  adminOverview: () => ['admin-overview'] as const,
};
