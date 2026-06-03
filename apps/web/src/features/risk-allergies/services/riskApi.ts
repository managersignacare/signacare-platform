// apps/web/src/features/risk-allergies/services/riskApi.ts
import { apiClient } from '../../../shared/services/apiClient';
import type {
  CreateRiskAssessmentDTO,
  RiskAssessmentResponse,
  RiskTemplate,
} from '../types/riskTypes';

const patientBase = (patientId: string) =>
  `/patients/${patientId}/risk-assessments`;

export const riskApi = {
  list: async (
    patientId: string,
    params?: { episodeId?: string },
  ): Promise<RiskAssessmentResponse[]> => {
    return apiClient.get<RiskAssessmentResponse[]>(
      patientBase(patientId),
      { params },
    );
  },

  getById: async (
    patientId: string,
    id: string,
  ): Promise<RiskAssessmentResponse> => {
    return apiClient.get<RiskAssessmentResponse>(
      `${patientBase(patientId)}/${id}`,
    );
  },

  create: async (
    dto: CreateRiskAssessmentDTO,
  ): Promise<RiskAssessmentResponse> => {
    return apiClient.post<RiskAssessmentResponse>(
      patientBase(dto.patientId),
      dto,
    );
  },

  softDelete: async (patientId: string, id: string): Promise<void> => {
    await apiClient.delete(`${patientBase(patientId)}/${id}`);
  },

  // ─── Template support ───────────────────────────────────────────────────────

  listTemplates: async (): Promise<RiskTemplate[]> => {
    return apiClient.get<RiskTemplate[]>(
      '/risk-assessments/templates',
    );
  },

  getTemplate: async (templateId: string): Promise<RiskTemplate> => {
    return apiClient.get<RiskTemplate>(
      `/risk-assessments/templates/${templateId}`,
    );
  },
} as const;
