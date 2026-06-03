import { useState, useRef, useCallback, useEffect } from 'react';
import {
  Alert, Box, Button, Chip, CircularProgress, Collapse, Dialog, DialogActions,
  DialogContent, DialogTitle, Divider, FormControl, Grid, IconButton, LinearProgress,
  MenuItem, Paper, Select, Tab, Tabs, Tooltip, Typography,
} from '@mui/material';
import MicIcon from '@mui/icons-material/Mic';
import StopIcon from '@mui/icons-material/Stop';
import PauseIcon from '@mui/icons-material/Pause';
import PlayArrowIcon from '@mui/icons-material/PlayArrow';
import AutoAwesomeIcon from '@mui/icons-material/AutoAwesome';
import WarningAmberIcon from '@mui/icons-material/WarningAmber';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import EditNoteIcon from '@mui/icons-material/EditNote';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import ExpandLessIcon from '@mui/icons-material/ExpandLess';
import ShieldIcon from '@mui/icons-material/Shield';
import LocalHospitalIcon from '@mui/icons-material/LocalHospital';
import ErrorIcon from '@mui/icons-material/Error';
import { llmAmbientApi, type AmbientFormat } from '../../../../shared/services/llmAmbientApi';
import { createAmbientRecordingConsent } from '../../../../shared/services/scribeConsentApi';
import type { AmbientNoteResult } from '../../../../shared/types/llmTypes';
import { ScribeStreamingClient } from './scribeStreamingClient';
import { useFeatureFlag } from '../../../../shared/hooks/useFeatureFlag';
import {
  buildNoteText,
  ConfidenceBadge,
  QUESTGradeBadge,
  RiskBanner,
  RiskLevelChip,
  SafetyAlertsBanner,
  StatusDot,
  VerifiedMedRow,
} from './ambientRecorderViewParts';

const CONSENT_KEY = 'signacare_ambient_ai_consent';

// S5.1 + S4.2: live partial transcript is gated by the feature flag
// system. Admins can enable/disable it per clinic via the
// feature_flags table (or the PUT /feature-flags-admin endpoint).
// The env var VITE_SCRIBE_LIVE_TRANSCRIPT is still honoured as a
// local-dev override — if set to 'false' it disables the feature
// regardless of the remote flag state, which is useful when a
// developer needs to reproduce the pre-S5.1 flow.
const LIVE_TRANSCRIPT_ENV_OVERRIDE =
  (import.meta.env.VITE_SCRIBE_LIVE_TRANSCRIPT ?? '').toLowerCase() === 'false';

// S5.2: full Whisper-large language list (~99 languages). The original
// 18-entry map covered the top AU community languages but blocked
// every other language behind "auto-detect", which is unreliable for
// short clips. The list below is the canonical Whisper-supported set
// (https://github.com/openai/whisper/blob/main/whisper/tokenizer.py).
// English first so the default index 0 is unchanged from the prior
// behaviour, then alphabetised by display name. The interpreter
// dialog renders the entries with a search box to keep the dropdown
// usable.
const LANGUAGE_NAMES: Record<string, string> = {
  en: 'English',
  af: 'Afrikaans',
  sq: 'Albanian',
  am: 'Amharic',
  ar: 'Arabic',
  hy: 'Armenian',
  as: 'Assamese',
  az: 'Azerbaijani',
  ba: 'Bashkir',
  eu: 'Basque',
  be: 'Belarusian',
  bn: 'Bengali',
  bs: 'Bosnian',
  br: 'Breton',
  bg: 'Bulgarian',
  my: 'Burmese',
  ca: 'Catalan',
  zh: 'Chinese',
  hr: 'Croatian',
  cs: 'Czech',
  da: 'Danish',
  nl: 'Dutch',
  et: 'Estonian',
  fo: 'Faroese',
  fil: 'Filipino',
  fi: 'Finnish',
  fr: 'French',
  gl: 'Galician',
  ka: 'Georgian',
  de: 'German',
  el: 'Greek',
  gu: 'Gujarati',
  ht: 'Haitian Creole',
  ha: 'Hausa',
  haw: 'Hawaiian',
  he: 'Hebrew',
  hi: 'Hindi',
  hu: 'Hungarian',
  is: 'Icelandic',
  id: 'Indonesian',
  it: 'Italian',
  ja: 'Japanese',
  jv: 'Javanese',
  kn: 'Kannada',
  kk: 'Kazakh',
  km: 'Khmer',
  ko: 'Korean',
  lo: 'Lao',
  la: 'Latin',
  lv: 'Latvian',
  ln: 'Lingala',
  lt: 'Lithuanian',
  lb: 'Luxembourgish',
  mk: 'Macedonian',
  mg: 'Malagasy',
  ms: 'Malay',
  ml: 'Malayalam',
  mt: 'Maltese',
  mi: 'Maori',
  mr: 'Marathi',
  mn: 'Mongolian',
  ne: 'Nepali',
  no: 'Norwegian',
  nn: 'Norwegian Nynorsk',
  oc: 'Occitan',
  ps: 'Pashto',
  fa: 'Persian/Dari',
  pl: 'Polish',
  pt: 'Portuguese',
  pa: 'Punjabi',
  ro: 'Romanian',
  ru: 'Russian',
  sa: 'Sanskrit',
  sr: 'Serbian',
  sn: 'Shona',
  sd: 'Sindhi',
  si: 'Sinhala',
  sk: 'Slovak',
  sl: 'Slovenian',
  so: 'Somali',
  es: 'Spanish',
  su: 'Sundanese',
  sw: 'Swahili',
  sv: 'Swedish',
  tl: 'Tagalog',
  tg: 'Tajik',
  ta: 'Tamil',
  tt: 'Tatar',
  te: 'Telugu',
  th: 'Thai',
  bo: 'Tibetan',
  tr: 'Turkish',
  tk: 'Turkmen',
  uk: 'Ukrainian',
  ur: 'Urdu',
  uz: 'Uzbek',
  vi: 'Vietnamese',
  cy: 'Welsh',
  yi: 'Yiddish',
  yo: 'Yoruba',
};

interface AmbientAiRecorderProps {
  onTranscriptReady: (soapNote: string) => void;
  patientId?: string;
  onResultReady?: (result: AmbientNoteResult) => void;
}

interface ServiceProbeResults {
  api: boolean;
  whisper: boolean | null;
  ollama: boolean;
  mic: boolean;
}

interface AmbientApiError {
  name?: unknown;
  message?: unknown;
  response?: {
    status?: unknown;
    data?: {
      error?: unknown;
      code?: unknown;
    };
  };
}

function parseAmbientApiError(err: unknown): {
  name?: string;
  message?: string;
  status?: number;
  apiError?: string;
  apiCode?: string;
} {
  if (typeof err !== 'object' || err === null) return {};
  const parsed = err as AmbientApiError;
  return {
    name: typeof parsed.name === 'string' ? parsed.name : undefined,
    message: typeof parsed.message === 'string' ? parsed.message : undefined,
    status: typeof parsed.response?.status === 'number' ? parsed.response.status : undefined,
    apiError: typeof parsed.response?.data?.error === 'string' ? parsed.response.data.error : undefined,
    apiCode: typeof parsed.response?.data?.code === 'string' ? parsed.response.data.code : undefined,
  };
}

