import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { clinicalNotesApi } from '../services/clinicalNotesApi';
import { clinicalNotesKeys } from '../queryKeys';
import type { CreateNoteDTO, UpdateNoteDTO } from '../types/noteTypes';

export const useClinicalNotes = (patientId: string, episodeId?: string) =>
  useQuery({
    queryKey: clinicalNotesKeys.patient(patientId, episodeId ?? null),
    queryFn:  () => clinicalNotesApi.listByPatient(patientId, episodeId),
    enabled:  !!patientId,
  });

export const useNote = (id: string) =>
  useQuery({
    queryKey: clinicalNotesKeys.detail(id),
    queryFn:  () => clinicalNotesApi.getById(id),
    enabled:  !!id,
  });

export const useCreateNote = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (dto: CreateNoteDTO) => clinicalNotesApi.create(dto),
    onSuccess: (note) => {
      void qc.invalidateQueries({ queryKey: clinicalNotesKeys.patientAll(note.patientId) });
    },
  });
};

export const useUpdateNote = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, dto }: { id: string; dto: UpdateNoteDTO }) =>
      clinicalNotesApi.update(id, dto),
    onSuccess: (note) => {
      void qc.invalidateQueries({ queryKey: clinicalNotesKeys.patientAll(note.patientId) });
      void qc.invalidateQueries({ queryKey: clinicalNotesKeys.detail(note.id) });
    },
  });
};

export const useDeleteNote = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => clinicalNotesApi.softDelete(id),
    onSuccess: () => void qc.invalidateQueries({ queryKey: clinicalNotesKeys.all }),
  });
};
