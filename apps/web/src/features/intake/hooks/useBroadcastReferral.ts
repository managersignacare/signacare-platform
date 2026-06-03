import { useMutation, useQueryClient } from '@tanstack/react-query';
import { intakeApi } from '../services/intakeApi';
import { intakeKeys } from '../queryKeys';

export function useBroadcastReferral() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({
      referralId,
      distributionMode,
      distributionSpeciality,
    }: {
      referralId: string;
      distributionMode?: string;
      distributionSpeciality?: string;
    }) => intakeApi.broadcastReferral(referralId, { distributionMode, distributionSpeciality }),
    onSuccess: (_data, variables) => {
      // Fixes pre-existing bug: was invalidating ['referrals'] which never
      // matched the real cache key ['intake','referrals',...].
      queryClient.invalidateQueries({ queryKey: intakeKeys.referrals.all });
      queryClient.invalidateQueries({
        queryKey: intakeKeys.offers.byReferral(variables.referralId),
      });
    },
  });
}
