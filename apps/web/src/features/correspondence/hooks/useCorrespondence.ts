import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { correspondenceApi } from '../services/correspondenceApi';
import { correspondenceKeys } from '../queryKeys';
import type {
  GenerateLetterFromNoteDTO,
  LetterCreateDTO,
  LetterUpdateDTO,
} from '../types/correspondenceTypes';

export const useLetters = (params: {
  patientId?: string;
  episodeId?: string;
  status?: string;
}) =>
  useQuery({
    queryKey: correspondenceKeys.lettersList(params),
    queryFn: () => correspondenceApi.listLetters(params),
  });

export const useLetter = (id: string) =>
  useQuery({
    queryKey: correspondenceKeys.letter(id),
    queryFn: () => correspondenceApi.getLetter(id),
    enabled: !!id,
  });

export const useLetterTemplates = () =>
  useQuery({
    queryKey: correspondenceKeys.templates(),
    queryFn: () => correspondenceApi.listTemplates(),
    staleTime: 5 * 60 * 1000,
  });

export const useNoteContent = (noteId: string | undefined) =>
  useQuery({
    queryKey: correspondenceKeys.clinicalNotesContent(noteId),
    queryFn: () => correspondenceApi.getNoteContent(noteId!),
    enabled: !!noteId,
  });

export const useCreateLetter = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (dto: LetterCreateDTO) => correspondenceApi.createLetter(dto),
    onSuccess: () => qc.invalidateQueries({ queryKey: correspondenceKeys.all }),
  });
};

export const useUpdateLetter = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, dto }: { id: string; dto: LetterUpdateDTO }) =>
      correspondenceApi.updateLetter(id, dto),
    onSuccess: () => qc.invalidateQueries({ queryKey: correspondenceKeys.all }),
  });
};

export const useDeleteLetter = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => correspondenceApi.deleteLetter(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: correspondenceKeys.all }),
  });
};

export const useGenerateFromNote = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (dto: GenerateLetterFromNoteDTO) =>
      correspondenceApi.generateFromNote(dto),
    onSuccess: () => qc.invalidateQueries({ queryKey: correspondenceKeys.all }),
  });
};
