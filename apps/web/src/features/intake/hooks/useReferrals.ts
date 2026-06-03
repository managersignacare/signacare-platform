import { useQuery } from '@tanstack/react-query';
import { intakeApi } from '../services/intakeApi';
import type { ReferralFilters } from '../types/intakeTypes';

export const referralQueryKeys = {
  all: ['intake', 'referrals'] as const,
  lists: () => [...referralQueryKeys.all, 'list'] as const,
  list: (filters?: ReferralFilters) => [...referralQueryKeys.lists(), filters ?? {}] as const,
  details: () => [...referralQueryKeys.all, 'detail'] as const,
  detail: (id: string) => [...referralQueryKeys.details(), id] as const,
  events: (id: string) => [...referralQueryKeys.detail(id), 'events'] as const,
};

export const useReferrals = (filters?: ReferralFilters) =>
  useQuery({
    queryKey: referralQueryKeys.list(filters),
    queryFn: async () => {
      const { statusIn, team, period, ...apiFilters } = filters ?? {};
      const data = await intakeApi.list(Object.keys(apiFilters).length ? apiFilters : undefined);
      let filtered = data;
      if (statusIn?.length) filtered = filtered.filter(r => statusIn.includes(r.status));
      if (team) filtered = filtered.filter(r => (r.fromProviderName ?? r.source ?? '').toLowerCase().includes(team.toLowerCase()));
      if (period) {
        const days = period === '7d' ? 7 : period === '30d' ? 30 : period === '90d' ? 90 : 0;
        if (days > 0) {
          const cutoff = new Date(); cutoff.setDate(cutoff.getDate() - days);
          filtered = filtered.filter(r => new Date(r.receivedAt ?? r.referralDate ?? r.createdAt ?? 0) >= cutoff);
        }
      }
      return filtered;
    },
    staleTime: 60_000,
  });
