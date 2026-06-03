import { apiClient } from '../../../shared/services/apiClient';
import type {
  LetterCreateDTO,
  LetterResponse,
  LetterTemplateResponse,
  LetterUpdateDTO,
  GenerateLetterFromNoteDTO,
} from '../types/correspondenceTypes';

export const correspondenceApi = {
  listLetters: async (params: {
    patientId?: string;
    episodeId?: string;
    status?: string;
  }): Promise<LetterResponse[]> => {
    return apiClient.get('correspondence/letters', { params });
  },

  getLetter: async (id: string): Promise<LetterResponse> => {
    return apiClient.get(`correspondence/letters/${id}`);
  },

  createLetter: async (dto: LetterCreateDTO): Promise<LetterResponse> => {
    return apiClient.post('correspondence/letters', dto);
  },

  updateLetter: async (id: string, dto: LetterUpdateDTO): Promise<LetterResponse> => {
    return apiClient.patch(`correspondence/letters/${id}`, dto);
  },

  deleteLetter: async (id: string): Promise<void> => {
    await apiClient.delete(`correspondence/letters/${id}`);
  },

  listTemplates: async (): Promise<LetterTemplateResponse[]> => {
    return apiClient.get('correspondence/templates');
  },

  generateFromNote: async (
    dto: GenerateLetterFromNoteDTO,
  ): Promise<LetterResponse[]> => {
    return apiClient.post(
      'correspondence/generate-from-note',
      dto,
    );
  },

  getNoteContent: async (noteId: string): Promise<{ content: string }> => {
    return apiClient.get(`clinical-notes/${noteId}/content`);
  },
};