export function AmbientAiRecorder({ onTranscriptReady, patientId, onResultReady }: AmbientAiRecorderProps) {
  // S4.2: remote feature flag controls whether live partial transcripts
  // are enabled for this clinic. The env var override lets a developer
  // disable the feature locally without touching the DB.
  const liveTranscriptFlag = useFeatureFlag('scribe-live-transcript-beta');
  const LIVE_TRANSCRIPT_ENABLED = liveTranscriptFlag && !LIVE_TRANSCRIPT_ENV_OVERRIDE;

  const [consented, setConsented] = useState(() => localStorage.getItem(CONSENT_KEY) === 'true');
  const [consentOpen, setConsentOpen] = useState(false);
  const [recording, setRecording] = useState(false);
  const [paused, setPaused] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [error, setError] = useState('');
  const [duration, setDuration] = useState(0);
  const [audioLevel, setAudioLevel] = useState(0);
  const [format, setFormat] = useState<AmbientFormat>('soap');
  const [interpreterUsed, setInterpreterUsed] = useState(false);
  const [interpreterLanguage, setInterpreterLanguage] = useState('');
  const [result, setResult] = useState<AmbientNoteResult | null>(null);
  const [showResult, setShowResult] = useState(false);
  const [resultTab, setResultTab] = useState(0);
  const [diagLog, setDiagLog] = useState<string[]>([]);
  const [showDiag, setShowDiag] = useState(false);
  const [serviceStatus, setServiceStatus] = useState<{
    api: boolean | null;
    whisper: boolean | null;
    ollama: boolean | null;
    mic: boolean | null;
    checking: boolean;
    lastChecked: string | null;
  }>({ api: null, whisper: null, ollama: null, mic: null, checking: false, lastChecked: null });

  const addLog = (msg: string) => {
    const ts = new Date().toLocaleTimeString('en-AU', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    setDiagLog(prev => [...prev, `[${ts}] ${msg}`]);
  };

  // Pre-flight service health check
  const checkServices = useCallback(async () => {
    setServiceStatus(s => ({ ...s, checking: true }));
    const results: ServiceProbeResults = { api: false, whisper: false, ollama: false, mic: false };

    try {
      const resp = await fetch(`${import.meta.env.VITE_API_URL?.replace(/\/api\/v1\/?$/, '') ?? ''}/health`, { signal: AbortSignal.timeout(5000) });
      results.api = resp.ok;
    } catch { results.api = false; }

    try {
      const resp = await fetch('http://localhost:8080/health', { signal: AbortSignal.timeout(5000) });
      results.whisper = resp.ok;
    } catch {
      try {
        const resp = await fetch(`${import.meta.env.VITE_API_URL ?? ''}/llm/models`, {
          credentials: 'include',
          signal: AbortSignal.timeout(5000),
        });
        results.whisper = resp.ok ? null : false;
      } catch { results.whisper = false; }
    }

    try {
      const resp = await fetch('http://localhost:11434/api/tags', { signal: AbortSignal.timeout(5000) });
      if (resp.ok) {
        const data = await resp.json();
        results.ollama = (data.models?.length ?? 0) > 0;
      }
    } catch { results.ollama = false; }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      stream.getTracks().forEach(t => t.stop());
      results.mic = true;
    } catch { results.mic = false; }

    const now = new Date().toLocaleTimeString('en-AU', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    setServiceStatus({ ...results, checking: false, lastChecked: now });
    return results;
  }, []);

  useEffect(() => { checkServices(); }, [checkServices]);

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const activeConsentIdRef = useRef<string | null>(null);
  const timerRef = useRef<number | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const animFrameRef = useRef<number | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);

  // S5.1: live partial transcript state. The streamingClientRef holds
  // a ScribeStreamingClient that batches MediaRecorder chunks and POSTs
  // them to /scribe/stream-chunk in 5-second windows. Errors are
  // non-fatal — if the streaming endpoint fails, the existing 3-pass
  // medical scribe pipeline still runs against the full audio at the
  // end and produces the canonical structured note.
  const streamingClientRef = useRef<ScribeStreamingClient | null>(null);
  const [livePartialTranscript, setLivePartialTranscript] = useState('');

  useEffect(() => {
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
      if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);
      streamRef.current?.getTracks().forEach(t => t.stop());
    };
  }, []);

  const handleConsent = () => {
    localStorage.setItem(CONSENT_KEY, 'true');
    setConsented(true);
    setConsentOpen(false);
    void startWithFreshConsent();
  };

  const drawWaveform = useCallback(() => {
    const analyser = analyserRef.current;
    const canvas = canvasRef.current;
    if (!analyser || !canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const bufferLength = analyser.frequencyBinCount;
    const dataArray = new Uint8Array(bufferLength);
    analyser.getByteTimeDomainData(dataArray);

    let sum = 0;
    for (let i = 0; i < bufferLength; i++) {
      const v = (dataArray[i] - 128) / 128;
      sum += v * v;
    }
    const rms = Math.sqrt(sum / bufferLength);
    setAudioLevel(Math.min(1, rms * 3));

    const { width, height } = canvas;
    ctx.clearRect(0, 0, width, height);
    ctx.fillStyle = '#FBF8F5';
    ctx.fillRect(0, 0, width, height);
    ctx.lineWidth = 2;
    ctx.strokeStyle = paused ? '#999' : '#b8621a';
    ctx.beginPath();

    const sliceWidth = width / bufferLength;
    let x = 0;
    for (let i = 0; i < bufferLength; i++) {
      const v = dataArray[i] / 128.0;
      const y = (v * height) / 2;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
      x += sliceWidth;
    }
    ctx.lineTo(width, height / 2);
    ctx.stroke();

    animFrameRef.current = requestAnimationFrame(drawWaveform);
  }, [paused]);

  const startRecording = useCallback(async (consentId: string) => {
    setError('');
    setResult(null);
    setShowResult(false);
    activeConsentIdRef.current = consentId;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });
      streamRef.current = stream;

      const audioCtx = new AudioContext();
      const source = audioCtx.createMediaStreamSource(stream);
      const analyser = audioCtx.createAnalyser();
      analyser.fftSize = 2048;
      source.connect(analyser);
      analyserRef.current = analyser;

      const mimeType = (['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/aac', ''] as const)
        .find(t => t === '' || MediaRecorder.isTypeSupported(t)) ?? '';
      const mediaRecorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
      chunksRef.current = [];

      // S5.1: spin up the streaming client and reset the live pane.
      if (LIVE_TRANSCRIPT_ENABLED) {
        streamingClientRef.current = new ScribeStreamingClient({
          batchMs: 5000,
          onPartial: (delta) => setLivePartialTranscript(delta.text),
          onError: (err) => addLog(`Live transcript error (non-fatal): ${err.message}`),
        });
        setLivePartialTranscript('');
      }

      mediaRecorder.ondataavailable = (e) => {
        if (e.data.size > 0) {
          chunksRef.current.push(e.data);
          // Feed the streaming client too. It buffers internally until
          // 5 seconds of audio have accumulated, then POSTs to
          // /scribe/stream-chunk and updates livePartialTranscript via
          // the onPartial callback above.
          streamingClientRef.current?.pushChunk(e.data, mediaRecorder.mimeType);
        }
      };

      mediaRecorder.onstop = async () => {
        stream.getTracks().forEach(t => t.stop());
        streamRef.current = null;
        if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
        if (animFrameRef.current) { cancelAnimationFrame(animFrameRef.current); animFrameRef.current = null; }
        setRecording(false);
        setPaused(false);
        setProcessing(true);

        // S5.1: drain any buffered partials so the live pane shows the
        // very last seconds of audio before the 3-pass pipeline runs.
        if (streamingClientRef.current) {
          try { await streamingClientRef.current.finish(); } catch { /* non-fatal */ }
        }

        try {
          const audioBlob = new Blob(chunksRef.current, { type: mediaRecorder.mimeType || 'audio/webm' });
          addLog(`Recording stopped — ${chunksRef.current.length} chunks, ${(audioBlob.size / 1024).toFixed(0)}KB, type: ${audioBlob.type}`);

          if (audioBlob.size < 1000) {
            addLog(`ERROR: Audio too small (${audioBlob.size} bytes) — aborting`);
            setError('Recording too short. Please record at least a few seconds of audio.');
            setProcessing(false);
            return;
          }

          addLog('Sending to Medical-Grade Scribe pipeline (3-pass)...');
          const t0 = Date.now();
          const activeConsentId = activeConsentIdRef.current;
          if (!patientId || !activeConsentId) {
            throw new Error('Ambient recording requires patient context and recording consent. Please retry.');
          }
          const ambientResult = await llmAmbientApi.generateAmbientNote(audioBlob, {
            format,
            interpreterUsed: interpreterUsed || undefined,
            interpreterLanguage: interpreterLanguage || undefined,
            patientId,
            consentId: activeConsentId,
          });
          const elapsed = ((Date.now() - t0) / 1000).toFixed(1);

          addLog(`Pipeline complete in ${elapsed}s — model: ${ambientResult.model}, pipeline: ${ambientResult.pipeline}`);
          addLog(`Transcript: ${ambientResult.transcript?.length ?? 0} chars`);
          addLog(`Whisper: ${ambientResult.transcriptionDurationMs ? (ambientResult.transcriptionDurationMs / 1000).toFixed(1) + 's' : 'n/a'}`);
          addLog(`Pass 1 (extract): ${ambientResult.pass1DurationMs ? (ambientResult.pass1DurationMs / 1000).toFixed(1) + 's' : 'n/a'}`);
          addLog(`Pass 2 (safety): ${ambientResult.pass2DurationMs ? (ambientResult.pass2DurationMs / 1000).toFixed(1) + 's' : 'n/a'}`);
          addLog(`Pass 3 (format): ${ambientResult.pass3DurationMs ? (ambientResult.pass3DurationMs / 1000).toFixed(1) + 's' : 'n/a'}`);
          addLog(`Quality: ${ambientResult.quality?.overallConfidence ?? '?'}% confidence, ${ambientResult.quality?.sectionsWithEvidence ?? 0}/${ambientResult.quality?.sectionsTotal ?? 0} sections`);
          addLog(`Safety: ${ambientResult.safetyAlerts?.length ?? 0} alerts, Risk: ${ambientResult.riskAssessment?.overallLevel ?? 'n/a'}, Meds verified: ${ambientResult.verifiedMedications?.length ?? 0}`);

          const noteText = buildNoteText(ambientResult);
          if (!noteText.trim() && !ambientResult.transcript?.trim()) {
            addLog('ERROR: Empty output — no transcript and no structured note');
            setError('No speech was detected in the recording. Please try again with a longer recording closer to the microphone.');
            setProcessing(false);
            setDuration(0);
            return;
          }

          addLog(`Output note: ${noteText.length} chars — ready for review`);
          setResult(ambientResult);
          setShowResult(true);
          onResultReady?.(ambientResult);

          if (noteText.trim()) {
            onTranscriptReady(noteText);
          } else if (ambientResult.transcript?.trim()) {
            addLog('WARNING: Structured note empty, falling back to raw transcript');
            onTranscriptReady(`TRANSCRIPT (requires structuring):\n${ambientResult.transcript.trim()}`);
          }
        } catch (err: unknown) {
          const parsed = parseAmbientApiError(err);
          const status = parsed.status;
          const apiError = parsed.apiError;
          const apiCode = parsed.apiCode;
          const axiosMsg = parsed.message ?? '';
          const msg = apiError ?? axiosMsg ?? 'Unknown error';

          addLog(`ERROR: [${status ?? 'no status'}] ${apiCode ?? ''} ${msg}`);

          if (axiosMsg === 'Network Error' || axiosMsg.includes('ERR_NETWORK')) {
            setError('Could not connect to the API server. Check that it is running on port 4000.');
          } else if (status === 429) {
            setError('AI rate limit reached. Please wait a minute and try again.');
          } else if (status === 403) {
            setError(`Request blocked: ${msg}. Try refreshing the page.`);
          } else if (apiCode === 'WHISPER_RESTARTING' || apiCode === 'WHISPER_UNREACHABLE' || msg.includes('ECONNREFUSED')) {
            // Backend has already triggered a restart — inform user to retry
            setError('Whisper server was not running and is now starting. Please wait 15-20 seconds and try again.');
          } else if (apiCode === 'PROCESSING_TIMEOUT' || msg.includes('timeout')) {
            setError('Processing timed out. Try a shorter recording (under 5 minutes).');
          } else if (apiCode === 'NO_SPEECH') {
            setError('No speech detected in the recording. Please speak clearly and try again.');
          } else if (apiCode === 'LLM_UNAVAILABLE') {
            setError('AI model is not available. Ensure Ollama is running (ollama serve).');
          } else {
            setError(`Ambient AI error: ${msg}`);
          }
        } finally {
          activeConsentIdRef.current = null;
          setProcessing(false);
          setDuration(0);
        }
      };

      mediaRecorderRef.current = mediaRecorder;
      mediaRecorder.start(1000);
      setRecording(true);
      setPaused(false);
      setDuration(0);
      setDiagLog([]);
      timerRef.current = window.setInterval(() => setDuration(d => d + 1), 1000);
      addLog(`Recording started — MIME: ${mediaRecorder.mimeType || 'default'}, sampleRate: ${audioCtx.sampleRate}Hz`);
      drawWaveform();

    } catch (err: unknown) {
      const parsed = parseAmbientApiError(err);
      const errName = parsed.name ?? '';
      if (errName === 'NotAllowedError' || errName === 'PermissionDeniedError') {
        setError('Microphone access denied. Please allow microphone permission in your browser settings.');
      } else if (errName === 'NotFoundError' || errName === 'DevicesNotFoundError') {
        setError('No microphone found. Please connect a microphone.');
      } else if (errName === 'OverconstrainedError' || errName === 'ConstraintNotSatisfiedError') {
        try {
          const fallbackStream = await navigator.mediaDevices.getUserMedia({ audio: true });
          streamRef.current = fallbackStream;
          const audioCtx = new AudioContext();
          const source = audioCtx.createMediaStreamSource(fallbackStream);
          const analyser = audioCtx.createAnalyser();
          analyser.fftSize = 2048;
          source.connect(analyser);
          analyserRef.current = analyser;
          const fallbackMime = (['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', ''] as const)
            .find(t => t === '' || MediaRecorder.isTypeSupported(t)) ?? '';
          const fallbackRecorder = new MediaRecorder(fallbackStream, fallbackMime ? { mimeType: fallbackMime } : undefined);
          chunksRef.current = [];
          fallbackRecorder.ondataavailable = (e) => { if (e.data.size > 0) chunksRef.current.push(e.data); };
          fallbackRecorder.onstop = mediaRecorderRef.current?.onstop ?? (() => {});
          mediaRecorderRef.current = fallbackRecorder;
          fallbackRecorder.start(1000);
          setRecording(true);
          setPaused(false);
          setDuration(0);
          timerRef.current = window.setInterval(() => setDuration(d => d + 1), 1000);
          drawWaveform();
          return;
        } catch {
          setError('Microphone is unavailable with the requested settings. Please try a different browser or device.');
        }
      } else if (errName === 'NotReadableError' || errName === 'AbortError') {
        setError('Microphone is in use by another application.');
      } else {
        setError(`Recording failed: ${parsed.message ?? 'Unknown error'}`);
      }
    }
  }, [onTranscriptReady, format, drawWaveform, duration, patientId, interpreterUsed, interpreterLanguage, onResultReady]);

  const startWithFreshConsent = useCallback(async () => {
    if (!patientId) {
      setError('Cannot start ambient recording without a selected patient.');
      return;
    }
    try {
      const consentId = await createAmbientRecordingConsent(patientId, {
        clinicianAttestationText: 'Patient verbally consented to ambient clinical recording for documentation purposes.',
      });
      await startRecording(consentId);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to capture recording consent.';
      addLog(`ERROR: consent capture failed — ${msg}`);
      setError(msg);
    }
  }, [patientId, startRecording]);

  const pauseRecording = () => {
    if (mediaRecorderRef.current?.state === 'recording') {
      mediaRecorderRef.current.pause();
      setPaused(true);
      if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
    }
  };

  const resumeRecording = () => {
    if (mediaRecorderRef.current?.state === 'paused') {
      mediaRecorderRef.current.resume();
      setPaused(false);
      timerRef.current = window.setInterval(() => setDuration(d => d + 1), 1000);
    }
  };

  const stopRecording = () => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      mediaRecorderRef.current.stop();
    }
  };

  const handleClick = async () => {
    if (recording) {
      stopRecording();
      return;
    }
    setError('');
    addLog('Running pre-flight checks...');
    const status = await checkServices();
    if (!status.api) {
      const msg = 'API server is not running. Start it with: cd apps/api && npm run dev';
      addLog(`PREFLIGHT FAIL: ${msg}`);
      setError(msg);
      return;
    }
    if (status.ollama === false) {
      const msg = 'Ollama is not running. Start it with: ollama serve';
      addLog(`PREFLIGHT FAIL: ${msg}`);
      setError(msg);
      return;
    }
    if (status.mic === false) {
      const msg = 'Microphone access denied. Allow microphone in browser settings.';
      addLog(`PREFLIGHT FAIL: ${msg}`);
      setError(msg);
      return;
    }
    addLog('Pre-flight checks passed — all services ready');

    if (consented) {
      await startWithFreshConsent();
    } else {
      setConsentOpen(true);
    }
  };

  const formatDuration = (s: number) => {
    const mins = Math.floor(s / 60);
    const secs = s % 60;
    return `${mins}:${String(secs).padStart(2, '0')}`;
  };

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
  };

  // Build tab list dynamically
  const tabs: { label: string; key: string }[] = [
    { label: 'Structured Note', key: 'note' },
    { label: result?.diarizedTranscript ? 'Diarized Transcript' : 'Transcript', key: 'transcript' },
  ];
  if (result?.safetyAlerts?.length || result?.riskAssessment) tabs.push({ label: 'Safety & Risk', key: 'safety' });
  if (result?.mentalStateExam) tabs.push({ label: 'MSE', key: 'mse' });
  if (result?.verifiedMedications?.length) tabs.push({ label: 'Medications', key: 'meds' });
  if (result?.icd10Suggestions?.length || result?.mbsSuggestions?.length) tabs.push({ label: 'Coding', key: 'coding' });
  if (result?.scribeActions?.length) tabs.push({ label: 'Actions', key: 'actions' });
  if (result?.outcomeMeasures?.length) tabs.push({ label: 'Outcome Measures', key: 'outcomes' });
  if (result?.bilingualTranscript) tabs.push({ label: 'Bilingual Transcript', key: 'bilingual' });
  if (result?.extractedFacts) tabs.push({ label: 'Extracted Facts', key: 'facts' });

  return (
    <>
      {/* Service Status */}
      {!recording && !processing && (
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, mb: 1, px: 0.5 }}>
          <StatusDot ok={serviceStatus.api} label="API" />
          <StatusDot ok={serviceStatus.whisper} label="Whisper" />
          <StatusDot ok={serviceStatus.ollama} label="Ollama" />
          <StatusDot ok={serviceStatus.mic} label="Mic" />
          {serviceStatus.checking && <CircularProgress role="progressbar" aria-label="Loading" size={10} sx={{ color: '#999' }} />}
          {serviceStatus.whisper === false && (
            <Button size="small" variant="outlined" onClick={async () => {
              try {
                addLog('Starting Whisper server...');
                const baseUrl = import.meta.env.VITE_API_URL ?? '/api/v1';
                await fetch(`${baseUrl}/llm/whisper/start`, { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': '1' } });
                addLog('Whisper start triggered — waiting for model load (15-20s)...');
                setTimeout(() => checkServices(), 15000);
              } catch { addLog('Failed to start Whisper'); }
            }}
              sx={{ fontSize: 10, textTransform: 'none', color: '#C62828', borderColor: '#C62828', minWidth: 0, py: 0.25, px: 1 }}>
              Start Whisper
            </Button>
          )}
          <Button size="small" onClick={checkServices} disabled={serviceStatus.checking}
            sx={{ fontSize: 10, textTransform: 'none', color: 'text.secondary', ml: 'auto', minWidth: 0, p: 0.5 }}>
            {serviceStatus.lastChecked ? `Checked ${serviceStatus.lastChecked}` : 'Check'}
          </Button>
        </Box>
      )}

      {/* Recording Controls */}
      <Paper variant="outlined" sx={{ p: 2, borderColor: recording ? '#b8621a' : 'divider', bgcolor: recording ? '#FFF8F0' : '#FBF8F5' }}>
        <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: recording ? 1.5 : 0 }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
            <Button
              size="small"
              variant={recording ? 'contained' : 'outlined'}
              startIcon={recording ? <StopIcon /> : <MicIcon />}
              onClick={handleClick}
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
              {processing ? 'Processing...' : recording ? `Stop (${formatDuration(duration)})` : 'Medical Scribe'}
            </Button>

            {recording && (
              <Tooltip title={paused ? 'Resume' : 'Pause'}>
                <IconButton size="small" aria-label={paused ? 'Resume recording' : 'Pause recording'} onClick={paused ? resumeRecording : pauseRecording}
                  sx={{ color: paused ? '#2E7D32' : '#b8621a', border: '1px solid', borderColor: 'divider' }}>
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
              {/* Interpreter toggle */}
              <Tooltip title="Enable for interpreter-assisted consultations. Audio in other languages will be auto-detected and translated to English.">
                <Chip
                  label={interpreterUsed ? `Interpreter (${interpreterLanguage || 'auto'})` : 'Interpreter'}
                  size="small"
                  variant={interpreterUsed ? 'filled' : 'outlined'}
                  onClick={() => setInterpreterUsed(v => !v)}
                  sx={{
                    fontSize: 11, height: 28, cursor: 'pointer',
                    bgcolor: interpreterUsed ? '#E3F2FD' : 'transparent',
                    color: interpreterUsed ? '#1565C0' : 'text.secondary',
                    borderColor: interpreterUsed ? '#1565C0' : 'divider',
                    fontWeight: interpreterUsed ? 600 : 400,
                  }}
                />
              </Tooltip>
              {interpreterUsed && (
                <FormControl size="small" sx={{ minWidth: 90 }}>
                  <Select value={interpreterLanguage} onChange={(e) => setInterpreterLanguage(e.target.value)}
                    displayEmpty sx={{ fontSize: 11, height: 28 }}>
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
                <Select value={format} onChange={(e) => setFormat(e.target.value as AmbientFormat)}
                  sx={{ fontSize: 12, height: 32 }}>
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

        {/* Live waveform */}
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
                <Box sx={{
                  height: '100%', borderRadius: 2, transition: 'width 100ms',
                  width: `${audioLevel * 100}%`,
                  bgcolor: audioLevel > 0.7 ? '#D32F2F' : audioLevel > 0.3 ? '#b8621a' : '#2E7D32',
                }} />
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
        {LIVE_TRANSCRIPT_ENABLED && recording && (
          <Box sx={{ mb: 1 }}>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 0.5 }}>
              <Typography variant="caption" sx={{ fontSize: 11, fontWeight: 600, color: 'text.secondary' }}>
                LIVE TRANSCRIPT
              </Typography>
              <Chip
                label="beta"
                size="small"
                sx={{ height: 16, fontSize: 9, bgcolor: '#fff3e0', color: '#b8621a' }}
              />
              <Typography variant="caption" color="text.secondary" sx={{ fontSize: 10, ml: 'auto' }}>
                Updates every 5 seconds
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
                {livePartialTranscript || 'Waiting for first 5 seconds of audio…'}
              </Typography>
            </Paper>
          </Box>
        )}

        {processing && (
          <Alert severity="info" sx={{ fontSize: 12 }} icon={<LocalHospitalIcon sx={{ fontSize: 18 }} />}>
            Medical-Grade Scribe (3-pass pipeline): Whisper transcription, safety verification (medication doses, risk detection), then RANZCP-standard clinical formatting with confidence scoring. This may take 30-90 seconds.
          </Alert>
        )}
      </Paper>

      {error && <Alert role="alert" severity="error" sx={{ mt: 1, fontSize: 12, whiteSpace: 'pre-wrap' }}>{error}</Alert>}

      {/* Diagnostic Log */}
      {diagLog.length > 0 && (
        <Box sx={{ mt: 1 }}>
          <Button size="small" onClick={() => setShowDiag(v => !v)}
            sx={{ fontSize: 10, textTransform: 'none', color: 'text.secondary', p: 0.5 }}>
            {showDiag ? 'Hide' : 'Show'} diagnostic log ({diagLog.length} entries)
          </Button>
          {showDiag && (
            <Paper variant="outlined" sx={{ mt: 0.5, p: 1, maxHeight: 200, overflow: 'auto', bgcolor: '#1E1E1E', borderRadius: 1 }}>
              {diagLog.map((line, i) => (
                <Typography key={i} variant="caption" display="block" sx={{
                  fontFamily: 'monospace', fontSize: 10, lineHeight: 1.6,
                  color: line.includes('ERROR') ? '#FF6B6B'
                    : line.includes('WARNING') ? '#FFD93D'
                    : line.includes('complete') || line.includes('ready') ? '#6BCB77'
                    : '#B0BEC5',
                }}>
                  {line}
                </Typography>
              ))}
            </Paper>
          )}
        </Box>
      )}

      {/* Result Preview */}
      {result && (
        <Collapse in={showResult}>
          <Paper variant="outlined" sx={{ mt: 2, p: 2, borderColor: '#327C8D' }}>
            {/* Header with quality score */}
            <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 1 }}>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                <LocalHospitalIcon sx={{ color: '#327C8D', fontSize: 18 }} />
                <Typography variant="subtitle2" fontWeight={700}>Medical-Grade Clinical Note</Typography>
                <Chip label="Requires Clinician Review" size="small" sx={{ fontSize: 10, bgcolor: '#FFF3E0', color: '#E65100' }} />
              </Box>
              <Box sx={{ display: 'flex', gap: 0.5, alignItems: 'center' }}>
                {result.quality && <ConfidenceBadge confidence={result.quality.overallConfidence} />}
                <Tooltip title="Copy to clipboard">
                  <IconButton size="small" aria-label="Copy to clipboard" onClick={() => copyToClipboard(buildNoteText(result))}>
                    <ContentCopyIcon fontSize="small" />
                  </IconButton>
                </Tooltip>
                <IconButton size="small" aria-label="Collapse result" onClick={() => setShowResult(false)}>
                  <ExpandLessIcon />
                </IconButton>
              </Box>
            </Box>

            {/* Safety Alerts Banner */}
            {result.safetyAlerts && result.safetyAlerts.length > 0 && (
              <SafetyAlertsBanner alerts={result.safetyAlerts} />
            )}

            {/* Risk Assessment Banner */}
            {result.riskAssessment && result.riskAssessment.overallLevel !== 'low' && (
              <RiskBanner riskAssessment={result.riskAssessment} />
            )}

            {/* Legacy risk flags for backward compat */}
            {!result.riskAssessment && result.riskFlags.length > 0 && (
              <Alert role="alert" severity="warning" sx={{ mb: 1.5, fontSize: 12 }} icon={<WarningAmberIcon />}>
                <Typography variant="caption" fontWeight={600}>Risk Flags Detected:</Typography>
                <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5, mt: 0.5 }}>
                  {result.riskFlags.map(f => (
                    <Chip key={f} label={f} size="small" color="warning" sx={{ fontSize: 10 }} />
                  ))}
                </Box>
              </Alert>
            )}

            {/* ICD-10 codes (auto-coded) */}
            {(result.icd10Suggestions?.length ?? 0) > 0 && (
              <Box sx={{ mb: 1.5, display: 'flex', alignItems: 'center', gap: 0.5, flexWrap: 'wrap' }}>
                <Typography variant="caption" color="text.secondary" fontWeight={600} sx={{ mr: 0.5 }}>ICD-10-AM:</Typography>
                {result.icd10Suggestions!.map(d => (
                  <Tooltip key={d.code} title={`${d.description} [${d.confidence}]`}>
                    <Chip label={d.code} size="small" variant="outlined"
                      sx={{ fontSize: 10, fontFamily: 'monospace', borderColor: d.confidence === 'high' ? '#4CAF50' : d.confidence === 'moderate' ? '#b8621a' : '#999' }} />
                  </Tooltip>
                ))}
              </Box>
            )}
            {/* Fallback: raw codes if no auto-coded suggestions */}
            {!(result.icd10Suggestions?.length) && result.suggestedDiagnosis.length > 0 && (
              <Box sx={{ mb: 1.5, display: 'flex', alignItems: 'center', gap: 1 }}>
                <Typography variant="caption" color="text.secondary" fontWeight={600}>ICD-10-AM:</Typography>
                {result.suggestedDiagnosis.map(d => (
                  <Chip key={d} label={d} size="small" variant="outlined" sx={{ fontSize: 10, fontFamily: 'monospace' }} />
                ))}
              </Box>
            )}

            {/* QUEST quality grade */}
            {result.questScore && (
              <Box sx={{ mb: 1.5, display: 'flex', alignItems: 'center', gap: 1 }}>
                <QUESTGradeBadge grade={result.questScore.grade} score={result.questScore.overall} />
                {result.questScore.issues.length > 0 && (
                  <Tooltip title={result.questScore.issues.join('\n')}>
                    <Typography variant="caption" color="text.secondary" sx={{ fontSize: 10, cursor: 'help', textDecoration: 'underline dotted' }}>
                      {result.questScore.issues.length} issue{result.questScore.issues.length > 1 ? 's' : ''} found
                    </Typography>
                  </Tooltip>
                )}
              </Box>
            )}

            {/* Quality bar */}
            {result.quality && (
              <Box sx={{ mb: 1.5, display: 'flex', alignItems: 'center', gap: 1.5 }}>
                <Typography variant="caption" color="text.secondary" sx={{ fontSize: 10, minWidth: 75 }}>
                  Evidence: {result.quality.sectionsWithEvidence}/{result.quality.sectionsTotal}
                </Typography>
                <LinearProgress
                  variant="determinate"
                  value={result.quality.overallConfidence}
                  sx={{
                    flex: 1, height: 6, borderRadius: 3,
                    bgcolor: '#f0ebe4',
                    '& .MuiLinearProgress-bar': {
                      borderRadius: 3,
                      bgcolor: result.quality.overallConfidence > 70 ? '#4CAF50'
                        : result.quality.overallConfidence > 40 ? '#b8621a' : '#D32F2F',
                    },
                  }}
                />
                <Typography variant="caption" color="text.secondary" sx={{ fontSize: 10, minWidth: 50 }}>
                  {result.quality.transcriptWordCount} words
                </Typography>
              </Box>
            )}

            {/* Tabbed output */}
            <Tabs aria-label="Navigation tabs" value={resultTab} onChange={(_, v) => setResultTab(v)}
              sx={{ mb: 1, minHeight: 32, '& .MuiTab-root': { minHeight: 32, fontSize: 12, textTransform: 'none' } }}>
              {tabs.map(t => <Tab key={t.key} label={t.label} />)}
            </Tabs>

            {/* Tab: Structured Note */}
            {tabs[resultTab]?.key === 'note' && (
              <Grid container spacing={1.5}>
                {(['subjective', 'objective', 'assessment', 'plan'] as const).map(section => (
                  <Grid key={section} size={{ xs: 12, md: 6 }}>
                    <Typography variant="caption" fontWeight={700} color="#327C8D" sx={{ textTransform: 'uppercase', fontSize: 10 }}>
                      {section}
                    </Typography>
                    <Typography variant="body2" sx={{ fontSize: 12, whiteSpace: 'pre-wrap', mt: 0.25 }}>
                      {result.structured[section] || '—'}
                    </Typography>
                  </Grid>
                ))}
              </Grid>
            )}

            {/* Tab: Transcript */}
            {tabs[resultTab]?.key === 'transcript' && (
              <Box sx={{ maxHeight: 250, overflow: 'auto' }}>
                <Typography variant="body2" sx={{ fontSize: 12, whiteSpace: 'pre-wrap', color: 'text.secondary' }}>
                  {(result.diarizedTranscript || result.transcript).split('\n').map((line, i) => {
                    const isClinician = line.startsWith('[CLINICIAN]');
                    const isPatient = line.startsWith('[PATIENT]');
                    return (
                      <Box key={i} sx={{ mb: 1, pl: isPatient ? 2 : 0 }}>
                        {isClinician && (
                          <Chip label="Clinician" size="small" sx={{ fontSize: 9, height: 16, bgcolor: '#327C8D20', color: '#327C8D', fontWeight: 700, mr: 0.5 }} />
                        )}
                        {isPatient && (
                          <Chip label="Patient" size="small" sx={{ fontSize: 9, height: 16, bgcolor: '#b8621a20', color: '#b8621a', fontWeight: 700, mr: 0.5 }} />
                        )}
                        <span style={{ fontStyle: isPatient ? 'italic' : 'normal' }}>
                          {line.replace(/^\[(CLINICIAN|PATIENT)\]:\s*/, '')}
                        </span>
                      </Box>
                    );
                  })}
                </Typography>
              </Box>
            )}

            {/* Tab: Safety & Risk */}
            {tabs[resultTab]?.key === 'safety' && (
              <Box>
                {result.riskAssessment && (
                  <Box sx={{ mb: 2 }}>
                    <Typography variant="caption" fontWeight={700} color="#327C8D" sx={{ fontSize: 11, mb: 1, display: 'block' }}>
                      RISK ASSESSMENT
                    </Typography>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}>
                      <Typography variant="body2" sx={{ fontSize: 12 }}>Overall level:</Typography>
                      <RiskLevelChip level={result.riskAssessment.overallLevel} />
                    </Box>
                    {result.riskAssessment.flags.length > 0 && (
                      <Box sx={{ mb: 1 }}>
                        {result.riskAssessment.flags.map((f, i) => (
                          <Box key={i} sx={{ display: 'flex', gap: 1, py: 0.75, borderBottom: '1px solid #f0ebe4', alignItems: 'flex-start' }}>
                            <RiskLevelChip level={f.severity} />
                            <Box>
                              <Typography variant="body2" fontWeight={600} sx={{ fontSize: 12 }}>{f.flag}</Typography>
                              <Typography variant="caption" color="text.secondary" sx={{ fontSize: 11 }}>{f.evidence}</Typography>
                              <Typography variant="caption" sx={{ fontSize: 11, display: 'block', color: '#1565C0', mt: 0.25 }}>
                                Action: {f.action}
                              </Typography>
                            </Box>
                          </Box>
                        ))}
                      </Box>
                    )}
                    {result.riskAssessment.protectiveFactors.length > 0 && (
                      <Box>
                        <Typography variant="caption" fontWeight={600} sx={{ fontSize: 11, color: '#2E7D32' }}>Protective factors:</Typography>
                        <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5, mt: 0.5 }}>
                          {result.riskAssessment.protectiveFactors.map(f => (
                            <Chip key={f} label={f} size="small" sx={{ fontSize: 10, bgcolor: '#E8F5E9', color: '#2E7D32' }} />
                          ))}
                        </Box>
                      </Box>
                    )}
                  </Box>
                )}

                {result.safetyAlerts && result.safetyAlerts.length > 0 && (
                  <Box>
                    <Typography variant="caption" fontWeight={700} color="#327C8D" sx={{ fontSize: 11, mb: 1, display: 'block' }}>
                      SAFETY ALERTS
                    </Typography>
                    {result.safetyAlerts.map((a, i) => (
                      <Box key={i} sx={{ display: 'flex', gap: 1, py: 0.5, borderBottom: '1px solid #f0ebe4', alignItems: 'center' }}>
                        {a.severity === 'critical' ? <ErrorIcon sx={{ fontSize: 16, color: '#D32F2F' }} />
                          : a.severity === 'warning' ? <WarningAmberIcon sx={{ fontSize: 16, color: '#ED6C02' }} />
                          : <ShieldIcon sx={{ fontSize: 16, color: '#1565C0' }} />}
                        <Chip label={a.type.replace('_', ' ')} size="small" sx={{ fontSize: 9, height: 18 }} />
                        <Typography variant="body2" sx={{ fontSize: 12 }}>{a.message}</Typography>
                      </Box>
                    ))}
                  </Box>
                )}
              </Box>
            )}

            {/* Tab: MSE */}
            {tabs[resultTab]?.key === 'mse' && result.mentalStateExam && (
              <Grid container spacing={1}>
                {Object.entries(result.mentalStateExam).map(([key, val]) => (
                  <Grid key={key} size={{ xs: 12, sm: 6, md: 4 }}>
                    <Typography variant="caption" fontWeight={700} sx={{ textTransform: 'capitalize', fontSize: 10, color: '#327C8D' }}>
                      {key.replace(/([A-Z])/g, ' $1').trim()}
                    </Typography>
                    <Typography variant="body2" sx={{ fontSize: 12, color: val ? 'text.primary' : 'text.disabled' }}>
                      {val || 'Not assessed'}
                    </Typography>
                  </Grid>
                ))}
              </Grid>
            )}

            {/* Tab: Verified Medications */}
            {tabs[resultTab]?.key === 'meds' && result.verifiedMedications && (
              <Box>
                {result.verifiedMedications.map((med, i) => (
                  <VerifiedMedRow key={i} med={med} />
                ))}
              </Box>
            )}

            {/* Tab: Coding (ICD-10 + MBS) */}
            {tabs[resultTab]?.key === 'coding' && (
              <Box>
                {result.icd10Suggestions && result.icd10Suggestions.length > 0 && (
                  <Box sx={{ mb: 2 }}>
                    <Typography variant="caption" fontWeight={700} color="#327C8D" sx={{ fontSize: 11, mb: 1, display: 'block' }}>
                      ICD-10-AM DIAGNOSIS CODES
                    </Typography>
                    {result.icd10Suggestions.map((s, i) => (
                      <Box key={i} sx={{ display: 'flex', gap: 1, py: 0.5, borderBottom: '1px solid #f0ebe4', alignItems: 'center' }}>
                        <Chip label={s.code} size="small" sx={{ fontSize: 10, fontFamily: 'monospace', fontWeight: 700, minWidth: 55,
                          bgcolor: s.confidence === 'high' ? '#E8F5E9' : s.confidence === 'moderate' ? '#FFF3E0' : '#F5F5F5',
                          color: s.confidence === 'high' ? '#2E7D32' : s.confidence === 'moderate' ? '#E65100' : '#666' }} />
                        <Box sx={{ flex: 1 }}>
                          <Typography variant="body2" sx={{ fontSize: 12 }}>{s.description}</Typography>
                          <Typography variant="caption" color="text.secondary" sx={{ fontSize: 10 }}>Source: {s.source.substring(0, 80)}</Typography>
                        </Box>
                        <Chip label={s.confidence} size="small" variant="outlined" sx={{ fontSize: 9, height: 18 }} />
                      </Box>
                    ))}
                  </Box>
                )}
                {result.mbsSuggestions && result.mbsSuggestions.length > 0 && (
                  <Box>
                    <Typography variant="caption" fontWeight={700} color="#327C8D" sx={{ fontSize: 11, mb: 1, display: 'block' }}>
                      MBS ITEM SUGGESTIONS
                    </Typography>
                    {result.mbsSuggestions.map((s, i) => (
                      <Box key={i} sx={{ display: 'flex', gap: 1, py: 0.5, borderBottom: '1px solid #f0ebe4', alignItems: 'center' }}>
                        <Chip label={s.itemNumber} size="small" sx={{ fontSize: 10, fontFamily: 'monospace', fontWeight: 700, bgcolor: '#E3F2FD', color: '#1565C0' }} />
                        <Box sx={{ flex: 1 }}>
                          <Typography variant="body2" sx={{ fontSize: 12 }}>{s.description}</Typography>
                          <Typography variant="caption" color="text.secondary" sx={{ fontSize: 10 }}>{s.criteria}</Typography>
                        </Box>
                        <Typography variant="caption" fontWeight={600} sx={{ fontSize: 11, color: '#2E7D32' }}>{s.fee}</Typography>
                      </Box>
                    ))}
                  </Box>
                )}
              </Box>
            )}

            {/* Tab: Scribe Actions */}
            {tabs[resultTab]?.key === 'actions' && result.scribeActions && (
              <Box>
                <Typography variant="caption" fontWeight={700} color="#327C8D" sx={{ fontSize: 11, mb: 1, display: 'block' }}>
                  SUGGESTED ACTIONS FROM NOTE
                </Typography>
                {result.scribeActions.map((a, i) => {
                  const iconColors: Record<string, string> = {
                    referral: '#7B5EA7', appointment: '#1565C0', prescription: '#b8621a',
                    pathology: '#2E7D32', task: '#327C8D', alert: '#D32F2F',
                  };
                  return (
                    <Box key={i} sx={{ display: 'flex', gap: 1, py: 0.75, borderBottom: '1px solid #f0ebe4', alignItems: 'center' }}>
                      <Chip label={a.type} size="small"
                        sx={{ fontSize: 9, height: 18, bgcolor: `${iconColors[a.type] ?? '#999'}15`, color: iconColors[a.type] ?? '#999', fontWeight: 700, textTransform: 'capitalize' }} />
                      <Typography variant="body2" sx={{ fontSize: 12, flex: 1 }}>{a.description}</Typography>
                      {a.autoCreateable && (
                        <Chip label="Auto-create" size="small" variant="outlined" sx={{ fontSize: 9, height: 18, color: '#2E7D32', borderColor: '#2E7D32' }} />
                      )}
                    </Box>
                  );
                })}
              </Box>
            )}

            {/* Tab: Outcome Measures */}
            {tabs[resultTab]?.key === 'outcomes' && result.outcomeMeasures && (
              <Box>
                <Typography variant="caption" fontWeight={700} color="#327C8D" sx={{ fontSize: 11, mb: 1, display: 'block' }}>
                  EXTRACTED OUTCOME MEASURES
                </Typography>
                {result.outcomeMeasures.map((m, i) => (
                  <Box key={i} sx={{ display: 'flex', gap: 1.5, py: 0.75, borderBottom: '1px solid #f0ebe4', alignItems: 'center' }}>
                    <Chip label={m.instrument} size="small" sx={{ fontSize: 10, fontWeight: 700, bgcolor: '#E3F2FD', color: '#1565C0' }} />
                    <Typography variant="body2" fontWeight={700} sx={{ fontSize: 14 }}>{m.score}</Typography>
                    <Typography variant="caption" color="text.secondary" sx={{ fontSize: 10 }}>/ {m.maxScore}</Typography>
                    <Chip label={m.severity} size="small" sx={{ fontSize: 9, height: 18,
                      bgcolor: m.severity === 'Severe' || m.severity === 'Extremely severe' ? '#FFEBEE' : m.severity === 'Moderate' || m.severity === 'Moderately severe' ? '#FFF3E0' : '#E8F5E9',
                      color: m.severity === 'Severe' || m.severity === 'Extremely severe' ? '#D32F2F' : m.severity === 'Moderate' || m.severity === 'Moderately severe' ? '#E65100' : '#2E7D32',
                      fontWeight: 600 }} />
                    <Typography variant="caption" color="text.secondary" sx={{ fontSize: 10, flex: 1 }}>{m.evidence.substring(0, 60)}</Typography>
                  </Box>
                ))}
              </Box>
            )}

            {/* Tab: Bilingual Transcript (interpreter mode) */}
            {tabs[resultTab]?.key === 'bilingual' && result.bilingualTranscript && (
              <Box sx={{ maxHeight: 300, overflow: 'auto' }}>
                {result.interpreterUsed && (
                  <Alert severity="info" sx={{ mb: 1, fontSize: 11, py: 0.5 }} icon={<AutoAwesomeIcon sx={{ fontSize: 16 }} />}>
                    Interpreter-assisted consultation{result.interpreterLanguage ? ` (${LANGUAGE_NAMES[result.interpreterLanguage] ?? result.interpreterLanguage})` : ''}. Non-English segments auto-translated to English.
                  </Alert>
                )}
                {result.bilingualTranscript.split('\n').map((line, i) => {
                  const isTranslation = line.trimStart().startsWith('→');
                  const isSpeakerLine = line.startsWith('[');
                  return (
                    <Typography key={i} variant="body2" sx={{
                      fontSize: 12, whiteSpace: 'pre-wrap', mb: isTranslation ? 0.75 : 0.25,
                      pl: isTranslation ? 3 : 0,
                      color: isTranslation ? '#1565C0' : isSpeakerLine ? 'text.primary' : 'text.secondary',
                      fontStyle: isTranslation ? 'italic' : 'normal',
                      fontWeight: isSpeakerLine ? 600 : 400,
                    }}>
                      {line}
                    </Typography>
                  );
                })}
              </Box>
            )}

            {/* Tab: Extracted Facts */}
            {tabs[resultTab]?.key === 'facts' && result.extractedFacts && (
              <Grid container spacing={1.5}>
                {Object.entries(result.extractedFacts).filter(([k, v]) => k !== 'mse' && (Array.isArray(v) ? v.length > 0 : Object.keys(v).length > 0)).map(([key, facts]) => {
                  const tagColors: Record<string, string> = {
                    subjective: '#327C8D', objective: '#b8621a', assessment: '#7B5EA7',
                    plan: '#2E7D32', risk: '#D32F2F', medications: '#1565C0', quotes: '#6D4C41',
                  };
                  const items = Array.isArray(facts) ? facts : Object.entries(facts).map(([k, v]) => `${k}: ${v}`);
                  return (
                    <Grid key={key} size={{ xs: 12, sm: 6 }}>
                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, mb: 0.5 }}>
                        <Box sx={{ width: 8, height: 8, borderRadius: '50%', bgcolor: tagColors[key] || '#999' }} />
                        <Typography variant="caption" fontWeight={700} sx={{ textTransform: 'uppercase', fontSize: 10, color: tagColors[key] }}>
                          {key} ({items.length})
                        </Typography>
                      </Box>
                      {items.map((f: string, j: number) => (
                        <Typography key={j} variant="body2" sx={{ fontSize: 11, pl: 1.5, mb: 0.25, borderLeft: `2px solid ${tagColors[key]}22` }}>
                          {f}
                        </Typography>
                      ))}
                    </Grid>
                  );
                })}
              </Grid>
            )}

            <Box sx={{ display: 'flex', gap: 1, mt: 1.5, alignItems: 'center', flexWrap: 'wrap' }}>
              <Button size="small" variant="contained" startIcon={<EditNoteIcon />}
                onClick={() => onTranscriptReady(buildNoteText(result))}
                sx={{ bgcolor: '#b8621a', '&:hover': { bgcolor: '#d6741f' }, fontSize: 11, textTransform: 'none' }}>
                Use in Note
              </Button>
              <Chip
                icon={<LocalHospitalIcon sx={{ fontSize: 12 }} />}
                label="Medical-Grade 3-Pass"
                size="small"
                sx={{ fontSize: 9, height: 18, bgcolor: '#327C8D15', color: '#327C8D', fontWeight: 600 }}
              />
              <Typography variant="caption" color="text.secondary" sx={{ fontSize: 10 }}>
                {result.durationSeconds}s total
                {result.transcriptionDurationMs ? ` (Whisper: ${(result.transcriptionDurationMs / 1000).toFixed(1)}s` : ''}
                {result.pass1DurationMs ? ` | Extract: ${(result.pass1DurationMs / 1000).toFixed(1)}s` : ''}
                {result.pass2DurationMs ? ` | Safety: ${(result.pass2DurationMs / 1000).toFixed(1)}s` : ''}
                {result.pass3DurationMs ? ` | Format: ${(result.pass3DurationMs / 1000).toFixed(1)}s)` : ''}
                {' | '}{result.model}
              </Typography>
            </Box>
          </Paper>
        </Collapse>
      )}

      {result && !showResult && (
        <Button size="small" variant="text" onClick={() => setShowResult(true)} startIcon={<ExpandMoreIcon />}
          sx={{ mt: 0.5, fontSize: 11, textTransform: 'none', color: '#327C8D' }}>
          Show AI Result
        </Button>
      )}

      {/* Consent Dialog */}
      <Dialog aria-labelledby="dialog-title" open={consentOpen} onClose={() => setConsentOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle id="dialog-title" sx={{ fontFamily: 'Albert Sans, sans-serif', fontWeight: 700 }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <LocalHospitalIcon sx={{ color: '#327C8D' }} />
            Medical-Grade Clinical Scribe
          </Box>
        </DialogTitle>
        <Divider />
        <DialogContent>
          <Typography variant="body2" sx={{ mb: 2 }}>
            The Medical-Grade Scribe uses your device&apos;s microphone to listen to the clinical encounter and automatically generate structured clinical notes with safety verification.
          </Typography>
          <Paper variant="outlined" sx={{ p: 2, bgcolor: '#FBF8F5' }}>
            <Typography variant="subtitle2" fontWeight={600} sx={{ mb: 1 }}>3-Pass Medical Pipeline:</Typography>
            <Typography variant="body2" component="div">
              <ul style={{ margin: 0, paddingLeft: 20 }}>
                <li>Audio captured via browser microphone</li>
                <li><strong>Pass 1:</strong> Whisper transcription + verbatim clinical fact extraction</li>
                <li><strong>Pass 2:</strong> Medication dose verification, risk pattern detection, safety alerts</li>
                <li><strong>Pass 3:</strong> RANZCP-standard clinical note formatting with confidence scoring</li>
                <li><strong>No patient data leaves your network</strong> — all processing is local</li>
                <li>All AI calls are audit-logged</li>
              </ul>
            </Typography>
          </Paper>
          <Alert severity="info" sx={{ mt: 2 }}>
            <strong>Patient consent required.</strong> Confirm the patient has been informed and has given verbal consent to recording.
          </Alert>
        </DialogContent>
        <Divider />
        <DialogActions sx={{ px: 3, py: 2 }}>
          <Button onClick={() => setConsentOpen(false)} sx={{ color: 'text.secondary' }}>Cancel</Button>
          <Button variant="contained" onClick={handleConsent} sx={{ bgcolor: '#327C8D', '&:hover': { bgcolor: '#265f6d' } }}>
            Patient Consent Confirmed — Start Recording
          </Button>
        </DialogActions>
      </Dialog>
    </>
  );
}
