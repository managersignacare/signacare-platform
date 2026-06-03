import { useMutation, useQueryClient } from '@tanstack/react-query';
import { intakeApi } from '../services/intakeApi';
import type { CreateReferral } from '../types/intakeTypes';
import { referralQueryKeys } from './useReferrals';

export const useCreateReferral = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (dto: CreateReferral) => intakeApi.create(dto),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: referralQueryKeys.all });
    },
  });
};
