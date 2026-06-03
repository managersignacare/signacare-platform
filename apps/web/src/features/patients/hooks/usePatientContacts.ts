// apps/web/src/features/patients/hooks/usePatientContacts.ts
import { useQuery } from '@tanstack/react-query';
import { patientApi } from '../services/patientApi';
import { patientsKeys } from '../queryKeys';

export function usePatientContacts(patientId: string) {
  return useQuery({
    queryKey: patientsKeys.contactsAlt(patientId),
    queryFn: () => patientApi.getPatientContacts(patientId),
    enabled: Boolean(patientId),
    staleTime: 60_000,
  });
}
