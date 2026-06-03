import { useMutation, useQueryClient } from '@tanstack/react-query';
import { intakeApi } from '../services/intakeApi';
import { referralQueryKeys } from './useReferrals';

export const useReferralUpload = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ referralId, file }: { referralId: string; file: File }) =>
      intakeApi.uploadLetter(referralId, file),
    onSuccess: (referral) => {
      void queryClient.invalidateQueries({ queryKey: referralQueryKeys.all });
      void queryClient.setQueryData(referralQueryKeys.detail(referral.id), referral);
    },
  });
};
