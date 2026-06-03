import React, { useState, useEffect } from 'react';
import {
  Dialog, DialogTitle, DialogContent, DialogActions,
  Button, Alert, CircularProgress,
} from '@mui/material';
import EditNoteIcon from '@mui/icons-material/EditNote';
import { NoteEditor } from './NoteEditor';
import { useCreateNote } from '../hooks/useClinicalNotes';
import type { NoteResponse, SoapContent } from '../types/noteTypes';

interface Props {
  open:          boolean;
  originalNote:  NoteResponse | null;
  onClose:       () => void;
  onAmended?:    () => void;
}

export const NoteAmendModal: React.FC<Props> = ({ open, originalNote, onClose, onAmended }) => {
  const { mutate: createNote, isPending, isError, reset } = useCreateNote();
  const [soap, setSoap] = useState<SoapContent>({
    subjective: '', objective: '', assessment: '', plan: '',
  });

  useEffect(() => {
    if (originalNote) {
      setSoap({
        subjective: originalNote.soapSubjective ?? '',
        objective:  originalNote.soapObjective  ?? '',
        assessment: originalNote.soapAssessment ?? '',
        plan:       originalNote.soapPlan       ?? '',
      });
    }
  }, [originalNote]);

  const handleClose = () => { reset(); onClose(); };

  const handleSubmit = () => {
    if (!originalNote) return;
    createNote(
      {
        patientId:      originalNote.patientId,
        episodeId:      originalNote.episodeId ?? undefined,
        noteType:       originalNote.noteType,
        noteDateTime:   new Date().toISOString(),
        content:        soap.subjective || soap.assessment || '(amendment)',
        soapSubjective: soap.subjective,
        soapObjective:  soap.objective,
        soapAssessment: soap.assessment,
        soapPlan:       soap.plan,
        isAiDraft:      false,
        amendedFromId:  originalNote.id,
      },
      { onSuccess: () => { reset(); onAmended?.(); onClose(); } },
    );
  };

  if (!originalNote) return null;

  return (
    <Dialog aria-labelledby="dialog-title" open={open} onClose={handleClose} maxWidth="md" fullWidth>
      <DialogTitle
        id="dialog-title"
        sx={{
          display: 'flex', alignItems: 'center', gap: 1,
          fontWeight: 700, fontFamily: 'Albert Sans, sans-serif', color: '#3D484B',
        }}
      >
        <EditNoteIcon sx={{ color: '#F0852C' }} />
        Amend Clinical Note
      </DialogTitle>

      <DialogContent>
        {isError && (
          <Alert role="alert" severity="error" sx={{ mb: 2 }}>
            Failed to save amendment. Please try again.
          </Alert>
        )}
        <Alert severity="info" sx={{ mb: 2 }}>
          A new amendment note will be created and linked to the original note dated{' '}
          <strong>{new Date(originalNote.noteDateTime).toLocaleDateString('en-AU')}</strong>.
          The original signed note remains unchanged in the audit trail.
        </Alert>
        {/* USER-A.3 absorb-1: forward patientId + episodeId so snippet
            macros (Alt+Shift+O/R/M) invoked inside the amend editor
            honour the same episode-scoping contract as the primary
            editor path. Without these, amending a note would re-open
            the cross-episode PHI leak that the original fix closed. */}
        <NoteEditor
          value={soap}
          onChange={setSoap}
          readOnly={isPending}
          patientId={originalNote.patientId}
          episodeId={originalNote.episodeId ?? null}
        />
      </DialogContent>

      <DialogActions sx={{ px: 3, pb: 2 }}>
        <Button onClick={handleClose} color="inherit" disabled={isPending}>
          Cancel
        </Button>
        <Button
          variant="contained"
          onClick={handleSubmit}
          disabled={isPending}
          startIcon={isPending ? <CircularProgress role="progressbar" aria-label="Loading" size={16} color="inherit" /> : <EditNoteIcon />}
          sx={{ backgroundColor: '#F0852C', fontFamily: 'Albert Sans, sans-serif' }}
        >
          {isPending ? 'Saving…' : 'Save Amendment'}
        </Button>
      </DialogActions>
    </Dialog>
  );
};
