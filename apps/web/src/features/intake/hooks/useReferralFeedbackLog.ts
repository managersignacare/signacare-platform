import { useQuery } from '@tanstack/react-query';
import { intakeApi } from '../services/intakeApi';
import { intakeKeys } from '../queryKeys';

export function useReferralFeedbackLog(referralId: string) {
  return useQuery({
    queryKey: intakeKeys.feedbackLog.byReferral(referralId),
    queryFn: () => intakeApi.getReferralFeedbackLog(referralId),
    enabled: !!referralId,
  });
}
