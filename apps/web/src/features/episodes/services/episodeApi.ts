import { apiClient } from '../../../shared/services/apiClient';
import type {
  Episode,
  CreateEpisodeDTO,
  UpdateEpisodeDTO,
  CloseEpisodeDTO,
  EpisodeSearchDTO,
} from '../types/episodeTypes';

export interface EpisodeListResult {
  data:       Episode[];
  nextCursor: string | null;
}

export const episodeApi = {
  listForPatient: async (
    patientId: string,
    filters?:  Partial<EpisodeSearchDTO>,
  ): Promise<EpisodeListResult> => {
    return apiClient.get<EpisodeListResult>(
      `episodes/patient/${patientId}`,
      { params: filters },
    );
  },

  getById: async (id: string): Promise<Episode> => {
    return apiClient.get<Episode>(`episodes/${id}`);
  },

  create: async (dto: CreateEpisodeDTO): Promise<Episode> => {
    return apiClient.post<Episode>('episodes', dto);
  },

  update: async (id: string, dto: UpdateEpisodeDTO): Promise<Episode> => {
    return apiClient.put<Episode>(`episodes/${id}`, dto);
  },

  close: async (id: string, dto: CloseEpisodeDTO): Promise<Episode> => {
    return apiClient.post<Episode>(`episodes/${id}/close`, dto);
  },
};
