// apps/web/src/features/auth/queryKeys.ts
//
// Phase 0.7 PR2 Class F — React Query key factory for auth.
// Login / logout mutations invalidate authKeys.all so every subscriber to
// authKeys.me() refetches the staff record (CLAUDE.md §4.1).
export const authKeys = {
  all: ['auth'] as const,
  me: () => [...authKeys.all, 'me'] as const,
  branding: () => ['branding', 'public'] as const,
} as const;
