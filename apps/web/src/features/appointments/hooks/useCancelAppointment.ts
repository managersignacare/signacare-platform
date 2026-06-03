// apps/web/src/features/appointments/hooks/useCancelAppointment.ts
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { appointmentApi } from '../services/appointmentApi';
import { appointmentQueryKeys } from './useAppointments';

export const useCancelAppointment = (id: string) => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (_reason?: string) => appointmentApi.updateStatus(id, 'cancelled', _reason),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: appointmentQueryKeys.all });
    },
  });
};