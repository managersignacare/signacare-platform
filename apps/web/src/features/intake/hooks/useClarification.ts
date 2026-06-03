import { useMutation, useQueryClient } from '@tanstack/react-query';
import { intakeApi } from '../services/intakeApi';
import { intakeKeys } from '../queryKeys';

export function useRequestClarification() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ referralId, question }: { referralId: string; question: string }) =>
      intakeApi.requestClarification(referralId, { question }),
    onSuccess: (_data, variables) => {
      // Fixes pre-existing bug: was invalidating ['referrals'] which never
      // matched the real cache key ['intake','referrals',...].
      queryClient.invalidateQueries({ queryKey: intakeKeys.referrals.all });
      queryClient.invalidateQueries({
        queryKey: intakeKeys.feedbackLog.byReferral(variables.referralId),
      });
    },
  });
}

export function useAddClarificationResponse() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ referralId, notes }: { referralId: string; notes: string }) =>
      intakeApi.addClarificationResponse(referralId, { notes }),
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: intakeKeys.referrals.all });
      queryClient.invalidateQueries({
        queryKey: intakeKeys.feedbackLog.byReferral(variables.referralId),
      });
    },
  });
}
