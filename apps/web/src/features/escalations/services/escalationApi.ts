import { apiClient } from '../../../shared/services/apiClient';
import type {
  CreateEscalationDTO,
  UpdateEscalationDTO,
  EscalationResponse,
  EscalationStatus,
  EscalationPriority,
} from '../types/escalationTypes';

export const escalationApi = {
  list: async (params?: {
    patientId?:  string;
    status?:     EscalationStatus;
    priority?:   EscalationPriority;
    episodeId?:  string;
  }): Promise<EscalationResponse[]> => {
    return apiClient.get<EscalationResponse[]>('escalations', { params });
  },

  getById: async (id: string): Promise<EscalationResponse> => {
    return apiClient.get<EscalationResponse>(`escalations/${id}`);
  },

  create: async (dto: CreateEscalationDTO): Promise<EscalationResponse> => {
    return apiClient.post<EscalationResponse>('escalations', dto);
  },

  // BUG-PR-R1-12-FIX-S1-escalations — REQUIRED expectedLockVersion. The
  // UpdateEscalationDTO type now carries the field; callers MUST read
  // `lockVersion` from the cached EscalationResponse and echo it back.
  update: async (id: string, dto: UpdateEscalationDTO): Promise<EscalationResponse> => {
    return apiClient.patch<EscalationResponse>(`escalations/${id}`, dto);
  },

  acknowledge: async (id: string): Promise<EscalationResponse> => {
    return apiClient.post<EscalationResponse>(`escalations/${id}/acknowledge`, {});
  },

  // BUG-PR-R1-12-FIX-S1-escalations — REQUIRED expectedLockVersion on resolve.
  resolve: async (id: string, notes: string, expectedLockVersion: number): Promise<EscalationResponse> => {
    return apiClient.post<EscalationResponse>(`escalations/${id}/resolve`, {
      expectedLockVersion,
      notes,
    });
  },

  listByPatient: async (patientId: string, episodeId?: string): Promise<EscalationResponse[]> => {
    return apiClient.get<EscalationResponse[]>('escalations', {
      params: { patientId, episodeId },
    });
  },

  // BUG-PR-R1-12-FIX-S1-escalations — REQUIRED expectedLockVersion on addNote.
  addNote: async (id: string, notes: string, expectedLockVersion: number): Promise<EscalationResponse> => {
    return apiClient.post<EscalationResponse>(`escalations/${id}/notes`, {
      expectedLockVersion,
      notes,
    });
  },

  softDelete: async (id: string): Promise<void> => {
    await apiClient.delete(`escalations/${id}`);
  },
};
