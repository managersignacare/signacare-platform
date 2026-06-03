import { useQuery } from '@tanstack/react-query';
import { apiClient } from '../../../shared/services/apiClient';
import { intakeKeys } from '../queryKeys';

type ReferralModule = 'solo' | 'team' | null;

/**
 * Returns the active referral module for the current clinic.
 * - 'solo' = Solo Referral Management
 * - 'team' = Team Referral Management
 * - null = standard workflow (no module active)
 */
export function useReferralModule(): { module: ReferralModule; isLoading: boolean } {
  const { data, isLoading } = useQuery({
    queryKey: intakeKeys.clinicModules.all,
    queryFn: async () => {
      try {
        const resp = await apiClient.get<{ modules: Record<string, boolean> }>(
          `power-settings/subscriptions/me/modules`,
        );
        return resp?.modules ?? {};
      } catch {
        return {};
      }
    },
    staleTime: 60_000,
    gcTime: 5 * 60 * 1000,
  });

  let module: ReferralModule = null;
  if (data?.['referral-solo']) module = 'solo';
  else if (data?.['referral-team']) module = 'team';

  return { module, isLoading };
}
