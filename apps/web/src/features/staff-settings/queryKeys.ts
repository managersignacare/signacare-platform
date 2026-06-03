// apps/web/src/features/staff-settings/queryKeys.ts
//
// Phase 0.7 PR2 Class F — React Query key factories for the staff-settings
// feature. Single source of truth for cache keys so mutation invalidations
// always match the corresponding queries (CLAUDE.md §4.1).
//
// NOTE: this feature has a mix of top-level namespaces because different
// panels target different APIs:
//   - 'staff-settings' for discipline / clinical-role / referral-source etc
//     (via useStaffSettings.ts)
//   - 'staff' for the shared staff-lookup endpoint (cross-feature)
//   - 'staff-profile', 'staff-prescriber' — credentials dialog
// Each is preserved as a literal prefix so we don't silently move rows.

// Internal namespace for the settings panels ────────────────────────────
export const staffSettingsKeys = {
  all: ['staff-settings'] as const,
  disciplines: () => [...staffSettingsKeys.all, 'disciplines'] as const,
  clinicalRoles: () => [...staffSettingsKeys.all, 'clinical-roles'] as const,
  referralSources: () => [...staffSettingsKeys.all, 'referral-sources'] as const,
  investigationTypes: () => [...staffSettingsKeys.all, 'investigation-types'] as const,
  teamAssignments: (staffId?: string) =>
    staffId !== undefined
      ? ([...staffSettingsKeys.all, 'team-assignments', staffId, 'session'] as const)
      : ([...staffSettingsKeys.all, 'team-assignments'] as const),
  teamAssignmentsByScope: (staffId: string | undefined, clinicId: string | undefined) =>
    [...staffSettingsKeys.all, 'team-assignments', staffId ?? 'all', clinicId ?? 'session'] as const,
  roleAssignments: (staffId?: string) =>
    staffId !== undefined
      ? ([...staffSettingsKeys.all, 'role-assignments', staffId] as const)
      : ([...staffSettingsKeys.all, 'role-assignments'] as const),
  roleAssignmentsByScope: (staffId: string | undefined, clinicId: string | undefined) =>
    [...staffSettingsKeys.all, 'role-assignments', staffId ?? 'all', clinicId ?? 'session'] as const,
  moduleAccessMatrix: () =>
    [...staffSettingsKeys.all, 'module-access', 'matrix'] as const,
  moduleAccessMatrixPage: (params: { page: number; limit: number; q?: string }) =>
    [
      ...staffSettingsKeys.all,
      'module-access',
      'matrix',
      params.page,
      params.limit,
      params.q ?? '',
    ] as const,
} as const;

// Cross-feature: 'staff' namespace belongs to the staff feature.
export const staffKeys = {
  all: ['staff'] as const,
  lookup: () => [...staffKeys.all, 'lookup'] as const,
} as const;

// Staff profile / prescriber (credentials dialog)
export const staffProfileKeys = {
  all: ['staff-profile'] as const,
  detail: (staffId: string | null | undefined) =>
    [...staffProfileKeys.all, staffId ?? 'me'] as const,
} as const;

export const staffPrescriberKeys = {
  all: ['staff-prescriber'] as const,
} as const;
