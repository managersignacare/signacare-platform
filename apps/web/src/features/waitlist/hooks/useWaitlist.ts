// apps/web/src/features/waitlist/hooks/useWaitlist.ts
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { waitlistApi } from '../services/waitlistApi';
import { waitlistKeys } from '../queryKeys';
import { appointmentQueryKeys } from '../../appointments/hooks/useAppointments';
import type { WaitlistCreateDTO, CreateAppointmentDTO } from '@signacare/shared';

export function useWaitlist(params: {
  patientId?: string;
  status?: string;
  priority?: string;
}) {
  return useQuery({
    queryKey: waitlistKeys.list(params),
    queryFn: () => waitlistApi.list(params),
  });
}

export function useCreateWaitlistEntry() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (payload: WaitlistCreateDTO) => waitlistApi.create(payload),
    onSuccess: () => qc.invalidateQueries({ queryKey: waitlistKeys.all }),
  });
}

export function useUpdateWaitlistEntry(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (payload: Partial<WaitlistCreateDTO>) => waitlistApi.update(id, payload),
    onSuccess: () => qc.invalidateQueries({ queryKey: waitlistKeys.all }),
  });
}

export function usePromoteWaitlistEntry(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (appointment: CreateAppointmentDTO) => waitlistApi.promote(id, appointment),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: appointmentQueryKeys.all });
      qc.invalidateQueries({ queryKey: waitlistKeys.all });
    },
  });
}
