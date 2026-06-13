/**
 * Phase 8 UI refactor — recording controls + waveform + live-transcript
 * pane + format/interpreter selectors extracted from AmbientAiRecorder.
 *
 * Pure presentational component. No state of its own; every interaction
 * is delegated through callback props. The colours, sizes, animation
 * keyframes, role attributes, and i18n strings are preserved verbatim
 * from the original god-file so visual + a11y behaviour is unchanged.
 */
import { type RefObject } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
  FormControl,
  IconButton,
  MenuItem,
  Paper,
  Select,
  Tooltip,
  Typography,
} from '@mui/material';
import MicIcon from '@mui/icons-material/Mic';
import StopIcon from '@mui/icons-material/Stop';
import PauseIcon from '@mui/icons-material/Pause';
import PlayArrowIcon from '@mui/icons-material/PlayArrow';
import AutoAwesomeIcon from '@mui/icons-material/AutoAwesome';
import LocalHospitalIcon from '@mui/icons-material/LocalHospital';
import type { AmbientAiJobStatus, AmbientFormat } from '../../../../shared/services/llmAmbientApi';
import { formatLiveTranscriptCadence } from '../../../../shared/services/scribeLiveTranscriptConfig';
import { formatAsyncProgress } from './useAmbientScribeJobRunner';

function formatDuration(s: number): string {
  const mins = Math.floor(s / 60);
  const secs = s % 60;
  return `${mins}:${String(secs).padStart(2, '0')}`;
}

interface AmbientRecorderControlsProps {
  recording: boolean;
  paused: boolean;
  processing: boolean;
  duration: number;
  audioLevel: number;
  asyncJobStatus: AmbientAiJobStatus | null;
  format: AmbientFormat;
  onFormatChange: (next: AmbientFormat) => void;
  interpreterUsed: boolean;
  onInterpreterUsedChange: (next: boolean) => void;
  interpreterLanguage: string;
  onInterpreterLanguageChange: (next: string) => void;
  onPrimaryClick: () => void;
  onPause: () => void;
  onResume: () => void;
  canvasRef: RefObject<HTMLCanvasElement | null>;
  livePartialTranscript: string;
  liveTranscriptEnabled: boolean;
  liveTranscriptBatchMs: number;
}

