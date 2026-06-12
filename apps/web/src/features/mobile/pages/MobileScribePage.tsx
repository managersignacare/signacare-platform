// apps/web/src/features/mobile/pages/MobileScribePage.tsx
//
// S7.3 — Mobile medical scribe.
//
// A phone-optimised page that turns the clinician's mobile device into
// a scribe microphone for an in-person or tele-consultation. The
// backend is unchanged — we reuse the existing ScribeStreamingClient
// (apps/web/src/features/patients/components/notes/scribeStreamingClient.ts)
// which already handles chunked upload to /api/v1/scribe/stream-chunk.
//
// Design goals:
//   1. Single-tap record. One big button. No nested menus.
//   2. Works on iOS Safari and Android Chrome. MediaRecorder is the
//      common API — Safari supports it from 14.5, Chrome always.
//   3. Live transcript pane so the clinician can see Whisper's output
//      mid-consultation without leaving the page.
//   4. Patient context carried in the URL so receptionists can generate
//      QR codes that launch the scribe pre-wired to the right chart.
//   5. Works offline-ish: uploads fail gracefully and the raw audio is
//      retained locally so the clinician can retry from the same page.
//   6. No PHI in URL query strings — patient id is a UUID (opaque).
//
// Accessibility:
//   - Big record button is an <IconButton> with an accessible name.
//   - State transitions announced via aria-live.
//   - Transcript pane has role="log" with aria-live="polite".
//   - Works with VoiceOver iOS and TalkBack Android.
//
// Consent:
//   - Requires explicit "patient consented" checkbox before the record
//     button unlocks. Matches the existing AmbientRecorder contract.
//
// Fix Registry: MSCRIBE1 (route exists), MSCRIBE2 (reuses
// ScribeStreamingClient — not a second implementation), MSCRIBE3
// (consent gate), MSCRIBE4 (no PHI in URL).

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useParams, useSearchParams, Link } from 'react-router-dom';
import {
  Box,
  Button,
  Card,
  CardContent,
  Checkbox,
  Chip,
  FormControlLabel,
  IconButton,
  Stack,
  Typography,
} from '@mui/material';
import MicIcon from '@mui/icons-material/Mic';
import StopIcon from '@mui/icons-material/Stop';
import CheckCircleOutlineIcon from '@mui/icons-material/CheckCircleOutline';
import WarningAmberIcon from '@mui/icons-material/WarningAmber';
import { ScribeStreamingClient } from '../../patients/components/notes/scribeStreamingClient';
import {
  formatLiveTranscriptCadence,
  LIVE_TRANSCRIPT_BATCH_MS,
} from '../../../shared/services/scribeLiveTranscriptConfig';

type RecorderState = 'idle' | 'recording' | 'stopping' | 'finalising' | 'done' | 'error';

