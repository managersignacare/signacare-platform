import { useMutation, useQueryClient } from '@tanstack/react-query';
import { clinicalNotesApi } from '../services/clinicalNotesApi';
import { clinicalNotesKeys } from '../queryKeys';

interface SignNoteInput {
  noteId: string;
  reviewedAndAdopted?: boolean;
}

export const useSignNote = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ noteId, reviewedAndAdopted }: SignNoteInput) =>
      clinicalNotesApi.sign(noteId, { reviewedAndAdopted }),
    onSuccess: (note) => {
      void qc.invalidateQueries({ queryKey: clinicalNotesKeys.patientAll(note.patientId) });
      void qc.invalidateQueries({ queryKey: clinicalNotesKeys.detail(note.id) });
    },
  });
};
