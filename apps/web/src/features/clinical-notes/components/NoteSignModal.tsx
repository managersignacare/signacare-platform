import {
  Dialog, DialogTitle, DialogContent, DialogActions,
  Button, Typography, Box, Divider, CircularProgress, Alert, Checkbox, FormControlLabel,
} from '@mui/material';
import LockIcon from '@mui/icons-material/Lock';
import React, { useEffect, useState } from 'react';
import { useSignNote } from '../hooks/useSignNote';
import type { NoteResponse } from '../types/noteTypes';
import { SignacareApiError } from '../../../shared/services/apiClient';
import { canSignAiDraftNote, requiresAiDraftSignAttestation } from '../../../shared/utils/aiDraftSignAttestation';

interface Props {
  open:      boolean;
  note:      NoteResponse | null;
  onClose:   () => void;
  onSigned?: () => void;
}

export const NoteSignModal: React.FC<Props> = ({ open, note, onClose, onSigned }) => {
  const { mutate: signNote, isPending, isError, reset } = useSignNote();
  const [reviewedAndAdopted, setReviewedAndAdopted] = useState(false);
  const [errorMessage, setErrorMessage] = useState('Failed to sign note. Please try again.');

  const requiresAttestation = requiresAiDraftSignAttestation(note?.isAiDraft === true);
  const canSign = canSignAiDraftNote(note?.isAiDraft === true, reviewedAndAdopted);

  useEffect(() => {
    if (!open) return;
    setReviewedAndAdopted(false);
    setErrorMessage('Failed to sign note. Please try again.');
  }, [open, note?.id]);

  const handleSign = () => {
    if (!note) return;
    signNote({
      noteId: note.id,
      reviewedAndAdopted: reviewedAndAdopted || undefined,
    }, {
      onSuccess: () => { reset(); setReviewedAndAdopted(false); onSigned?.(); onClose(); },
      onError: (err) => {
        if (err instanceof SignacareApiError && err.code === 'REVIEW_AND_ADOPT_REQUIRED') {
          setErrorMessage('Please confirm you reviewed and adopted this AI draft before signing.');
          return;
        }
        if (err instanceof SignacareApiError && err.code === 'RECENT_RISK_ASSESSMENT_REQUIRED') {
          setErrorMessage(
            'A recent risk assessment (within 48 hours) is required before signing this first psychiatric note for a new patient.',
          );
          return;
        }
        setErrorMessage('Failed to sign note. Please try again.');
      },
    });
  };

  const handleClose = () => { reset(); setReviewedAndAdopted(false); onClose(); };

  if (!note) return null;

  return (
    <Dialog aria-labelledby="dialog-title" open={open} onClose={handleClose} maxWidth="sm" fullWidth>
      <DialogTitle
        id="dialog-title"
        sx={{
          display: 'flex', alignItems: 'center', gap: 1,
          fontWeight: 700, fontFamily: 'Albert Sans, sans-serif', color: '#3D484B',
        }}
      >
        <LockIcon sx={{ color: '#327C8D' }} />
        Sign Clinical Note
      </DialogTitle>

      <DialogContent>
        {isError && (
          <Alert role="alert" severity="error" sx={{ mb: 2 }}>
            {errorMessage}
          </Alert>
        )}
        <Alert role="alert" severity="warning" sx={{ mb: 2 }}>
          Once signed this note is locked. Use <strong>Amend</strong> to add corrections —
          the original is preserved in full for audit purposes.
        </Alert>

        <Box sx={{ backgroundColor: '#FBF8F5', borderRadius: 2, p: 2 }}>
          <Typography variant="overline" color="text.secondary">Note Summary</Typography>
          <Divider sx={{ my: 1 }} />
          <Typography variant="body2"><strong>Type:</strong> {note.noteType.toUpperCase()}</Typography>
          <Typography variant="body2">
            <strong>Date:</strong>{' '}
            {new Date(note.noteDateTime).toLocaleDateString('en-AU', {
              weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
            })}
          </Typography>
          <Typography variant="body2"><strong>Author:</strong> {note.authorName}</Typography>
          {note.isAiDraft && (
            <Alert role="alert" severity="warning" sx={{ mt: 1 }}>
              This is an AI-generated draft. Confirm you have reviewed all fields.
            </Alert>
          )}
          {requiresAttestation && (
            <FormControlLabel
              sx={{ mt: 1 }}
              control={(
                <Checkbox
                  checked={reviewedAndAdopted}
                  onChange={(_, checked) => setReviewedAndAdopted(checked)}
                />
              )}
              label="I have reviewed this AI-drafted note and adopt it as clinically accurate."
            />
          )}
          {note.soapAssessment && (
            <>
              <Divider sx={{ my: 1 }} />
              <Typography variant="overline" color="text.secondary">Assessment</Typography>
              <Typography variant="body2" sx={{ mt: 0.5, whiteSpace: 'pre-wrap' }}>
                {note.soapAssessment.slice(0, 300)}{note.soapAssessment.length > 300 ? '…' : ''}
              </Typography>
            </>
          )}
          {note.soapPlan && (
            <>
              <Divider sx={{ my: 1 }} />
              <Typography variant="overline" color="text.secondary">Plan</Typography>
              <Typography variant="body2" sx={{ mt: 0.5, whiteSpace: 'pre-wrap' }}>
                {note.soapPlan.slice(0, 300)}{note.soapPlan.length > 300 ? '…' : ''}
              </Typography>
            </>
          )}
        </Box>
      </DialogContent>

      <DialogActions sx={{ px: 3, pb: 2 }}>
        <Button onClick={handleClose} color="inherit" disabled={isPending}>
          Cancel
        </Button>
        <Button
          variant="contained"
          onClick={handleSign}
          disabled={isPending || !canSign}
          startIcon={isPending ? <CircularProgress role="progressbar" aria-label="Loading" size={16} color="inherit" /> : <LockIcon />}
          sx={{ backgroundColor: '#327C8D', fontFamily: 'Albert Sans, sans-serif' }}
        >
          {isPending ? 'Signing…' : 'Sign Note'}
        </Button>
      </DialogActions>
    </Dialog>
  );
};
