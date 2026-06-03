import { apiClient } from '../../../shared/services/apiClient';
import type { CreateNoteDTO, UpdateNoteDTO, NoteResponse } from '../types/noteTypes';

export interface SignNoteDTO {
  reviewedAndAdopted?: boolean;
}

export const clinicalNotesApi = {
  listByPatient: async (
    patientId: string,
    episodeId?: string,
  ): Promise<NoteResponse[]> => {
    const params = episodeId ? { episodeId } : {};
    return apiClient.get<NoteResponse[]>(
      `clinical-notes/patient/${patientId}`,
      { params },
    );
  },

  getById: async (id: string): Promise<NoteResponse> => {
    return apiClient.get<NoteResponse>(`clinical-notes/${id}`);
  },

  create: async (dto: CreateNoteDTO): Promise<NoteResponse> => {
    return apiClient.post<NoteResponse>('clinical-notes', dto);
  },

  update: async (id: string, dto: UpdateNoteDTO): Promise<NoteResponse> => {
    return apiClient.patch<NoteResponse>(`clinical-notes/${id}`, dto);
  },

  sign: async (id: string, dto: SignNoteDTO = {}): Promise<NoteResponse> => {
    return apiClient.post<NoteResponse>(`clinical-notes/${id}/sign`, dto);
  },

  amend: async (id: string, dto: CreateNoteDTO): Promise<NoteResponse> => {
    return apiClient.post<NoteResponse>(
      `clinical-notes/${id}/amend`,
      dto,
    );
  },

  softDelete: async (id: string): Promise<void> => {
    await apiClient.delete(`clinical-notes/${id}`);
  },
};
