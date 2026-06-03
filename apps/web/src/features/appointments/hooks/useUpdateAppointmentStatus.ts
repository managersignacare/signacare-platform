// apps/web/src/features/appointments/hooks/useUpdateAppointmentStatus.ts
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { appointmentApi } from '../services/appointmentApi';
import type { AppointmentStatus } from '../types/appointmentTypes';
import { appointmentQueryKeys } from './useAppointments';

export const useUpdateAppointmentStatus = (id: string) => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (status: AppointmentStatus) => appointmentApi.updateStatus(id, status),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: appointmentQueryKeys.all });
    },
  });
};