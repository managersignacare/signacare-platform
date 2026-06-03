import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { prescriptionApi } from '../services/prescriptionApi';
import type { PrescriptionCreateDTO } from '@signacare/shared';
import type { SafeScriptIdentifierPayload } from '../services/prescriptionApi';
import { prescriptionKeys, medicationsPatientScopeKeys } from '../queryKeys';

export const usePrescriptions = (patientId: string) =>
  useQuery({
    queryKey: prescriptionKeys.byPatient(patientId),
    queryFn: () => prescriptionApi.listByPatient(patientId),
    enabled: !!patientId,
    staleTime: 30_000,
  });

export const useCreatePrescription = (patientId: string) => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (dto: PrescriptionCreateDTO) => prescriptionApi.create(dto),
    onSuccess: () => {
      medicationsPatientScopeKeys(patientId).forEach((key) =>
        qc.invalidateQueries({ queryKey: key }),
      );
    },
  });
};

export const useRunSafeScriptCheck = (patientId: string) => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, identifier }: { id: string; identifier: SafeScriptIdentifierPayload }) =>
      prescriptionApi.runSafeScriptCheck(id, identifier),
    onSuccess: () => {
      medicationsPatientScopeKeys(patientId).forEach((key) =>
        qc.invalidateQueries({ queryKey: key }),
      );
    },
  });
};

export const useCancelPrescription = (patientId: string) => {
  const qc = useQueryClient();
  return useMutation({
    // BUG-371b — caller MUST pass `expectedLockVersion` (read from
    // the prescription's lockVersion field on the GET response).
    // On conflict (409 OPTIMISTIC_LOCK_CONFLICT) the mutation
    // rejects with AppError; UI should refetch + surface a "another
    // clinician edited this — refresh and retry" toast.
    // BUG-553 — caller MUST also pass `reasonForCancellation` (1..500).
    // The dedicated /cease path (medication-cease) and /cancel path
    // (prescription-cancel) both now persist a reason for the AHPRA
    // S8/SafeScript forensic chain.
    mutationFn: ({
      id,
      expectedLockVersion,
      reasonForCancellation,
    }: {
      id: string;
      expectedLockVersion: number;
      reasonForCancellation: string;
    }) => prescriptionApi.cancel(id, expectedLockVersion, reasonForCancellation),
    onSuccess: () => {
      medicationsPatientScopeKeys(patientId).forEach((key) =>
        qc.invalidateQueries({ queryKey: key }),
      );
    },
  });
};
