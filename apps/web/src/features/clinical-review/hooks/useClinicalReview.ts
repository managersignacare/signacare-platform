// apps/web/src/features/clinical-review/hooks/useClinicalReview.ts
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { clinicalReviewApi } from '../services/clinicalReviewApi';
import type { EngagementRapportScore, KeyIssue, ReviewPlan } from '../types/reviewTypes';

export const clinicalReviewKeys = {
  all: ['clinical-review'] as const,
  summary: (patientId: string, episodeId?: string) =>
    [...clinicalReviewKeys.all, 'summary', patientId, episodeId ?? 'all'] as const,
  timeline: (patientId: string) =>
    [...clinicalReviewKeys.all, 'timeline', patientId] as const,
  consultation: (encounterId: string) =>
    [...clinicalReviewKeys.all, 'consultation', encounterId] as const,
};

export function useClinicalReview(patientId: string, episodeId?: string) {
  return useQuery({
    queryKey: clinicalReviewKeys.summary(patientId, episodeId),
    queryFn: () => clinicalReviewApi.getClinicalReview(patientId, episodeId),
    enabled: Boolean(patientId),
    staleTime: 2 * 60 * 1000,
  });
}

export function useEncounterTimeline(patientId: string) {
  return useQuery({
    queryKey: clinicalReviewKeys.timeline(patientId),
    queryFn: () => clinicalReviewApi.getEncounterTimeline(patientId),
    enabled: Boolean(patientId),
    staleTime: 5 * 60 * 1000,
  });
}

export function useConsultation(encounterId: string) {
  return useQuery({
    queryKey: clinicalReviewKeys.consultation(encounterId),
    queryFn: () => clinicalReviewApi.getConsultation(encounterId),
    enabled: Boolean(encounterId),
  });
}

export function useSaveEngagementScore() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (payload: EngagementRapportScore) =>
      clinicalReviewApi.saveEngagementScore(payload),
    onSuccess: (_data, vars) => {
      void qc.invalidateQueries({
        queryKey: clinicalReviewKeys.consultation(vars.encounterId),
      });
    },
  });
}

export function useSaveKeyIssues() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      encounterId,
      issues,
    }: {
      encounterId: string;
      issues: KeyIssue[];
    }) => clinicalReviewApi.saveKeyIssues(encounterId, issues),
    onSuccess: (_data, vars) => {
      void qc.invalidateQueries({
        queryKey: clinicalReviewKeys.consultation(vars.encounterId),
      });
    },
  });
}

export function useSaveReviewPlan() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (payload: ReviewPlan) => clinicalReviewApi.saveReviewPlan(payload),
    onSuccess: (_data, vars) => {
      void qc.invalidateQueries({ queryKey: clinicalReviewKeys.all });
      void qc.invalidateQueries({
        queryKey: clinicalReviewKeys.timeline(vars.patientId),
      });
    },
  });
}
