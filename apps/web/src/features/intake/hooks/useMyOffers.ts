import { useQuery } from '@tanstack/react-query';
import { intakeApi } from '../services/intakeApi';
import type { MyOffersFilters } from '@signacare/shared';
import { intakeKeys } from '../queryKeys';

export function useMyOffers(filters?: MyOffersFilters) {
  return useQuery({
    queryKey: intakeKeys.myOffers.list(filters),
    queryFn: () => intakeApi.getMyOffers(filters),
  });
}
