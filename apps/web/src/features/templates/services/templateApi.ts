import { apiClient } from '../../../shared/services/apiClient';
import type {
  CreateTemplateDTO, UpdateTemplateDTO, TemplateResponse, TemplateStatus,
} from '../types/templateTypes';

export const templateApi = {
  list: async (params?: { status?: TemplateStatus; category?: string }): Promise<TemplateResponse[]> => {
    return apiClient.get<TemplateResponse[]>('templates', { params });
  },

  getById: async (id: string): Promise<TemplateResponse> => {
    return apiClient.get<TemplateResponse>(`templates/${id}`);
  },

  create: async (dto: CreateTemplateDTO): Promise<TemplateResponse> => {
    return apiClient.post<TemplateResponse>('templates', dto);
  },

  update: async (id: string, dto: UpdateTemplateDTO): Promise<TemplateResponse> => {
    return apiClient.patch<TemplateResponse>(`templates/${id}`, dto);
  },

  publish: async (id: string): Promise<TemplateResponse> => {
    // Status transition on an existing resource → PATCH.
    return apiClient.patch<TemplateResponse>(`templates/${id}/publish`, {});
  },

  retire: async (id: string): Promise<TemplateResponse> => {
    // Status transition on an existing resource → PATCH.
    return apiClient.patch<TemplateResponse>(`templates/${id}/retire`, {});
  },

  softDelete: async (id: string): Promise<void> => {
    await apiClient.delete(`templates/${id}`);
  },
};
