// apps/web/src/features/clinical-review/services/clinicalReviewApi.ts
import { apiClient } from '@/shared/services/apiClient';
import type {
  ClinicalReviewSummary,
  EncounterTimelineEntry,
  Consultation,
  EngagementRapportScore,
  KeyIssue,
  ReviewPlan,
  ReviewPlanResponse,
} from '../types/reviewTypes';

const BASE = '/clinical-review';

export const clinicalReviewApi = {
  getClinicalReview: async (
    patientId: string,
    episodeId?: string,
  ): Promise<ClinicalReviewSummary> => {
    return apiClient.get<ClinicalReviewSummary>(
      `${BASE}/patients/${patientId}/summary`,
      { params: episodeId ? { episodeId } : {} },
    );
  },

  getEncounterTimeline: async (
    patientId: string,
    limit = 50,
    offset = 0,
  ): Promise<EncounterTimelineEntry[]> => {
    return apiClient.get<EncounterTimelineEntry[]>(
      `${BASE}/patients/${patientId}/timeline`,
      { params: { limit, offset } },
    );
  },

  getConsultation: async (encounterId: string): Promise<Consultation> => {
    return apiClient.get<Consultation>(
      `${BASE}/encounters/${encounterId}`,
    );
  },

  saveEngagementScore: async (
    payload: EngagementRapportScore,
  ): Promise<EngagementRapportScore> => {
    return apiClient.post<EngagementRapportScore>(
      `${BASE}/encounters/${payload.encounterId}/engagement`,
      payload,
    );
  },

  saveKeyIssues: async (
    encounterId: string,
    issues: KeyIssue[],
  ): Promise<KeyIssue[]> => {
    return apiClient.put<KeyIssue[]>(
      `${BASE}/encounters/${encounterId}/key-issues`,
      issues,
    );
  },

  saveReviewPlan: async (payload: ReviewPlan): Promise<ReviewPlanResponse> => {
    return apiClient.post<ReviewPlanResponse>(
      `${BASE}/encounters/${payload.encounterId}/plan`,
      payload,
    );
  },
};
