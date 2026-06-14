// apps/web/src/features/referrals/queryKeys.ts
//
// Phase 0.7 PR2 Class F — React Query key factory for the referrals
// feature (intake inbox, referral-out queue, notes timeline). Single
// source of truth so mutation invalidations match queries
// (CLAUDE.md §4.1).

const REFERRALS_ROOT = 'referrals';

export const referralKeys = {
  all: [REFERRALS_ROOT] as const,
  list: (filters: Record<string, unknown>) => [REFERRALS_ROOT, filters] as const,
  coordinatorQueueAll: [REFERRALS_ROOT, 'coordinator-queue'] as const,
  coordinatorQueueList: (params: Record<string, unknown>) =>
    [REFERRALS_ROOT, 'coordinator-queue', params] as const,
  notes: (referralId: string | null) => [REFERRALS_ROOT, 'notes', referralId] as const,
} as const;

// ── Cross-feature namespaces used by referral pages ──────────────────────
// The referral pages reach across to patient search and staff directory
// data. Preserve literal prefixes here — do NOT import other feature
// factories.

export const referralsCrossFeatureKeys = {
  patientsSearch: (search: string) => ['patients', 'search', search] as const,
  staffLookup: (clinicId?: string) => ['staff', 'lookup', clinicId ?? 'session'] as const,
  referralSources: () => ['staff-settings', 'referral-sources'] as const,
} as const;

export const referralOutKeys = {
  all: ['referral-out'] as const,
  diagnoses: (patientId: string | null) =>
    ['referral-out', patientId ?? 'none', 'diagnoses'] as const,
  medications: (patientId: string | null) =>
    ['referral-out', patientId ?? 'none', 'medications'] as const,
  providers: (patientId: string | null) =>
    ['referral-out', patientId ?? 'none', 'providers'] as const,
} as const;
