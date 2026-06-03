import { apiClient } from '../../../shared/services/apiClient';
import type {
  MedicationResponse,
  MedicationCreateDTO,
  MedicationUpdateDTO,
  MedicationCeaseDTO,
} from '@signacare/shared';

const BASE = 'medications';

export const medicationApi = {
  listByPatient: async (
    patientId: string,
    episodeId?: string,
  ): Promise<MedicationResponse[]> => {
    return apiClient.get<MedicationResponse[]>(
      `patients/${patientId}/${BASE}`,
      { params: { episodeId } },
    );
  },

  getById: async (id: string): Promise<MedicationResponse> => {
    return apiClient.get<MedicationResponse>(`${BASE}/${id}`);
  },

  create: async (dto: MedicationCreateDTO): Promise<MedicationResponse> => {
    return apiClient.post<MedicationResponse>(BASE, dto);
  },

  update: async (id: string, dto: MedicationUpdateDTO): Promise<MedicationResponse> => {
    return apiClient.patch<MedicationResponse>(`${BASE}/${id}`, dto);
  },

  cease: async (id: string, dto: MedicationCeaseDTO): Promise<MedicationResponse> => {
    return apiClient.post<MedicationResponse>(`${BASE}/${id}/cease`, dto);
  },

  reactivate: async (id: string): Promise<MedicationResponse> => {
    // Status change on an existing resource → PATCH. Backend route
    // not yet implemented; this method is currently unused in the UI.
    return apiClient.patch<MedicationResponse>(`${BASE}/${id}/reactivate`, {});
  },

  searchDrugs: async (query: string): Promise<DrugSearchResult[]> => {
    return apiClient.get<DrugSearchResult[]>('drug-products/search', {
      params: { q: query },
    });
  },
};

export interface DrugSearchResult {
  id: string;
  genericName: string;
  brandName: string | null;
  amtCode: string | null;
  isControlled: boolean;
  isSafeScriptRequired: boolean;
  defaultRoutes: string[];
  defaultFrequencies: string[];
}
