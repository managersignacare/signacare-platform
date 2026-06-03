// apps/web/src/features/patients/hooks/usePatientFlags.ts
import { useQuery } from '@tanstack/react-query';
import { useAuthStore } from '../../../store/authStore';
import { patientApi } from '../services/patientApi';
import { patientsKeys } from '../queryKeys';

export function usePatientFlags(patientId: string) {
  const clinicId = useAuthStore((s) => s.user?.clinicId ?? '');

  return useQuery({
    queryKey: patientsKeys.flags(patientId),
    queryFn: () => patientApi.getPatientFlags(patientId),
    enabled: Boolean(clinicId) && Boolean(patientId),
    staleTime: 60_000,
  });
}
