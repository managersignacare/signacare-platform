/**
 * Phase 8 UI refactor — recorder lifecycle extraction from
 * AmbientAiRecorder.
 *
 * Responsibility: own the MediaRecorder + MediaStream + audio analyser
 * + waveform timer + (optional) ScribeStreamingClient lifecycle. The
 * scribe pipeline / job submission is intentionally NOT owned here —
 * that is a separate hook (useAmbientScribeJobRunner). The caller
 * passes an `onFinishedRecording` callback that receives the captured
 * audio Blob + mime + chunk count and decides how to process it.
 *
 * Behavior preserved 1:1 with the original AmbientAiRecorder logic:
 *  - identical media-request constraints (echoCancellation/noiseSuppression/autoGainControl)
 *  - identical MediaRecorder MIME preference list with fallback chain
 *  - identical OverconstrainedError → fallback `{ audio: true }` retry
 *  - identical drawWaveform RMS + paused-color rendering
 *  - identical timer cadence (1s tick) + cleanup on stop / pause / unmount
 *  - identical live-transcript streaming wiring (only enabled if
 *    `liveTranscriptEnabled === true`)
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { ScribeStreamingClient } from './scribeStreamingClient';

export interface RecorderError {
  code: 'permission-denied' | 'no-mic' | 'in-use' | 'constraints-failed' | 'unknown';
  message: string;
}

export interface FinishedRecordingPayload {
  audioBlob: Blob;
  mimeType: string;
  chunkCount: number;
  approximateDurationSeconds: number;
}

export interface UseAmbientRecorderControllerOptions {
  liveTranscriptEnabled: boolean;
  liveTranscriptBatchMs: number;
  /** Called when MediaRecorder.onstop fires and audio is ready for the pipeline. */
  onFinishedRecording: (payload: FinishedRecordingPayload) => Promise<void> | void;
  /** Optional diagnostics callback so the recorder can log lifecycle events. */
  onLog?: (msg: string) => void;
  /** Returns true if recording start should be aborted (callback for pre-flight). */
  onBeforeStart?: () => void;
}

export interface UseAmbientRecorderControllerReturn {
  recording: boolean;
  paused: boolean;
  duration: number;
  audioLevel: number;
  livePartialTranscript: string;
  canvasRef: React.MutableRefObject<HTMLCanvasElement | null>;
  resetLivePartialTranscript: () => void;
  /** Starts the recorder. Throws a RecorderError on permission/device failure. */
  start: () => Promise<void>;
  pause: () => void;
  resume: () => void;
  stop: () => void;
}

function parseGetUserMediaErrorName(err: unknown): string {
  if (typeof err === 'object' && err !== null && 'name' in err) {
    const name = (err as { name?: unknown }).name;
    return typeof name === 'string' ? name : '';
  }
  return '';
}

function pickMimeType(): string {
  return (['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/aac', ''] as const)
    .find((t) => t === '' || MediaRecorder.isTypeSupported(t)) ?? '';
}

function pickFallbackMimeType(): string {
  return (['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', ''] as const)
    .find((t) => t === '' || MediaRecorder.isTypeSupported(t)) ?? '';
}

