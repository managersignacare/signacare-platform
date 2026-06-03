import { apiClient } from '../../../shared/services/apiClient';
import type { CreateTaskDTO, TaskResponseView as TaskResponse, UpdateTaskDTO } from '../types/taskTypes';

export const taskApi = {
  list: async (params: {
    patientId?: string;
    assignedToId?: string;
    status?: string;
    priority?: string;
    teamId?: string;
  }): Promise<TaskResponse[]> => {
    return apiClient.get('tasks', { params });
  },

  getById: async (id: string): Promise<TaskResponse> => {
    return apiClient.get(`tasks/${id}`);
  },

  create: async (dto: CreateTaskDTO): Promise<TaskResponse> => {
    return apiClient.post('tasks', dto);
  },

  update: async (id: string, dto: UpdateTaskDTO): Promise<TaskResponse> => {
    return apiClient.patch(`tasks/${id}`, dto);
  },

  complete: async (id: string): Promise<TaskResponse> => {
    return apiClient.patch(`tasks/${id}`, { status: 'completed' });
  },

  softDelete: async (id: string): Promise<void> => {
    await apiClient.delete(`tasks/${id}`);
  },
};
