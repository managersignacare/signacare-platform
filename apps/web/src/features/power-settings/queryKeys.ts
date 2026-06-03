// apps/web/src/features/power-settings/queryKeys.ts
// Phase 0.7 PR2 Class F — React Query key factory for power-settings (CLAUDE.md §4.1).
//
// Note: several of the cache namespaces below ("staff-settings", "template-categories",
// "episode-types", "subscription-modules", "clinic-specialties",
// "staff-profile") are shared with queries and invalidations in other feature
// directories. The literal root strings are preserved here so that invalidations
// from power-settings still match the keys used elsewhere in the app.
export const powerSettingsKeys = {
  all: ['power-settings'] as const,
  clinicsList: () => [...powerSettingsKeys.all, 'clinics-list'] as const,

  // Cross-feature: staff-settings/*
  staffSettingsAlertTypes: () =>
    ['staff-settings', 'alert-types'] as const,
  staffSettingsLegalOrderTypes: () =>
    ['staff-settings', 'legal-order-types'] as const,
  staffSettingsAppointmentModes: () =>
    ['staff-settings', 'appointment-modes'] as const,

  // Cross-feature top-level namespaces.
  templateCategories: () => ['template-categories'] as const,
  episodeTypes: () => ['episode-types'] as const,
  subscriptionModules: (clinicId: string) =>
    ['subscription-modules', clinicId] as const,
  clinicSpecialties: (clinicId: string) =>
    ['clinic-specialties', clinicId] as const,
  staffProfileMe: () => ['staff-profile', 'me'] as const,

  // Phase 0.5.C — Access Administrators tab queries. Separate keys for
  // the per-clinic admin record + the staff list used by the pickers.
  accessAdmins: (clinicId: string) =>
    [...powerSettingsKeys.all, 'access-admins', clinicId] as const,
  clinicStaff: (clinicId: string) =>
    [...powerSettingsKeys.all, 'clinic-staff', clinicId] as const,
  levelLabels: (clinicId: string) =>
    [...powerSettingsKeys.all, 'level-labels', clinicId] as const,

  // BUG-374a — Data retention configuration. GET admin-readable, PUT
  // superadmin-only (Q3b policy locked 2026-04-26).
  retention: (clinicId: string) =>
    [...powerSettingsKeys.all, 'retention', clinicId] as const,
  // BUG-P2 — Session idle timeout (PRES-6 DH-3869). GET admin-readable,
  // PUT superadmin-only.
  sessionIdle: (clinicId: string) =>
    [...powerSettingsKeys.all, 'session-idle', clinicId] as const,
} as const;
