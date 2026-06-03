// apps/web/src/features/ereferral/queryKeys.ts
//
// Phase 0.7 PR2 Class F — React Query key factory for e-referrals (CLAUDE.md §4.1).
// Single source of truth so mutation invalidations always match queries.
export const ereferralKeys = {
  all: ['ereferrals'] as const,
  list: (direction: 'outbound' | 'inbound') =>
    [...ereferralKeys.all, direction] as const,
} as const;
