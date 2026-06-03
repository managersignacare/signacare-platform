// apps/web/src/features/risk-allergies/services/allergyApi.ts
import { apiClient } from '../../../shared/services/apiClient';
import type {
  CreateAllergyDTO,
  UpdateAllergyDTO,
  AllergyResponse,
} from '../types/allergyTypes';

const base = (patientId: string) => `/patients/${patientId}/allergies`;

export const allergyApi = {
  list: async (
    patientId: string,
    params?: { active?: boolean },
  ): Promise<AllergyResponse[]> => {
    return apiClient.get<AllergyResponse[]>(
      base(patientId),
      { params },
    );
  },

  create: async (dto: CreateAllergyDTO): Promise<AllergyResponse> => {
    return apiClient.post<AllergyResponse>(
      '/allergies',
      dto,
    );
  },

  update: async (
    patientId: string,
    id: string,
    dto: UpdateAllergyDTO,
  ): Promise<AllergyResponse> => {
    return apiClient.patch<AllergyResponse>(
      `${base(patientId)}/${id}`,
      dto,
    );
  },

  softDelete: async (patientId: string, id: string): Promise<void> => {
    await apiClient.delete(`${base(patientId)}/${id}`);
  },

  /**
   * Checks a proposed drug name against the patient's active drug allergies.
   * Returns an array of conflicting allergy records (empty = safe).
   */
  checkInteraction: async (
    patientId: string,
    drugName: string,
  ): Promise<AllergyResponse[]> => {
    return apiClient.get<AllergyResponse[]>(
      `${base(patientId)}/interaction-check`,
      { params: { drugName } },
    );
  },
} as const;
