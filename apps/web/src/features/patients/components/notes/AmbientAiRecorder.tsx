/**
 * Ambient AI Recorder — composition shell.
 *
 * Phase 8 UI refactor (2026-06-06): the original 911-LOC god-file is
 * now a thin composition over five focused units:
 *  - useAmbientServiceProbe        — pre-flight health/whisper/ollama/mic
 *  - useAmbientRecorderController  — MediaRecorder + stream + waveform lifecycle
 *  - useAmbientScribeJobRunner     — async/sync ambient pipeline + recovery
 *  - AmbientRecorderControls       — record/pause/stop/format/interpreter UI
 *  - AmbientDiagnosticsPanel       — diagnostic log
 *
 * Behaviour, disclaimers, consent gating, error messages, and async
 * recovery semantics are preserved 1:1 with the prior implementation.
 */
import { useCallback, useEffect, useState } from 'react';
import { Alert, Box, Button, CircularProgress } from '@mui/material';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import type { AmbientFormat } from '../../../../shared/services/llmAmbientApi';
import { SignacareApiError } from '../../../../shared/services/apiClient';
import { LIVE_TRANSCRIPT_BATCH_MS } from '../../../../shared/services/scribeLiveTranscriptConfig';
import { createAmbientRecordingConsent } from '../../../../shared/services/scribeConsentApi';
import type { AmbientNoteResult } from '../../../../shared/types/llmTypes';
import { useFeatureFlag } from '../../../../shared/hooks/useFeatureFlag';
import { useSessionStore } from '../../../../shared/store/sessionStore';
import { DutyRelationshipDialog } from '../detail/DutyRelationshipDialog';
import { StatusDot } from './ambientRecorderViewParts';
import { AmbientScribeConsentDialog } from './AmbientScribeConsentDialog';
import { AmbientAiJobsDashboard } from './AmbientAiJobsDashboard';
import { AmbientAiResultPanel } from './AmbientAiResultPanel';
import { useAmbientServiceProbe } from './useAmbientServiceProbe';
import {
  useAmbientRecorderController,
  type RecorderError,
} from './useAmbientRecorderController';
import { useAmbientScribeJobRunner } from './useAmbientScribeJobRunner';
import { AmbientRecorderControls } from './AmbientRecorderControls';
import { AmbientDiagnosticsPanel } from './AmbientDiagnosticsPanel';
import { isAmbientScribeSessionActive } from './ambientSessionSupport';

const CONSENT_KEY = 'signacare_ambient_ai_consent';

// S5.1 + S4.2: live partial transcript remains beta because browser
// MediaRecorder WebM chunks are not always independently decodable by
// ffmpeg/Whisper. Keep it opt-in at the environment level, then gated by
// clinic feature flag. The final full-recording pipeline remains the
// canonical ambient scribe path.
const LIVE_TRANSCRIPT_ENV_ENABLED =
  (import.meta.env.VITE_SCRIBE_LIVE_TRANSCRIPT ?? '').toLowerCase() === 'true';

interface AmbientAiRecorderProps {
  onTranscriptReady: (soapNote: string) => void;
  patientId?: string;
  onResultReady?: (result: AmbientNoteResult) => void;
}

function isRecorderError(value: unknown): value is RecorderError {
  return typeof value === 'object' && value !== null && 'code' in value && 'message' in value;
}

