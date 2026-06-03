import { useQuery } from '@tanstack/react-query';
import { intakeApi } from '../services/intakeApi';
import { referralQueryKeys } from './useReferrals';

export const useReferral = (id?: string) =>
  useQuery({
    queryKey: id ? referralQueryKeys.detail(id) : referralQueryKeys.details(),
    queryFn: () => intakeApi.getById(id as string),
    enabled: Boolean(id),
  });

export const useReferralWorkflowEvents = (id?: string) =>
  useQuery({
    queryKey: id ? referralQueryKeys.events(id) : [...referralQueryKeys.all, 'events'],
    queryFn: () => intakeApi.getWorkflowEvents(id as string),
    enabled: Boolean(id),
  });
