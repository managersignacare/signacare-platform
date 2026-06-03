import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { medicationApi } from '../services/medicationApi';
import type { MedicationCreateDTO, MedicationUpdateDTO, MedicationCeaseDTO } from '@signacare/shared';
import { medicationKeys, medicationsPatientScopeKeys } from '../queryKeys';

export const useMedications = (patientId: string, episodeId?: string) =>
  useQuery({
    queryKey: medicationKeys.byPatientEpisode(patientId, episodeId),
    queryFn: () => medicationApi.listByPatient(patientId, episodeId),
    enabled: !!patientId,
    staleTime: 30_000,
  });

export const useMedication = (id: string) =>
  useQuery({
    queryKey: medicationKeys.detail(id),
    queryFn: () => medicationApi.getById(id),
    enabled: !!id,
    staleTime: 30_000,
  });

export const useCreateMedication = (patientId: string) => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (dto: MedicationCreateDTO) => medicationApi.create(dto),
    onSuccess: () => {
      medicationsPatientScopeKeys(patientId).forEach((key) =>
        qc.invalidateQueries({ queryKey: key }),
      );
    },
  });
};

export const useUpdateMedication = (patientId: string) => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, dto }: { id: string; dto: MedicationUpdateDTO }) =>
      medicationApi.update(id, dto),
    onSuccess: () => {
      medicationsPatientScopeKeys(patientId).forEach((key) =>
        qc.invalidateQueries({ queryKey: key }),
      );
    },
  });
};

export const useCeaseMedication = (patientId: string) => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, dto }: { id: string; dto: MedicationCeaseDTO }) =>
      medicationApi.cease(id, dto),
    onSuccess: () => {
      medicationsPatientScopeKeys(patientId).forEach((key) =>
        qc.invalidateQueries({ queryKey: key }),
      );
    },
  });
};
