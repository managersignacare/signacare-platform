// apps/web/src/features/patients/hooks/useCreatePatient.ts
import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { CreatePatientDTO } from '@signacare/shared';
import { patientApi } from '../services/patientApi';
import { patientsKeys } from '../queryKeys';

export function useCreatePatient() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (dto: CreatePatientDTO) => patientApi.createPatient(dto),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: patientsKeys.all });
    },
  });
}
