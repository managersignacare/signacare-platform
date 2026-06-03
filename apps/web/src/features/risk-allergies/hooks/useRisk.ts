// apps/web/src/features/risk-allergies/hooks/useRisk.ts
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { riskApi } from '../services/riskApi';
import { riskKeys } from '../queryKeys';
import type { CreateRiskAssessmentDTO } from '../types/riskTypes';

export function useRiskAssessments(
  patientId: string,
  episodeId?: string,
) {
  return useQuery({
    queryKey: riskKeys.list(patientId, episodeId),
    queryFn:  () => riskApi.list(patientId, episodeId ? { episodeId } : undefined),
    enabled:  !!patientId,
  });
}

export function useRiskAssessment(patientId: string, id: string) {
  return useQuery({
    queryKey: riskKeys.detail(patientId, id),
    queryFn:  () => riskApi.getById(patientId, id),
    enabled:  !!patientId && !!id,
  });
}

export function useRiskTemplates() {
  return useQuery({
    queryKey: riskKeys.templates(),
    queryFn:  riskApi.listTemplates,
    staleTime: 10 * 60 * 1000,
  });
}

export function useRiskTemplate(templateId: string) {
  return useQuery({
    queryKey: riskKeys.template(templateId),
    queryFn:  () => riskApi.getTemplate(templateId),
    enabled:  !!templateId,
    staleTime: 10 * 60 * 1000,
  });
}

export function useCreateRiskAssessment() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (dto: CreateRiskAssessmentDTO) => riskApi.create(dto),
    onSuccess: (_data, dto) => {
      void qc.invalidateQueries({ queryKey: riskKeys.patient(dto.patientId) });
    },
  });
}

export function useDeleteRiskAssessment() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ patientId, id }: { patientId: string; id: string }) =>
      riskApi.softDelete(patientId, id),
    onSuccess: (_data, { patientId }) => {
      void qc.invalidateQueries({ queryKey: riskKeys.patient(patientId) });
    },
  });
}
