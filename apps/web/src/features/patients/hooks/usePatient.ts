// apps/web/src/features/patients/hooks/usePatient.ts
import { useQuery } from '@tanstack/react-query';
import { useAuthStore } from '../../../store/authStore';
import { patientApi } from '../services/patientApi';
import { patientsKeys } from '../queryKeys';

export function usePatient(patientId: string) {
  const clinicId = useAuthStore((s) => s.user?.clinicId ?? '');

  return useQuery({
    queryKey: patientsKeys.detail(patientId),
    queryFn: () => patientApi.getPatient(patientId),
    enabled: Boolean(clinicId) && Boolean(patientId),
    staleTime: 60_000,
  });
}