export function AmbientAiRecorder({ onTranscriptReady, patientId, onResultReady }: AmbientAiRecorderProps) {
  // S4.2: remote feature flag controls whether live partial transcripts
  // are enabled for this clinic after the deployment explicitly opts in.
  const liveTranscriptFlag = useFeatureFlag('scribe-live-transcript-beta');
  const LIVE_TRANSCRIPT_ENABLED = liveTranscriptFlag && LIVE_TRANSCRIPT_ENV_ENABLED;

  const [consented, setConsented] = useState(() => localStorage.getItem(CONSENT_KEY) === 'true');
  const [consentOpen, setConsentOpen] = useState(false);
  const [format, setFormat] = useState<AmbientFormat>('progress');
  const [interpreterUsed, setInterpreterUsed] = useState(false);
  const [interpreterLanguage, setInterpreterLanguage] = useState('');
  const [diagLog, setDiagLog] = useState<string[]>([]);
  const [showDiag, setShowDiag] = useState(false);
  const [activeConsentId, setActiveConsentId] = useState<string | null>(null);
  const [dutyDialogOpen, setDutyDialogOpen] = useState(false);
  const setScribeActive = useSessionStore((s) => s.setScribeActive);

  const addLog = useCallback((msg: string) => {
    const ts = new Date().toLocaleTimeString('en-AU', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    setDiagLog((prev) => [...prev, `[${ts}] ${msg}`]);
  }, []);

  const { serviceStatus, checkServices, restartWhisper } = useAmbientServiceProbe(addLog);

  const jobRunner = useAmbientScribeJobRunner({
    patientId,
    onTranscriptReady,
    onResultReady,
    onLog: addLog,
  });

  const recorder = useAmbientRecorderController({
    liveTranscriptEnabled: LIVE_TRANSCRIPT_ENABLED,
    liveTranscriptBatchMs: LIVE_TRANSCRIPT_BATCH_MS,
    onLog: addLog,
    onFinishedRecording: async (payload) => {
      const consentId = activeConsentId;
      setActiveConsentId(null);
      if (!consentId) {
        jobRunner.setError('Ambient recording requires patient context and recording consent. Please retry.');
        return;
      }
      await jobRunner.processFinishedRecording(payload, {
        format,
        interpreterUsed,
        interpreterLanguage,
        consentId,
      });
    },
  });

  const startWithFreshConsent = useCallback(async () => {
    if (!patientId) {
      jobRunner.setError('Cannot start ambient recording without a selected patient.');
      return;
    }
    try {
      const consentId = await createAmbientRecordingConsent(patientId, {
        clinicianAttestationText: 'Patient verbally consented to ambient clinical recording for documentation purposes.',
      });
      setActiveConsentId(consentId);
      jobRunner.resetForNewRecording();
      await recorder.start();
    } catch (err: unknown) {
      if (isRecorderError(err)) {
        addLog(`ERROR: recorder start failed — ${err.message}`);
        jobRunner.setError(err.message);
        setActiveConsentId(null);
        return;
      }
      if (err instanceof SignacareApiError && err.code === 'NO_PATIENT_RELATIONSHIP') {
        setDutyDialogOpen(true);
      }
      const msg = err instanceof Error ? err.message : 'Failed to capture recording consent.';
      addLog(`ERROR: consent capture failed — ${msg}`);
      jobRunner.setError(msg);
      setActiveConsentId(null);
    }
  }, [addLog, jobRunner, patientId, recorder]);

  const handleConsent = () => {
    localStorage.setItem(CONSENT_KEY, 'true');
    setConsented(true);
    setConsentOpen(false);
    void startWithFreshConsent();
  };

  const handlePrimaryClick = async () => {
    if (recorder.recording) {
      recorder.stop();
      return;
    }
    jobRunner.setError('');
    addLog('Running pre-flight checks...');
    const status = await checkServices();
    if (!status.api) {
      const msg = 'API server is not running. Start it with: cd apps/api && npm run dev';
      addLog(`PREFLIGHT FAIL: ${msg}`);
      jobRunner.setError(msg);
      return;
    }
    if (status.ollama === false) {
      const msg = 'Ollama is not running. Start it with: ollama serve';
      addLog(`PREFLIGHT FAIL: ${msg}`);
      jobRunner.setError(msg);
      return;
    }
    if (status.mic === false) {
      const msg = 'Microphone access denied. Allow microphone in browser settings.';
      addLog(`PREFLIGHT FAIL: ${msg}`);
      jobRunner.setError(msg);
      return;
    }
    addLog('Pre-flight checks passed — all services ready');

    if (consented) {
      await startWithFreshConsent();
    } else {
      setConsentOpen(true);
    }
  };

  const showServiceStatus = !recorder.recording && !jobRunner.processing;

  useEffect(() => {
    setScribeActive(isAmbientScribeSessionActive(recorder.recording, jobRunner.processing));
    return () => {
      setScribeActive(false);
    };
  }, [jobRunner.processing, recorder.recording, setScribeActive]);

  return (
    <>
      {showServiceStatus && (
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, mb: 1, px: 0.5 }}>
          <StatusDot ok={serviceStatus.api} label="API" />
          <StatusDot ok={serviceStatus.whisper} label="Whisper" />
          <StatusDot ok={serviceStatus.ollama} label="Ollama" />
          <StatusDot ok={serviceStatus.mic} label="Mic" />
          {serviceStatus.checking && (
            <CircularProgress role="progressbar" aria-label="Loading" size={10} sx={{ color: '#999' }} />
          )}
          {serviceStatus.whisper === false && (
            <Button
              size="small"
              variant="outlined"
              onClick={() => void restartWhisper()}
              sx={{ fontSize: 10, textTransform: 'none', color: '#C62828', borderColor: '#C62828', minWidth: 0, py: 0.25, px: 1 }}
            >
              Start Whisper
            </Button>
          )}
          <Button
            size="small"
            onClick={() => void checkServices()}
            disabled={serviceStatus.checking}
            sx={{ fontSize: 10, textTransform: 'none', color: 'text.secondary', ml: 'auto', minWidth: 0, p: 0.5 }}
          >
            {serviceStatus.lastChecked ? `Checked ${serviceStatus.lastChecked}` : 'Check'}
          </Button>
        </Box>
      )}

      {showServiceStatus && (
        <AmbientAiJobsDashboard
          patientId={patientId}
          disabled={recorder.recording || jobRunner.processing}
          onApplyResult={jobRunner.applyAmbientResult}
          onInspectStatus={jobRunner.setAsyncJobStatus}
          onLog={addLog}
        />
      )}

      <AmbientRecorderControls
        recording={recorder.recording}
        paused={recorder.paused}
        processing={jobRunner.processing}
        duration={recorder.duration}
        audioLevel={recorder.audioLevel}
        asyncJobStatus={jobRunner.asyncJobStatus}
        format={format}
        onFormatChange={setFormat}
        interpreterUsed={interpreterUsed}
        onInterpreterUsedChange={setInterpreterUsed}
        interpreterLanguage={interpreterLanguage}
        onInterpreterLanguageChange={setInterpreterLanguage}
        onPrimaryClick={handlePrimaryClick}
        onPause={recorder.pause}
        onResume={recorder.resume}
        canvasRef={recorder.canvasRef}
        livePartialTranscript={recorder.livePartialTranscript}
        liveTranscriptEnabled={LIVE_TRANSCRIPT_ENABLED}
        liveTranscriptBatchMs={LIVE_TRANSCRIPT_BATCH_MS}
      />

      {jobRunner.error && (
        <Alert
          role="alert"
          severity="error"
          sx={{ mt: 1, fontSize: 12, whiteSpace: 'pre-wrap' }}
          action={jobRunner.errorCode === 'NO_PATIENT_RELATIONSHIP' ? (
            <Button color="inherit" size="small" onClick={() => setDutyDialogOpen(true)}>
              Add duty relationship
            </Button>
          ) : undefined}
        >
          {jobRunner.error}
        </Alert>
      )}

      <AmbientDiagnosticsPanel diagLog={diagLog} showDiag={showDiag} onToggle={() => setShowDiag((v) => !v)} />

      {jobRunner.result && (
        <AmbientAiResultPanel
          result={jobRunner.result}
          showResult={jobRunner.showResult}
          resultTab={jobRunner.resultTab}
          onResultTabChange={jobRunner.setResultTab}
          onCollapse={() => jobRunner.setShowResult(false)}
          onUseNote={onTranscriptReady}
        />
      )}

      {jobRunner.result && !jobRunner.showResult && (
        <Button
          size="small"
          variant="text"
          onClick={() => jobRunner.setShowResult(true)}
          startIcon={<ExpandMoreIcon />}
          sx={{ mt: 0.5, fontSize: 11, textTransform: 'none', color: '#327C8D' }}
        >
          Show AI Result
        </Button>
      )}

      <AmbientScribeConsentDialog open={consentOpen} onClose={() => setConsentOpen(false)} onConfirm={handleConsent} />
      <DutyRelationshipDialog
        open={dutyDialogOpen}
        patientId={patientId ?? ''}
        onClose={() => setDutyDialogOpen(false)}
        onCreated={() => {
          setDutyDialogOpen(false);
          void handlePrimaryClick();
        }}
      />
    </>
  );
}
