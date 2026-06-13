import { apiClient } from '../../../shared/services/apiClient';
import type {
  CreateTemplateDTO, UpdateTemplateDTO, TemplateResponse, TemplateStatus,
} from '../types/templateTypes';

export interface TemplateCategoryResponse {
  id: string;
  clinicId: string;
  name: string;
  isActive: boolean;
  sortOrder: number;
  createdAt: string;
  updatedAt: string | null;
}

export const templateApi = {
  listCategories: async (): Promise<TemplateCategoryResponse[]> => {
    const response = await apiClient.get<{ categories: TemplateCategoryResponse[] }>('templates/categories');
    return response.categories;
  },

  createCategory: async (dto: { name: string }): Promise<TemplateCategoryResponse> => {
    const response = await apiClient.post<{ category: TemplateCategoryResponse }>('templates/categories', dto);
    return response.category;
  },

  updateCategory: async (
    id: string,
    dto: { name?: string; isActive?: boolean; sortOrder?: number },
  ): Promise<TemplateCategoryResponse> => {
    const response = await apiClient.patch<{ category: TemplateCategoryResponse }>(`templates/categories/${id}`, dto);
    return response.category;
  },

  deleteCategory: async (id: string): Promise<void> => {
    await apiClient.delete(`templates/categories/${id}`);
  },

  list: async (params?: { status?: TemplateStatus; category?: string; q?: string }): Promise<TemplateResponse[]> => {
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
