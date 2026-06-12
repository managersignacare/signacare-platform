import { apiClient } from '../../../shared/services/apiClient';
import type {
  CreateTaskDTO,
  TaskResponseView as TaskResponse,
  UpdateTaskDTO,
} from '../types/taskTypes';
import type { TaskMonitoringSummary } from '@signacare/shared';

export const taskApi = {
  list: async (params: {
    patientId?: string;
    assignedToId?: string;
    status?: string;
    priority?: string;
    teamId?: string;
    teamScope?: 'mine';
    dueBucket?: 'overdue' | 'today' | 'next_7_days' | 'undated';
    ownership?: 'assigned' | 'unassigned';
  }): Promise<TaskResponse[]> => {
    return apiClient.get('tasks', params);
  },

  summary: async (params: {
    assignedToId?: string;
    teamId?: string;
    teamScope?: 'mine';
    status?: string;
    priority?: string;
    dueBucket?: 'overdue' | 'today' | 'next_7_days' | 'undated';
    ownership?: 'assigned' | 'unassigned';
  }): Promise<TaskMonitoringSummary> => {
    return apiClient.get('tasks/summary', params);
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
