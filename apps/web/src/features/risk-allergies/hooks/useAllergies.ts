// apps/web/src/features/risk-allergies/hooks/useAllergies.ts
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { allergyApi } from '../services/allergyApi';
import { allergiesKeys } from '../queryKeys';
import type { CreateAllergyDTO, UpdateAllergyDTO } from '../types/allergyTypes';

export function useAllergies(patientId: string, active?: boolean) {
  return useQuery({
    queryKey: allergiesKeys.list(patientId, active),
    queryFn:  () => allergyApi.list(patientId, active !== undefined ? { active } : undefined),
    enabled:  !!patientId,
  });
}

export function useAllergyInteractionCheck(
  patientId: string,
  drugName: string,
) {
  return useQuery({
    queryKey: allergiesKeys.check(patientId, drugName),
    queryFn:  () => allergyApi.checkInteraction(patientId, drugName),
    enabled:  !!patientId && drugName.length >= 2,
    staleTime: 30_000,
  });
}

export function useCreateAllergy() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (dto: CreateAllergyDTO) => allergyApi.create(dto),
    onSuccess: (_data, dto) => {
      void qc.invalidateQueries({ queryKey: allergiesKeys.patient(dto.patientId) });
    },
  });
}

export function useUpdateAllergy() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      patientId,
      id,
      dto,
    }: {
      patientId: string;
      id: string;
      dto: UpdateAllergyDTO;
    }) => allergyApi.update(patientId, id, dto),
    onSuccess: (_data, { patientId }) => {
      void qc.invalidateQueries({ queryKey: allergiesKeys.patient(patientId) });
    },
  });
}

export function useDeleteAllergy() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ patientId, id }: { patientId: string; id: string }) =>
      allergyApi.softDelete(patientId, id),
    onSuccess: (_data, { patientId }) => {
      void qc.invalidateQueries({ queryKey: allergiesKeys.patient(patientId) });
    },
  });
}
