/**
 * apps/web/src/shared/hooks/useFeatureFlag.ts
 *
 * S4.2 — Feature flag React hook
 *
 * Pairs with the backend feature flag service at
 * apps/api/src/shared/featureFlags.ts and the bootstrap endpoint
 * GET /feature-flags introduced in the same commit.
 *
 * Shape mirrors Unleash's useFlag so a future migration to
 * @unleash/proxy-client-react is a one-line import swap:
 *
 *   const live = useFeatureFlag('scribe-live-transcript-beta');
 *   if (live) { ... }
 *
 * Design notes:
 *
 *   - One network call per session: the full flag map is fetched once
 *     on mount and cached via React Query. The default staleTime is
 *     60 seconds (same as the backend cache TTL) so toggles take
 *     effect within the next request after an admin write.
 *
 *   - SSR-safe: during SSR/build there is no fetch and every flag
 *     returns false (fail closed). This matches how the backend
 *     defaults unknown flags.
 *
 *   - Fail closed on fetch error. A missing endpoint, a 500, or a
 *     network blip all resolve to `false` rather than blocking the
 *     UI with an error boundary. A logged warning is the only
 *     visible signal.
 *
 *   - The hook does NOT accept a default value. If you need a
 *     different fallback, wrap the hook in your own guard. Keeping
 *     the API minimal forces "is this feature on?" questions to be
 *     answered deterministically.
 */

import { useQuery } from '@tanstack/react-query';
import { apiClient } from '../services/apiClient';
import { useAuthStore } from '../store/authStore';

interface FeatureFlagMapResponse {
  flags: Record<string, boolean>;
}

const FLAG_QUERY_KEY = ['feature-flags'] as const;
const STALE_TIME_MS = 60_000;

/**
 * Fetch the resolved feature flag map for the current clinic.
 * Exposed as a named query hook so code that needs the full map
 * (e.g. the admin settings page) can reuse the same cache entry as
 * the individual useFeatureFlag calls.
 */
export function useFeatureFlagMap() {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const queryKey = [...FLAG_QUERY_KEY, isAuthenticated ? 'auth' : 'anon'] as const;

  return useQuery<Record<string, boolean>>({
    queryKey,
    enabled: isAuthenticated,
    queryFn: async () => {
      try {
        // S0.2 naming rule: relative URL, no leading slash, no /api/v1 prefix.
        const resp = await apiClient.get<FeatureFlagMapResponse>('feature-flags');
        return resp?.flags ?? {};
      } catch {
        // Fail closed — see the design note in the header.
        return {};
      }
    },
    staleTime: STALE_TIME_MS,
    gcTime: 5 * 60 * 1000,
    refetchOnWindowFocus: false,
  });
}

/**
 * Boolean lookup for a single flag name.
 *
 * Returns `false` while the initial fetch is in flight (fail closed),
 * so call sites can do `const on = useFeatureFlag('foo'); if (on) ...`
 * without a loading gate. This is deliberate: feature flags should
 * never block render — they're an enhancement path.
 */
export function useFeatureFlag(name: string): boolean {
  const { data } = useFeatureFlagMap();
  return data?.[name] === true;
}
