// apps/web/src/features/patients/hooks/useUpdatePatient.ts
import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { UpdatePatientDTO } from '@signacare/shared';
import { patientApi } from '../services/patientApi';
import { patientsKeys } from '../queryKeys';

export function useUpdatePatient(patientId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (dto: UpdatePatientDTO) => patientApi.updatePatient(patientId, dto),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: patientsKeys.detail(patientId) });
      void queryClient.invalidateQueries({ queryKey: patientsKeys.all });
    },
  });
}

export function useDeletePatient() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (patientId: string) => patientApi.deletePatient(patientId),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: patientsKeys.all });
    },
  });
}
