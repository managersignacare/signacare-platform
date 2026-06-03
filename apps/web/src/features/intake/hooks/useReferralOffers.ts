import { useQuery } from '@tanstack/react-query';
import { intakeApi } from '../services/intakeApi';
import { intakeKeys } from '../queryKeys';

export function useReferralOffers(referralId: string) {
  return useQuery({
    queryKey: intakeKeys.offers.byReferral(referralId),
    queryFn: () => intakeApi.getReferralOffers(referralId),
    enabled: !!referralId,
  });
}