export function useAmbientRecorderController(
  options: UseAmbientRecorderControllerOptions,
): UseAmbientRecorderControllerReturn {
  const { liveTranscriptEnabled, liveTranscriptBatchMs, onFinishedRecording, onLog, onBeforeStart } = options;

  const [recording, setRecording] = useState(false);
  const [paused, setPaused] = useState(false);
  const [duration, setDuration] = useState(0);
  const [audioLevel, setAudioLevel] = useState(0);
  const [livePartialTranscript, setLivePartialTranscript] = useState('');

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<number | null>(null);
  const animFrameRef = useRef<number | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const streamingClientRef = useRef<ScribeStreamingClient | null>(null);

  // Snapshot the latest callbacks/flags into refs so the long-lived
  // MediaRecorder.onstop closure always sees current values without
  // re-binding the recorder.
  const onFinishedRef = useRef(onFinishedRecording);
  const onLogRef = useRef(onLog);
  const liveTranscriptEnabledRef = useRef(liveTranscriptEnabled);
  const liveTranscriptBatchMsRef = useRef(liveTranscriptBatchMs);
  useEffect(() => {
    onFinishedRef.current = onFinishedRecording;
    onLogRef.current = onLog;
    liveTranscriptEnabledRef.current = liveTranscriptEnabled;
    liveTranscriptBatchMsRef.current = liveTranscriptBatchMs;
  }, [onFinishedRecording, onLog, liveTranscriptEnabled, liveTranscriptBatchMs]);

  useEffect(() => {
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
      if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);
      streamRef.current?.getTracks().forEach((t) => t.stop());
    };
  }, []);

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

  const createStreamingClient = useCallback((): ScribeStreamingClient | null => {
    if (!liveTranscriptEnabledRef.current) {
      return null;
    }

    setLivePartialTranscript('');
    return new ScribeStreamingClient({
      batchMs: liveTranscriptBatchMsRef.current,
      onPartial: (delta) => setLivePartialTranscript(delta.text),
      onError: (err) => onLogRef.current?.(`Live transcript error (non-fatal): ${err.message}`),
    });
  }, []);

  const start = useCallback(async () => {
    onBeforeStart?.();
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

      const mimeType = pickMimeType();
      const mediaRecorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
      chunksRef.current = [];

      streamingClientRef.current = createStreamingClient();

      mediaRecorder.ondataavailable = (e) => {
        if (e.data.size > 0) {
          chunksRef.current.push(e.data);
          streamingClientRef.current?.pushChunk(e.data, mediaRecorder.mimeType);
        }
      };

      mediaRecorder.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());
        streamRef.current = null;
        if (timerRef.current) {
          clearInterval(timerRef.current);
          timerRef.current = null;
        }
        if (animFrameRef.current) {
          cancelAnimationFrame(animFrameRef.current);
          animFrameRef.current = null;
        }
        setRecording(false);
        setPaused(false);

        if (streamingClientRef.current) {
          try {
            await streamingClientRef.current.finish();
          } catch {
            /* non-fatal */
          }
          streamingClientRef.current = null;
        }

        const recordedMime = mediaRecorder.mimeType || 'audio/webm';
        const audioBlob = new Blob(chunksRef.current, { type: recordedMime });
        const chunkCount = chunksRef.current.length;
        await onFinishedRef.current({
          audioBlob,
          mimeType: recordedMime,
          chunkCount,
          approximateDurationSeconds: chunkCount,
        });
        setDuration(0);
      };

      mediaRecorderRef.current = mediaRecorder;
      mediaRecorder.start(1000);
      setRecording(true);
      setPaused(false);
      setDuration(0);
      timerRef.current = window.setInterval(() => setDuration((d) => d + 1), 1000);
      onLogRef.current?.(`Recording started — MIME: ${mediaRecorder.mimeType || 'default'}, sampleRate: ${audioCtx.sampleRate}Hz`);
      drawWaveform();
    } catch (err: unknown) {
      const errName = parseGetUserMediaErrorName(err);
      if (errName === 'NotAllowedError' || errName === 'PermissionDeniedError') {
        throw {
          code: 'permission-denied' as const,
          message: 'Microphone access denied. Please allow microphone permission in your browser settings.',
        } satisfies RecorderError;
      }
      if (errName === 'NotFoundError' || errName === 'DevicesNotFoundError') {
        throw {
          code: 'no-mic' as const,
          message: 'No microphone found. Please connect a microphone.',
        } satisfies RecorderError;
      }
      if (errName === 'OverconstrainedError' || errName === 'ConstraintNotSatisfiedError') {
        try {
          const fallbackStream = await navigator.mediaDevices.getUserMedia({ audio: true });
          streamRef.current = fallbackStream;
          const audioCtx = new AudioContext();
          const source = audioCtx.createMediaStreamSource(fallbackStream);
          const analyser = audioCtx.createAnalyser();
          analyser.fftSize = 2048;
          source.connect(analyser);
          analyserRef.current = analyser;
          const fallbackMime = pickFallbackMimeType();
          const fallbackRecorder = new MediaRecorder(
            fallbackStream,
            fallbackMime ? { mimeType: fallbackMime } : undefined,
          );
          chunksRef.current = [];
          streamingClientRef.current = createStreamingClient();
          fallbackRecorder.ondataavailable = (e) => {
            if (e.data.size > 0) {
              chunksRef.current.push(e.data);
              streamingClientRef.current?.pushChunk(e.data, fallbackRecorder.mimeType);
            }
          };
          fallbackRecorder.onstop = mediaRecorderRef.current?.onstop ?? (() => {});
          mediaRecorderRef.current = fallbackRecorder;
          fallbackRecorder.start(1000);
          setRecording(true);
          setPaused(false);
          setDuration(0);
          timerRef.current = window.setInterval(() => setDuration((d) => d + 1), 1000);
          drawWaveform();
          return;
        } catch {
          throw {
            code: 'constraints-failed' as const,
            message: 'Microphone is unavailable with the requested settings. Please try a different browser or device.',
          } satisfies RecorderError;
        }
      }
      if (errName === 'NotReadableError' || errName === 'AbortError') {
        throw {
          code: 'in-use' as const,
          message: 'Microphone is in use by another application.',
        } satisfies RecorderError;
      }
      const fallbackMessage = typeof err === 'object' && err !== null && 'message' in err
        ? String((err as { message?: unknown }).message)
        : 'Unknown error';
      throw {
        code: 'unknown' as const,
        message: `Recording failed: ${fallbackMessage}`,
      } satisfies RecorderError;
    }
  }, [createStreamingClient, drawWaveform, onBeforeStart]);

  const pause = useCallback(() => {
    if (mediaRecorderRef.current?.state === 'recording') {
      mediaRecorderRef.current.pause();
      void streamingClientRef.current?.flushBuffer();
      setPaused(true);
      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
    }
  }, []);

  const resume = useCallback(() => {
    if (mediaRecorderRef.current?.state === 'paused') {
      mediaRecorderRef.current.resume();
      setPaused(false);
      timerRef.current = window.setInterval(() => setDuration((d) => d + 1), 1000);
    }
  }, []);

  const stop = useCallback(() => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      mediaRecorderRef.current.stop();
    }
  }, []);

  const resetLivePartialTranscript = useCallback(() => {
    setLivePartialTranscript('');
  }, []);

  return {
    recording,
    paused,
    duration,
    audioLevel,
    livePartialTranscript,
    canvasRef,
    resetLivePartialTranscript,
    start,
    pause,
    resume,
    stop,
  };
}
