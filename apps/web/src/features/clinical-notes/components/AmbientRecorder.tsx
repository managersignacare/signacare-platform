import React, { useRef, useState, useCallback } from 'react';
import {
  Box, Button, Typography, CircularProgress, Alert, Chip,
  Dialog, DialogTitle, DialogContent, DialogActions,
} from '@mui/material';
import MicIcon from '@mui/icons-material/Mic';
import StopIcon from '@mui/icons-material/Stop';
import { useAmbientNote } from '../hooks/useAmbientNote';
import type { LLMSoapResponse } from '../../../shared/types/llmTypes';
import { createAmbientRecordingConsent } from '../../../shared/services/scribeConsentApi';

type RecorderState = 'idle' | 'consent' | 'recording' | 'generating' | 'done';

interface Props {
  patientId: string;
  onDraftReady: (draft: LLMSoapResponse) => void;
}

export const AmbientRecorder: React.FC<Props> = ({ patientId, onDraftReady }) => {
  const [recState, setRecState]        = useState<RecorderState>('idle');
  const [consentGiven, setConsentGiven] = useState(false);
  const [mediaError, setMediaError]    = useState<string | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef   = useRef<Blob[]>([]);
  const consentIdRef = useRef<string | null>(null);

  const { generateDraft, isGenerating, error, draft } = useAmbientNote();

  React.useEffect(() => {
    if (draft) { setRecState('done'); onDraftReady(draft); }
  }, [draft, onDraftReady]);

  React.useEffect(() => {
    if (isGenerating) setRecState('generating');
  }, [isGenerating]);

  const startRecording = useCallback(async (consentId: string) => {
    setMediaError(null);
    try {
      const stream   = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recorder = new MediaRecorder(stream);
      consentIdRef.current = consentId;
      chunksRef.current = [];
      recorder.ondataavailable = (e) => { if (e.data.size > 0) chunksRef.current.push(e.data); };
      recorder.onstop = () => {
        stream.getTracks().forEach((t) => t.stop());
        const blob = new Blob(chunksRef.current, { type: 'audio/webm' });
        if (!consentIdRef.current) {
          setMediaError('Recording consent is missing. Please try again.');
          return;
        }
        generateDraft({ audioBlob: blob, patientId, consentId: consentIdRef.current });
        consentIdRef.current = null;
      };
      recorder.start();
      recorderRef.current = recorder;
      setRecState('recording');
    } catch {
      setMediaError('Microphone access denied. Please allow microphone permission and try again.');
      setRecState('idle');
    }
  }, [generateDraft, patientId]);

  const startWithFreshConsent = useCallback(async () => {
    if (!patientId) {
      setMediaError('Cannot start ambient recording without a patient context.');
      setRecState('idle');
      return;
    }
    try {
      const consentId = await createAmbientRecordingConsent(patientId, {
        clinicianAttestationText: 'Patient verbally consented to ambient recording for clinical documentation.',
      });
      await startRecording(consentId);
    } catch (err) {
      setMediaError(err instanceof Error ? err.message : 'Failed to capture recording consent.');
      setRecState('idle');
    }
  }, [patientId, startRecording]);

  const stopRecording = useCallback(() => {
    recorderRef.current?.stop();
  }, []);

  const handleBeginClick = () => {
    if (!consentGiven) { setRecState('consent'); } else { void startWithFreshConsent(); }
  };

  const handleConsent = () => {
    setConsentGiven(true);
    setRecState('idle');
    void startWithFreshConsent();
  };

  return (
    <Box>
      {mediaError && (
        <Alert role="alert" severity="error" sx={{ mb: 1 }} onClose={() => setMediaError(null)}>
          {mediaError}
        </Alert>
      )}
      {error && (
        <Alert role="alert" severity="error" sx={{ mb: 1 }}>
          Draft generation failed. Please enter the note manually.
        </Alert>
      )}

      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
        {(recState === 'idle' || recState === 'done') && (
          <Button
            variant="outlined"
            startIcon={<MicIcon />}
            onClick={handleBeginClick}
            size="small"
            sx={{ borderColor: '#327C8D', color: '#327C8D', fontFamily: 'Albert Sans, sans-serif' }}
          >
            {recState === 'done' ? 'Record Again' : 'Ambient Record'}
          </Button>
        )}

        {recState === 'recording' && (
          <Button
            variant="contained"
            startIcon={<StopIcon />}
            onClick={stopRecording}
            size="small"
            sx={{
              backgroundColor: '#D32F2F',
              fontFamily: 'Albert Sans, sans-serif',
              animation: 'signacareRecPulse 1.2s ease-in-out infinite',
              '@keyframes signacareRecPulse': {
                '0%':   { boxShadow: '0 0 0 0 rgba(211,47,47,0.55)' },
                '70%':  { boxShadow: '0 0 0 9px rgba(211,47,47,0)' },
                '100%': { boxShadow: '0 0 0 0 rgba(211,47,47,0)' },
              },
            }}
          >
            Stop Recording
          </Button>
        )}

        {recState === 'generating' && (
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <CircularProgress role="progressbar" aria-label="Loading" size={18} sx={{ color: '#327C8D' }} />
            <Typography variant="body2" color="text.secondary" sx={{ fontFamily: 'Albert Sans, sans-serif' }}>
              Generating draft…
            </Typography>
          </Box>
        )}

        {recState === 'recording' && (
          <Chip
            label="● REC"
            size="small"
            sx={{ backgroundColor: '#FFEBEE', color: '#D32F2F', fontWeight: 700 }}
          />
        )}
        {recState === 'done' && (
          <Chip label="Draft ready" size="small" color="success" variant="outlined" />
        )}
      </Box>

      <Dialog aria-labelledby="dialog-title" open={recState === 'consent'} onClose={() => setRecState('idle')} maxWidth="sm" fullWidth>
        <DialogTitle id="dialog-title" sx={{ fontWeight: 700, color: '#3D484B', fontFamily: 'Albert Sans, sans-serif' }}>
          Ambient Recording — Consent Required
        </DialogTitle>
        <DialogContent>
          <Alert severity="info" sx={{ mb: 2 }}>
            <Typography variant="subtitle2" fontWeight={700} gutterBottom>
              Before recording, confirm the following:
            </Typography>
            <Box component="ul" sx={{ pl: 2, m: 0 }}>
              {[
                'The patient has been verbally informed that this consultation may be recorded for documentation purposes.',
                'The patient has given explicit verbal consent to the recording.',
                'Only clinical consultation content will be captured — no administrative or personally sensitive content outside the session.',
                'The AI-generated draft will be reviewed and verified by you before it is saved or signed.',
                'Audio is processed entirely on-premises. No data leaves this facility.',
              ].map((item) => (
                <Typography key={item} component="li" variant="body2" sx={{ mb: 0.5 }}>
                  {item}
                </Typography>
              ))}
            </Box>
          </Alert>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setRecState('idle')} color="inherit">
            Cancel
          </Button>
          <Button
            onClick={handleConsent}
            variant="contained"
            sx={{ backgroundColor: '#327C8D', fontFamily: 'Albert Sans, sans-serif' }}
          >
            Consent Confirmed – Start Recording
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
};
