// apps/web/src/features/patients/hooks/usePatients.ts
import { useQuery } from '@tanstack/react-query';
import { useAuthStore } from '../../../store/authStore';
import { patientApi, type PatientSearchDTO } from '../services/patientApi';
import { patientsKeys } from '../queryKeys';

export function usePatients(filters: Omit<PatientSearchDTO, 'clinicId'> = {}) {
  const clinicId = useAuthStore((s) => s.user?.clinicId ?? '');

  return useQuery({
    queryKey: patientsKeys.list({ clinicId, ...filters }),
    queryFn: () => patientApi.listPatients({ ...filters }),
    enabled: Boolean(clinicId),
    staleTime: 30_000,
  });
}
