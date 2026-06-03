import { useMutation, useQueryClient } from '@tanstack/react-query';
import { intakeApi } from '../services/intakeApi';
import type { RespondToOfferDTO } from '@signacare/shared';
import { intakeKeys } from '../queryKeys';

export function useRespondToOffer() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({
      referralId,
      offerId,
      dto,
    }: {
      referralId: string;
      offerId: string;
      dto: RespondToOfferDTO;
    }) => intakeApi.respondToOffer(referralId, offerId, dto),
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: intakeKeys.myOffers.all });
      // Fixes pre-existing bug: was invalidating ['referrals'] which never
      // matched the real cache key ['intake','referrals',...].
      queryClient.invalidateQueries({ queryKey: intakeKeys.referrals.all });
      queryClient.invalidateQueries({
        queryKey: intakeKeys.offers.byReferral(variables.referralId),
      });
    },
  });
}
