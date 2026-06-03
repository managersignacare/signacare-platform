// apps/web/src/features/llm/services/llmApi.ts
import { apiClient } from '@/shared/services/apiClient';
import type {
  SOAPGenerateRequest,
  SOAPNote,
  SummaryGenerateRequest,
  ReferralLetterRequest,
  RiskAnalysisRequest,
  LLMHealth,
} from '../types/llmTypes';

const BASE = '/llm';

export const llmApi = {
  generateSOAP: async (payload: SOAPGenerateRequest): Promise<SOAPNote> => {
    return apiClient.post<SOAPNote>(`${BASE}/soap`, payload);
  },

  generateClinicalSummary: async (
    payload: SummaryGenerateRequest,
  ): Promise<string> => {
    const res = await apiClient.post<{ summary: string; requiresReview: boolean }>(
      `${BASE}/summary`, payload,
    );
    return res.summary;
  },

  draftReferralLetter: async (payload: ReferralLetterRequest): Promise<string> => {
    const res = await apiClient.post<{ letter: string }>(
      `${BASE}/referral-letter`,
      payload,
    );
    return res.letter;
  },

  generateRiskAnalysis: async (payload: RiskAnalysisRequest): Promise<string> => {
    const res = await apiClient.post<{ analysis: string }>(
      `${BASE}/risk-analysis`,
      payload,
    );
    return res.analysis;
  },

  healthCheck: async (): Promise<LLMHealth> => {
    return apiClient.get<LLMHealth>(`${BASE}/health`);
  },
};
