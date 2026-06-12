/**
 * Phase 8 UI refactor — async job submission / polling / recovery
 * extraction from AmbientAiRecorder.
 *
 * Responsibility: once a recording has finished, decide whether to
 * route the audio through the sync or async ambient-scribe pipeline,
 * submit the job, poll for progress, apply the result, and translate
 * pipeline errors into user-facing messages. The recorder lifecycle
 * is intentionally NOT owned here — that is `useAmbientRecorderController`.
 *
 * Behavior preserved 1:1 with the original AmbientAiRecorder logic:
 *  - identical async/sync routing via VITE_SCRIBE_ASYNC_AMBIENT env +
 *    VITE_SCRIBE_ASYNC_AMBIENT_MIN_SECONDS threshold
 *  - identical AmbientNoteJobTimeoutError handling (does NOT cancel
 *    the server-side job; user can recover via the Async Scribe Jobs
 *    Dashboard)
 *  - identical error-cascade messaging (WHISPER_RESTARTING, NO_SPEECH,
 *    AUDIO_DECODE_FAILED, LLM_UNAVAILABLE, ECONNREFUSED, 413, 429, 403)
 *  - identical degraded-output gate: when isDegradedAmbientResult is
 *    true, the structured note is NEVER auto-inserted into the editor;
 *    transcript fallback is only when the structured note is empty AND
 *    the result is not degraded
 *  - identical lastAsyncProgressLogRef dedup so we don't spam the diag log
 */
import { useCallback, useRef, useState } from 'react';
import { SignacareApiError } from '../../../../shared/services/apiClient';
import {
  AmbientNoteJobTimeoutError,
  llmAmbientApi,
  type AmbientAiJobStatus,
  type AmbientFormat,
} from '../../../../shared/services/llmAmbientApi';
import type { AmbientNoteResult } from '../../../../shared/types/llmTypes';
import { buildNoteText } from './ambientRecorderViewParts';
import { isDegradedAmbientResult } from './ambientRecorderResultUtils';
import type { FinishedRecordingPayload } from './useAmbientRecorderController';

const ASYNC_AMBIENT_ENV_ENABLED =
  (import.meta.env.VITE_SCRIBE_ASYNC_AMBIENT ?? 'true').toLowerCase() !== 'false';