export function AmbientRecorderControls({
  recording,
  paused,
  processing,
  duration,
  audioLevel,
  asyncJobStatus,
  format,
  onFormatChange,
  interpreterUsed,
  onInterpreterUsedChange,
  interpreterLanguage,
  onInterpreterLanguageChange,
  onPrimaryClick,
  onPause,
  onResume,
  canvasRef,
  livePartialTranscript,
  liveTranscriptEnabled,
  liveTranscriptBatchMs,
}: AmbientRecorderControlsProps) {
  const navigate = useNavigate();
  return (
    <Paper variant="outlined" sx={{ p: 2, borderColor: recording ? '#b8621a' : 'divider', bgcolor: recording ? '#FFF8F0' : '#FBF8F5' }}>
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: recording ? 1.5 : 0 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
          <Button
            size="small"
            variant={recording ? 'contained' : 'outlined'}
            startIcon={recording ? <StopIcon /> : <MicIcon />}
            onClick={onPrimaryClick}
            disabled={processing}
            sx={{
              borderColor: recording ? '#D32F2F' : '#b8621a',
              color: recording ? '#fff' : '#b8621a',
              bgcolor: recording ? '#D32F2F' : 'transparent',
              '&:hover': { bgcolor: recording ? '#B71C1C' : '#FFF3E0' },
              fontSize: 12,
              textTransform: 'none',
              fontWeight: 600,
            }}
          >
            {processing ? 'Processing...' : recording ? `Stop Recording (${formatDuration(duration)})` : 'Start Recording'}
          </Button>

          {/* Drafting entry point — visible alongside Medical Scribe so a
              clinician finishing a recording can open the downstream drafting
              workflow without backtracking to the sidebar / AI Assistant. */}
          {!recording && !processing && (
            <Tooltip title="Open Medical Scribe Drafting — generate follow-up drafts from the captured transcript">
              <Button
                size="small"
                variant="outlined"
                startIcon={<AutoAwesomeIcon />}
                onClick={() => navigate('/agentic-scribe')}
                data-testid="scribe-open-agentic-ai"
                sx={{
                  borderColor: '#7B1FA2',
                  color: '#7B1FA2',
                  '&:hover': { bgcolor: '#F3E5F5', borderColor: '#6A1B9A' },
                  fontSize: 12,
                  textTransform: 'none',
                  fontWeight: 600,
                }}
              >
                Draft Actions
              </Button>
            </Tooltip>
          )}

          {recording && (
            <Tooltip title={paused ? 'Resume' : 'Pause'}>
              <IconButton
                size="small"
                aria-label={paused ? 'Resume recording' : 'Pause recording'}
                onClick={paused ? onResume : onPause}
                sx={{ color: paused ? '#2E7D32' : '#b8621a', border: '1px solid', borderColor: 'divider' }}
              >
                {paused ? <PlayArrowIcon fontSize="small" /> : <PauseIcon fontSize="small" />}
              </IconButton>
            </Tooltip>
          )}

          {recording && (
            <Chip
              icon={<AutoAwesomeIcon sx={{ fontSize: 14 }} />}
              label={paused ? 'Paused' : 'Listening...'}
              size="small"
              sx={{
                bgcolor: paused ? '#E0E0E0' : '#FFF3E0',
                color: paused ? '#666' : '#E65100',
                fontSize: 10,
                fontWeight: 600,
                animation: paused ? 'none' : 'pulse 1.5s infinite',
                '@keyframes pulse': { '0%,100%': { opacity: 1 }, '50%': { opacity: 0.6 } },
              }}
            />
          )}

          {processing && <CircularProgress role="progressbar" aria-label="Loading" size={18} sx={{ color: '#b8621a' }} />}
        </Box>

        {!recording && !processing && (
          <Box sx={{ display: 'flex', gap: 1, alignItems: 'center' }}>
            <Tooltip title="Enable for interpreter-assisted consultations. Audio in other languages will be auto-detected and translated to English.">
              <Chip
                label={interpreterUsed ? `Interpreter (${interpreterLanguage || 'auto'})` : 'Interpreter'}
                size="small"
                variant={interpreterUsed ? 'filled' : 'outlined'}
                onClick={() => onInterpreterUsedChange(!interpreterUsed)}
                sx={{
                  fontSize: 11,
                  height: 28,
                  cursor: 'pointer',
                  bgcolor: interpreterUsed ? '#E3F2FD' : 'transparent',
                  color: interpreterUsed ? '#1565C0' : 'text.secondary',
                  borderColor: interpreterUsed ? '#1565C0' : 'divider',
                  fontWeight: interpreterUsed ? 600 : 400,
                }}
              />
            </Tooltip>
            {interpreterUsed && (
              <FormControl size="small" sx={{ minWidth: 90 }}>
                <Select
                  value={interpreterLanguage}
                  onChange={(e) => onInterpreterLanguageChange(e.target.value)}
                  displayEmpty
                  sx={{ fontSize: 11, height: 28 }}
                >
                  <MenuItem value="" sx={{ fontSize: 12 }}>Auto-detect</MenuItem>
                  <MenuItem value="vi" sx={{ fontSize: 12 }}>Vietnamese</MenuItem>
                  <MenuItem value="zh" sx={{ fontSize: 12 }}>Chinese</MenuItem>
                  <MenuItem value="ar" sx={{ fontSize: 12 }}>Arabic</MenuItem>
                  <MenuItem value="el" sx={{ fontSize: 12 }}>Greek</MenuItem>
                  <MenuItem value="it" sx={{ fontSize: 12 }}>Italian</MenuItem>
                  <MenuItem value="tr" sx={{ fontSize: 12 }}>Turkish</MenuItem>
                  <MenuItem value="ko" sx={{ fontSize: 12 }}>Korean</MenuItem>
                  <MenuItem value="hi" sx={{ fontSize: 12 }}>Hindi</MenuItem>
                  <MenuItem value="ta" sx={{ fontSize: 12 }}>Tamil</MenuItem>
                  <MenuItem value="fil" sx={{ fontSize: 12 }}>Filipino</MenuItem>
                  <MenuItem value="es" sx={{ fontSize: 12 }}>Spanish</MenuItem>
                  <MenuItem value="fa" sx={{ fontSize: 12 }}>Persian/Dari</MenuItem>
                  <MenuItem value="ne" sx={{ fontSize: 12 }}>Nepali</MenuItem>
                  <MenuItem value="pa" sx={{ fontSize: 12 }}>Punjabi</MenuItem>
                  <MenuItem value="so" sx={{ fontSize: 12 }}>Somali</MenuItem>
                  <MenuItem value="sw" sx={{ fontSize: 12 }}>Swahili</MenuItem>
                  <MenuItem value="my" sx={{ fontSize: 12 }}>Burmese</MenuItem>
                </Select>
              </FormControl>
            )}
            <FormControl size="small" sx={{ minWidth: 180 }}>
              <Select
                value={format}
                onChange={(e) => onFormatChange(e.target.value as AmbientFormat)}
                sx={{ fontSize: 12, height: 32 }}
              >
                <MenuItem value="soap">SOAP Note</MenuItem>
                <MenuItem value="mse">MSE Focus</MenuItem>
                <MenuItem value="progress">Progress Note</MenuItem>
                <MenuItem value="intake">Intake Assessment</MenuItem>
                <MenuItem value="ward_round">Ward Round</MenuItem>
                <MenuItem value="review">Clinical Review</MenuItem>
                <MenuItem value="collateral">Collateral Contact</MenuItem>
                <MenuItem value="phone">Phone / Telehealth</MenuItem>
                <MenuItem value="home_visit">Home Visit</MenuItem>
                <MenuItem value="case_conference">Case Conference / MDT</MenuItem>
                <MenuItem value="group">Group Session</MenuItem>
                <MenuItem value="incident">Incident Report</MenuItem>
                <MenuItem value="physical_health">Physical Health</MenuItem>
                <MenuItem value="lai">LAI Administration</MenuItem>
                <MenuItem value="clozapine">Clozapine Monitoring</MenuItem>
                <MenuItem value="all">Comprehensive (All)</MenuItem>
              </Select>
            </FormControl>
          </Box>
        )}
      </Box>

      {recording && (
        <Box sx={{ mb: 1 }}>
          <canvas
            ref={canvasRef}
            width={600}
            height={60}
            style={{ width: '100%', height: 60, borderRadius: 4, border: '1px solid #eee' }}
          />
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mt: 0.5 }}>
            <Typography variant="caption" color="text.secondary" sx={{ fontSize: 10 }}>Level</Typography>
            <Box sx={{ flex: 1, height: 4, borderRadius: 2, bgcolor: '#eee', overflow: 'hidden' }}>
              <Box
                sx={{
                  height: '100%',
                  borderRadius: 2,
                  transition: 'width 100ms',
                  width: `${audioLevel * 100}%`,
                  bgcolor: audioLevel > 0.7 ? '#D32F2F' : audioLevel > 0.3 ? '#b8621a' : '#2E7D32',
                }}
              />
            </Box>
            <Typography variant="caption" color="text.secondary" sx={{ fontSize: 10, minWidth: 40 }}>
              {formatDuration(duration)}
            </Typography>
          </Box>
        </Box>
      )}

      {/* S5.1: Live partial transcript pane. Shows the running output
          of the /scribe/stream-chunk pipeline as Whisper produces it.
          Empty until the first batch (5s) lands; populated thereafter.
          The final structured note still comes from the 3-pass medical
          scribe pipeline at the end of the recording. */}
      {liveTranscriptEnabled && recording && (
        <Box sx={{ mb: 1 }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 0.5 }}>
            <Typography variant="caption" sx={{ fontSize: 11, fontWeight: 600, color: 'text.secondary' }}>
              LIVE TRANSCRIPT
            </Typography>
            <Chip label="beta" size="small" sx={{ height: 16, fontSize: 9, bgcolor: '#fff3e0', color: '#b8621a' }} />
            <Typography variant="caption" color="text.secondary" sx={{ fontSize: 10, ml: 'auto' }}>
              {formatLiveTranscriptCadence(liveTranscriptBatchMs)}
            </Typography>
          </Box>
          <Paper
            variant="outlined"
            role="status"
            aria-live="polite"
            aria-label="Live transcript preview"
            sx={{
              p: 1.5,
              minHeight: 60,
              maxHeight: 200,
              overflowY: 'auto',
              bgcolor: '#FBF8F5',
              borderColor: '#e0d6cc',
            }}
          >
            <Typography
              variant="body2"
              sx={{
                fontSize: 13,
                lineHeight: 1.6,
                whiteSpace: 'pre-wrap',
                color: livePartialTranscript ? 'text.primary' : 'text.disabled',
                fontStyle: livePartialTranscript ? 'normal' : 'italic',
              }}
            >
              {livePartialTranscript || `Waiting for first ${Math.max(2, Math.round(liveTranscriptBatchMs / 1000))} seconds of audio…`}
            </Typography>
          </Paper>
        </Box>
      )}

      {processing && (
        <Alert severity="info" sx={{ fontSize: 12 }} icon={<LocalHospitalIcon sx={{ fontSize: 18 }} />}>
          {asyncJobStatus
            ? `Async Medical-Grade Scribe: ${formatAsyncProgress(asyncJobStatus)}. The server-side job will continue if this browser disconnects.`
            : 'Medical-Grade Scribe (3-pass pipeline): Whisper transcription, safety verification (medication doses, risk detection), then RANZCP-standard clinical formatting with confidence scoring. Short clips may take 30-90 seconds; longer psychiatric interviews are queued through the async scribe workflow.'}
        </Alert>
      )}
    </Paper>
  );
}