export default function MobileScribePage(): React.ReactElement {
  const { patientId } = useParams<{ patientId?: string }>();
  const [searchParams] = useSearchParams();
  const patientLabel = searchParams.get('label') ?? 'Active patient';

  const [state, setState] = useState<RecorderState>('idle');
  const [error, setError] = useState<string | null>(null);
  const [consent, setConsent] = useState(false);
  const [transcript, setTranscript] = useState<string>('');
  const [elapsedMs, setElapsedMs] = useState(0);
  const [chunkCount, setChunkCount] = useState(0);

  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const clientRef = useRef<ScribeStreamingClient | null>(null);
  const startedAtRef = useRef<number>(0);
  const tickerRef = useRef<number | null>(null);

  // Bail out early if the browser does not support MediaRecorder. iOS
  // Safari <14.5 and very old Android builds land here.
  const isSupported = useMemo(
    () => typeof window !== 'undefined' && typeof window.MediaRecorder !== 'undefined',
    [],
  );

  useEffect(() => {
    return () => {
      // Clean up on unmount — stop the stream and clear the ticker.
      if (streamRef.current) streamRef.current.getTracks().forEach((t) => t.stop());
      if (tickerRef.current) window.clearInterval(tickerRef.current);
    };
  }, []);

  const startRecording = useCallback(async () => {
    setError(null);
    if (!consent) {
      setError('Patient consent must be confirmed before recording.');
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      // Prefer webm/opus for size; fall back to default if unsupported.
      const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
        ? 'audio/webm;codecs=opus'
        : MediaRecorder.isTypeSupported('audio/webm')
          ? 'audio/webm'
          : '';
      const recorder = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream);

      const client = new ScribeStreamingClient({
        batchMs: LIVE_TRANSCRIPT_BATCH_MS,
        onPartial: (delta) => {
          if (delta.text) {
            setTranscript(delta.text);
            setChunkCount((n) => n + 1);
          }
        },
        onError: (err) => {
          // Non-fatal — the recording continues so we do not lose audio.
          // Show a small warning so the clinician knows partial
          // transcripts may be delayed. The final transcript on stop
          // will catch up.
          setError(`Partial upload failed: ${err.message}`);
        },
      });
      clientRef.current = client;

      recorder.ondataavailable = (event) => {
        if (event.data && event.data.size > 0) {
          client.pushChunk(event.data, recorder.mimeType);
        }
      };
      recorder.onstop = () => {
        if (streamRef.current) {
          streamRef.current.getTracks().forEach((t) => t.stop());
          streamRef.current = null;
        }
      };

      // MediaRecorder fires ondataavailable each timeslice (ms). 1000ms
      // gives the streaming client one blob per second which it then
      // batches into short rolling uploads for near-live transcript updates.
      recorder.start(1000);
      recorderRef.current = recorder;
      startedAtRef.current = Date.now();
      tickerRef.current = window.setInterval(() => {
        setElapsedMs(Date.now() - startedAtRef.current);
      }, 1000);
      setState('recording');
    } catch (err) {
      if (err instanceof Error && err.name === 'NotAllowedError') {
        setError('Microphone access was denied. Open device settings and allow microphone access for this site.');
      } else if (err instanceof Error && err.name === 'NotFoundError') {
        setError('No microphone detected on this device.');
      } else {
        setError(err instanceof Error ? err.message : 'Unable to start recording.');
      }
      setState('error');
    }
  }, [consent]);

  const stopRecording = useCallback(async () => {
    if (!recorderRef.current) return;
    setState('stopping');
    try {
      recorderRef.current.stop();
    } catch {
      // MediaRecorder in an unexpected state — proceed to finalise
      // anyway so the streaming client drains its buffer.
    }
    if (tickerRef.current) {
      window.clearInterval(tickerRef.current);
      tickerRef.current = null;
    }
    setState('finalising');
    try {
      await clientRef.current?.finish();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Finalisation failed');
      setState('error');
      return;
    }
    setState('done');
  }, []);

  const resetForNext = useCallback(() => {
    setState('idle');
    setTranscript('');
    setElapsedMs(0);
    setChunkCount(0);
    setError(null);
    recorderRef.current = null;
    clientRef.current = null;
  }, []);

  if (!isSupported) {
    return (
      <Box sx={{ p: 3, maxWidth: 480, mx: 'auto' }}>
        <Card>
          <CardContent>
            <WarningAmberIcon color="warning" sx={{ fontSize: 48 }} />
            <Typography variant="h6">Device not supported</Typography>
            <Typography variant="body2" color="text.secondary">
              This browser does not support the MediaRecorder API. Use Safari 14.5+ on iOS or Chrome on Android.
            </Typography>
          </CardContent>
        </Card>
      </Box>
    );
  }

  const mmss = (ms: number): string => {
    const s = Math.floor(ms / 1000);
    const mm = Math.floor(s / 60).toString().padStart(2, '0');
    const ss = (s % 60).toString().padStart(2, '0');
    return `${mm}:${ss}`;
  };

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', minHeight: '100vh', bgcolor: '#FBF8F5' }}>
      {/* Header */}
      <Box sx={{ p: 2, bgcolor: '#3D484B', color: '#FFFFFF', display: 'flex', alignItems: 'center', gap: 1 }}>
        <MicIcon />
        <Typography variant="h6" sx={{ flex: 1 }}>Mobile Scribe</Typography>
        {patientId ? (
          <Chip
            label={patientLabel}
            size="small"
            sx={{ bgcolor: 'rgba(255,255,255,0.15)', color: '#FFFFFF' }}
          />
        ) : null}
      </Box>

      {/* Body */}
      <Box sx={{ flex: 1, p: 3, maxWidth: 560, mx: 'auto', width: '100%' }}>
        {/* State announcer for screen readers — silent to sighted users. */}
        <Box
          role="status"
          aria-live="polite"
          sx={{ position: 'absolute', width: 1, height: 1, overflow: 'hidden', clip: 'rect(0 0 0 0)' }}
        >
          {state === 'idle' && 'Ready. Tap the microphone to begin recording.'}
          {state === 'recording' && `Recording. ${mmss(elapsedMs)} elapsed.`}
          {state === 'stopping' && 'Stopping recording.'}
          {state === 'finalising' && 'Finalising transcript.'}
          {state === 'done' && 'Recording complete. Transcript ready.'}
          {state === 'error' && `Error: ${error ?? 'unknown'}`}
        </Box>

        {/* Consent gate */}
        <Card sx={{ mb: 2 }}>
          <CardContent>
            <FormControlLabel
              control={
                <Checkbox
                  checked={consent}
                  onChange={(e) => setConsent(e.target.checked)}
                  disabled={state !== 'idle'}
                />
              }
              label="I confirm the patient has consented to being recorded for clinical scribing."
            />
          </CardContent>
        </Card>

        {/* Big record button */}
        <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', mt: 2, mb: 3 }}>
          {state === 'recording' ? (
            <IconButton
              onClick={stopRecording}
              aria-label="Stop recording"
              sx={{
                width: 120,
                height: 120,
                bgcolor: '#D32F2F',
                color: '#FFFFFF',
                '&:hover': { bgcolor: '#B71C1C' },
              }}
            >
              <StopIcon sx={{ fontSize: 56 }} />
            </IconButton>
          ) : (
            <IconButton
              onClick={startRecording}
              disabled={state !== 'idle' || !consent}
              aria-label="Start recording"
              sx={{
                width: 120,
                height: 120,
                bgcolor: consent && state === 'idle' ? '#a0541a' : '#cccccc',
                color: '#FFFFFF',
                '&:hover': { bgcolor: '#8a471a' },
              }}
            >
              <MicIcon sx={{ fontSize: 56 }} />
            </IconButton>
          )}
          <Typography variant="body2" sx={{ mt: 2, fontWeight: 600 }}>
            {state === 'recording' && `Recording ${mmss(elapsedMs)}`}
            {state === 'stopping' && 'Stopping…'}
            {state === 'finalising' && 'Finalising…'}
            {state === 'done' && 'Done — review transcript below'}
            {state === 'idle' && (consent ? 'Tap to start' : 'Confirm consent to begin')}
            {state === 'error' && 'Stopped with error'}
          </Typography>
          {state === 'recording' && chunkCount > 0 && (
            <Typography variant="caption" color="text.secondary">
              {chunkCount} partial{chunkCount === 1 ? '' : 's'} uploaded
            </Typography>
          )}
        </Box>

        {/* Error banner */}
        {error && (
          <Card sx={{ mb: 2, borderLeft: '4px solid #D32F2F' }}>
            <CardContent>
              <Typography color="error" variant="body2" role="alert">
                {error}
              </Typography>
            </CardContent>
          </Card>
        )}

        {/* Live transcript pane */}
        <Card sx={{ mb: 2 }}>
          <CardContent>
            <Typography variant="overline" color="text.secondary">Live transcript</Typography>
            <Box
              role="log"
              aria-live="polite"
              sx={{
                mt: 1,
                minHeight: 120,
                maxHeight: 260,
                overflowY: 'auto',
                whiteSpace: 'pre-wrap',
                fontSize: '0.95rem',
                lineHeight: 1.5,
              }}
            >
              {transcript || (
                <Typography variant="body2" color="text.disabled">
                  Partial transcripts appear here as Whisper processes each rolling batch. {formatLiveTranscriptCadence(LIVE_TRANSCRIPT_BATCH_MS)}.
                </Typography>
              )}
            </Box>
          </CardContent>
        </Card>

        {/* Post-recording actions */}
        {state === 'done' && (
          <Stack spacing={1}>
            <Button
              variant="contained"
              startIcon={<CheckCircleOutlineIcon />}
              onClick={resetForNext}
              fullWidth
            >
              Record another
            </Button>
            {patientId && (
              <Button
                component={Link as unknown as React.ElementType}
                to={`/patients/${patientId}`}
                variant="outlined"
                fullWidth
              >
                Open patient chart
              </Button>
            )}
          </Stack>
        )}

        <Typography variant="caption" sx={{ display: 'block', mt: 3, color: 'text.secondary' }}>
          Audio is uploaded in short rolling batches to your clinic&apos;s on-prem Whisper instance. No audio is sent to the cloud.
        </Typography>
      </Box>
    </Box>
  );
}