const ASYNC_AMBIENT_MIN_SECONDS = (() => {
  const parsed = Number.parseInt(String(import.meta.env.VITE_SCRIBE_ASYNC_AMBIENT_MIN_SECONDS ?? '180'), 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 180;
})();

export function formatAsyncProgress(status: AmbientAiJobStatus | null): string {
  if (!status) return '';
  const progress = typeof status.progress === 'number' ? ` (${status.progress}%)` : '';
  return `${status.status}${progress}${status.stage ? ` — ${status.stage}` : ''}`;
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

type ValidationDetail = {
  field?: unknown;
  message?: unknown;
};

export function formatAmbientValidationError(err: unknown): string | null {
  if (!(err instanceof SignacareApiError) || err.code !== 'VALIDATION_ERROR') return null;
  const details = err.details as unknown;
  if (Array.isArray(details) && details.length > 0) {
    const first = details[0] as ValidationDetail;
    const field = typeof first.field === 'string' && first.field.trim().length > 0
      ? first.field.trim()
      : null;
    const message = typeof first.message === 'string' && first.message.trim().length > 0
      ? first.message.trim()
      : null;
    if (field && message) {
      return `Ambient AI request validation failed for ${field}: ${message}`;
    }
    if (message) {
      return `Ambient AI request validation failed: ${message}`;
    }
  }
  return err.message || 'Ambient AI request validation failed. Please restart the recording and try again.';
}

export interface UseAmbientScribeJobRunnerOptions {
  patientId?: string;
  onTranscriptReady: (soapNote: string) => void;
  onResultReady?: (result: AmbientNoteResult) => void;
  onLog: (msg: string) => void;
}

export interface UseAmbientScribeJobRunnerReturn {
  processing: boolean;
  asyncJobStatus: AmbientAiJobStatus | null;
  result: AmbientNoteResult | null;
  showResult: boolean;
  resultTab: number;
  error: string;
  errorCode: string | null;
  setShowResult: (next: boolean) => void;
  setResultTab: (next: number) => void;
  setError: (next: string) => void;
  setAsyncJobStatus: (next: AmbientAiJobStatus | null) => void;
  resetForNewRecording: () => void;
  /** Routes a finished recording through the scribe pipeline. */
  processFinishedRecording: (
    payload: FinishedRecordingPayload,
    ambientOptions: {
      format: AmbientFormat;
      interpreterUsed: boolean;
      interpreterLanguage: string;
      consentId: string;
    },
  ) => Promise<void>;
  /** Apply an already-resolved AmbientNoteResult (e.g. dashboard recovery). */
  applyAmbientResult: (ambientResult: AmbientNoteResult, elapsedSeconds?: string) => boolean;
}

export function useAmbientScribeJobRunner(
  options: UseAmbientScribeJobRunnerOptions,
): UseAmbientScribeJobRunnerReturn {
  const { patientId, onTranscriptReady, onResultReady, onLog } = options;

  const [processing, setProcessing] = useState(false);
  const [asyncJobStatus, setAsyncJobStatus] = useState<AmbientAiJobStatus | null>(null);
  const [result, setResult] = useState<AmbientNoteResult | null>(null);
  const [showResult, setShowResult] = useState(false);
  const [resultTab, setResultTab] = useState(0);
  const [error, setError] = useState('');
  const [errorCode, setErrorCode] = useState<string | null>(null);

  const lastAsyncProgressLogRef = useRef('');
  const onLogRef = useRef(onLog);
  const onTranscriptReadyRef = useRef(onTranscriptReady);
  const onResultReadyRef = useRef(onResultReady);
  onLogRef.current = onLog;
  onTranscriptReadyRef.current = onTranscriptReady;
  onResultReadyRef.current = onResultReady;

  const applyAmbientResult = useCallback(
    (ambientResult: AmbientNoteResult, elapsedSeconds?: string): boolean => {
      const log = onLogRef.current;
      log(
        elapsedSeconds
          ? `Pipeline complete in ${elapsedSeconds}s — model: ${ambientResult.model}, pipeline: ${ambientResult.pipeline}`
          : `Recovered async scribe output — model: ${ambientResult.model}, pipeline: ${ambientResult.pipeline}`,
      );
      log(`Transcript: ${ambientResult.transcript?.length ?? 0} chars`);
      log(
        `Whisper: ${ambientResult.transcriptionDurationMs ? (ambientResult.transcriptionDurationMs / 1000).toFixed(1) + 's' : 'n/a'}`,
      );
      log(`Pass 1 (extract): ${ambientResult.pass1DurationMs ? (ambientResult.pass1DurationMs / 1000).toFixed(1) + 's' : 'n/a'}`);
      log(`Pass 2 (safety): ${ambientResult.pass2DurationMs ? (ambientResult.pass2DurationMs / 1000).toFixed(1) + 's' : 'n/a'}`);
      log(`Pass 3 (format): ${ambientResult.pass3DurationMs ? (ambientResult.pass3DurationMs / 1000).toFixed(1) + 's' : 'n/a'}`);
      const degradedOutput = isDegradedAmbientResult(ambientResult);
      if (degradedOutput) {
        log('WARNING: AI output is degraded/review-only — transcript will not be inserted into the note editor.');
      }
      log(
        `Quality: ${ambientResult.quality?.overallConfidence ?? '?'}% confidence, ${ambientResult.quality?.sectionsWithEvidence ?? 0}/${ambientResult.quality?.sectionsTotal ?? 0} sections`,
      );
      log(
        `Safety: ${ambientResult.safetyAlerts?.length ?? 0} alerts, Risk: ${ambientResult.riskAssessment?.overallLevel ?? 'n/a'}, Meds verified: ${ambientResult.verifiedMedications?.length ?? 0}`,
      );

      const noteText = buildNoteText(ambientResult);
      if (!noteText.trim() && !ambientResult.transcript?.trim()) {
        log('ERROR: Empty output — no transcript and no structured note');
        setErrorCode(null);
        setError('No speech was detected in the recording. Please try again with a longer recording closer to the microphone.');
        return false;
      }

      log(
        degradedOutput
          ? `Review-only output: ${noteText.length} chars — use transcript/manual-note workflow`
          : `Output note: ${noteText.length} chars — ready for review`,
      );
      setResult(ambientResult);
      setShowResult(true);
      onResultReadyRef.current?.(ambientResult);

      if (degradedOutput) {
        // Clinical-safety gate: degraded/model-fallback output is visible
        // for review but never auto-inserted into the editable note.
      } else if (noteText.trim()) {
        onTranscriptReadyRef.current(noteText);
      } else if (ambientResult.transcript?.trim()) {
        log('WARNING: Structured note empty, falling back to raw transcript');
        onTranscriptReadyRef.current(`TRANSCRIPT (requires structuring):\n${ambientResult.transcript.trim()}`);
      }
      return true;
    },
    [],
  );

  const resetForNewRecording = useCallback(() => {
    setError('');
    setErrorCode(null);
    setResult(null);
    setAsyncJobStatus(null);
    setShowResult(false);
    lastAsyncProgressLogRef.current = '';
  }, []);

  const processFinishedRecording = useCallback(
    async (
      payload: FinishedRecordingPayload,
      ambientOptions: {
        format: AmbientFormat;
        interpreterUsed: boolean;
        interpreterLanguage: string;
        consentId: string;
      },
    ): Promise<void> => {
      const log = onLogRef.current;
      setProcessing(true);
      try {
        log(`Recording stopped — ${payload.chunkCount} chunks, ${(payload.audioBlob.size / 1024).toFixed(0)}KB, type: ${payload.audioBlob.type}`);

        if (payload.audioBlob.size < 1000) {
          log(`ERROR: Audio too small (${payload.audioBlob.size} bytes) — aborting`);
          setErrorCode(null);
          setError('Recording too short. Please record at least a few seconds of audio.');
          return;
        }

        if (!patientId) {
          throw new Error('Ambient recording requires patient context and recording consent. Please retry.');
        }

        const t0 = Date.now();
        const builtOptions = {
          format: ambientOptions.format,
          interpreterUsed: ambientOptions.interpreterUsed || undefined,
          interpreterLanguage: ambientOptions.interpreterLanguage || undefined,
          patientId,
          consentId: ambientOptions.consentId,
        };

        const useAsyncAmbient =
          ASYNC_AMBIENT_ENV_ENABLED && payload.approximateDurationSeconds >= ASYNC_AMBIENT_MIN_SECONDS;
        let ambientResult: AmbientNoteResult;

        if (useAsyncAmbient) {
          log(`Queueing async Medical-Grade Scribe job — estimated ${payload.approximateDurationSeconds}s recording`);
          const queued = await llmAmbientApi.queueAmbientNote(payload.audioBlob, builtOptions);
          setAsyncJobStatus({
            jobId: queued.jobId,
            action: queued.action,
            status: queued.status,
            statusMessage: queued.message,
          });
          log(`Async scribe job queued — ${queued.jobId}`);
          ambientResult = await llmAmbientApi.waitForAmbientNoteJob(queued.jobId, {
            onProgress: (status) => {
              setAsyncJobStatus(status);
              const progressLine = `Async job ${status.jobId}: ${formatAsyncProgress(status)}${status.statusMessage ? ` — ${status.statusMessage}` : ''}`;
              if (progressLine !== lastAsyncProgressLogRef.current) {
                lastAsyncProgressLogRef.current = progressLine;
                log(progressLine);
              }
            },
          });
        } else {
          log('Sending to Medical-Grade Scribe pipeline (3-pass)...');
          ambientResult = await llmAmbientApi.generateAmbientNote(payload.audioBlob, builtOptions);
        }
        const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
        applyAmbientResult(ambientResult, elapsed);
      } catch (err: unknown) {
        const parsed = parseAmbientApiError(err);
        const status = parsed.status;
        const apiError = parsed.apiError;
        const apiCode = parsed.apiCode;
        const axiosMsg = parsed.message ?? '';
        const msg = apiError ?? axiosMsg ?? 'Unknown error';

        log(`ERROR: [${status ?? 'no status'}] ${apiCode ?? ''} ${msg}`);

        if (err instanceof AmbientNoteJobTimeoutError) {
          setErrorCode(null);
          setError(
            `The async scribe job is still processing after the browser polling window. Job ID: ${err.jobId}. The server-side job has not been cancelled; use the Async Scribe Jobs Dashboard below to refresh or recover the output later.`,
          );
        } else if (axiosMsg === 'Network Error' || axiosMsg.includes('ERR_NETWORK')) {
          setErrorCode(null);
          setError('Could not connect to the API server. Check that it is running on port 4000.');
        } else if (status === 429) {
          setErrorCode(apiCode ?? null);
          setError('AI rate limit reached. Please wait a minute and try again.');
        } else if (status === 403) {
          setErrorCode(apiCode ?? null);
          setError(`Request blocked: ${msg}. Try refreshing the page.`);
        } else if (apiCode === 'WHISPER_RESTARTING' || apiCode === 'WHISPER_UNREACHABLE' || msg.includes('ECONNREFUSED')) {
          setErrorCode(apiCode ?? null);
          setError('Whisper server was not running and is now starting. Please wait 15-20 seconds and try again.');
        } else if (apiCode === 'PROCESSING_TIMEOUT' || msg.includes('timeout')) {
          setErrorCode(apiCode ?? null);
          setError('Processing timed out. This synchronous staging scribe path is capped for short clips. Hour-long psychiatric interviews require the async scribe job workflow with saved progress and polling.');
        } else if (apiCode === 'AUDIO_TOO_LARGE' || status === 413) {
          setErrorCode(apiCode ?? null);
          setError(`Recording upload is too large for the current staging path. ${msg}`);
        } else if (apiCode === 'NO_SPEECH') {
          setErrorCode(apiCode);
          setError('No speech detected in the recording. Please speak clearly and try again.');
        } else if (apiCode === 'AUDIO_DECODE_FAILED') {
          setErrorCode(apiCode);
          setError('The recording could not be decoded. Please retry with a shorter clip; if this repeats, refresh the page and try again.');
        } else if (apiCode === 'LLM_UNAVAILABLE') {
          setErrorCode(apiCode);
          setError('AI model is not available. Ensure Ollama is running (ollama serve).');
        } else if (apiCode === 'VALIDATION_ERROR') {
          setErrorCode(apiCode);
          setError(formatAmbientValidationError(err) ?? 'Ambient AI request validation failed. Please restart the recording and try again.');
        } else {
          setErrorCode(apiCode ?? null);
          setError(`Ambient AI error: ${msg}`);
        }
      } finally {
        setProcessing(false);
      }
    },
    [applyAmbientResult, patientId],
  );

  return {
    processing,
    asyncJobStatus,
    result,
    showResult,
    resultTab,
    error,
    errorCode,
    setShowResult,
    setResultTab,
    setError,
    setAsyncJobStatus,
    resetForNewRecording,
    processFinishedRecording,
    applyAmbientResult,
  };
}
