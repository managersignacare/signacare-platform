// apps/web/src/features/intake/queryKeys.ts
//
// Phase 0.7 PR2 Class F — React Query key factory for the intake feature.
// Single source of truth so mutation invalidations always match the
// corresponding queries (CLAUDE.md §4.1). This covers the intake hook
// cluster (referrals, offers, feedback log, referral module) and also
// exposes the cross-feature namespace prefixes this feature reads from
// as literal string tuples.
//
// IMPORTANT: `intakeKeys.referrals` MUST stay shape-compatible with the
// `referralQueryKeys` export in `./hooks/useReferrals.ts` — both produce
// identical tuples so that any mutation using either one invalidates
// the same underlying React Query cache entries. Do not diverge the
// namespace prefixes.
import type { MyOffersFilters } from '@signacare/shared';
import type { ReferralFilters } from './types/intakeTypes';

export const intakeKeys = {
  // ── Referrals (mirror of referralQueryKeys in useReferrals.ts) ──
  referrals: {
    all: ['intake', 'referrals'] as const,
    lists: () => [...intakeKeys.referrals.all, 'list'] as const,
    list: (filters?: ReferralFilters) =>
      [...intakeKeys.referrals.lists(), filters ?? {}] as const,
    details: () => [...intakeKeys.referrals.all, 'detail'] as const,
    detail: (id: string) => [...intakeKeys.referrals.details(), id] as const,
    events: (id: string) => [...intakeKeys.referrals.detail(id), 'events'] as const,
  },

  // ── My offers (clinician inbox of broadcast referral offers) ──
  myOffers: {
    all: ['my-offers'] as const,
    list: (filters?: MyOffersFilters) => ['my-offers', filters] as const,
  },

  // ── Referral offers (offers attached to a specific referral) ──
  offers: {
    all: ['referral-offers'] as const,
    byReferral: (referralId: string) => ['referral-offers', referralId] as const,
  },

  // ── Referral feedback log ──
  feedbackLog: {
    all: ['referral-feedback-log'] as const,
    byReferral: (referralId: string) =>
      ['referral-feedback-log', referralId] as const,
  },

  // ── Active referral module (solo / team) — owned by power-settings ──
  // Cross-feature: the `clinic-modules` namespace is shared with the
  // power-settings feature. Preserved as a literal string per Phase 0.7
  // PR2 Class F cross-feature namespacing rule (do NOT import the
  // power-settings factory).
  clinicModules: {
    all: ['clinic-modules'] as const,
  },

  // ── Cross-feature lookups used by ReferralForm ──
  // Preserved as literal strings (owned by the staff / org-settings
  // features). Do NOT import those factories.
  staffClinicians: {
    all: ['staff-clinicians'] as const,
  },
  disciplines: {
    all: ['disciplines'] as const,
  },
  staffLookup: {
    all: ['staff-lookup'] as const,
  },
} as const;
