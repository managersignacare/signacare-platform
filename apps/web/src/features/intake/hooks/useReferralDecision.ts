import { useMutation, useQueryClient } from '@tanstack/react-query';
import { intakeApi } from '../services/intakeApi';
import type { ReferralDecision } from '../types/intakeTypes';
import { intakeKeys } from '../queryKeys';

// Cross-feature: `['episodes']` is owned by the episodes feature.
// Preserved as a literal string per Phase 0.7 PR2 Class F cross-feature
// namespacing rule (do NOT import the episodes factory from here).
const EPISODES_NAMESPACE = ['episodes'] as const;

export const useReferralDecision = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, dto }: { id: string; dto: ReferralDecision }) => intakeApi.decide(id, dto),
    onSuccess: (referral) => {
      void queryClient.invalidateQueries({ queryKey: intakeKeys.referrals.all });
      void queryClient.invalidateQueries({ queryKey: EPISODES_NAMESPACE });
      void queryClient.setQueryData(intakeKeys.referrals.detail(referral.id), referral);
    },
  });
};
