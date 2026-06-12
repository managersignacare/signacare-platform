import { resolvePositiveIntEnv } from './positiveIntEnv';

const MIB = 1024 * 1024;

export const AMBIENT_LONG_RECORDING_TARGET_MINUTES = 60;
export const DEFAULT_AMBIENT_HTTP_TIMEOUT_MS = 210 * 1000;
export const DEFAULT_AMBIENT_WHISPER_TIMEOUT_MS = 210 * 1000;
export const DEFAULT_AMBIENT_OLLAMA_TIMEOUT_MS = 180 * 1000;
export const DEFAULT_AMBIENT_OLLAMA_NUM_PREDICT = 2048;
export const DEFAULT_AMBIENT_AUDIO_MAX_BYTES = 64 * MIB;
export const DEFAULT_AMBIENT_TRANSCRIPT_CHUNK_CHARS = 16_000;

export function parsePositiveIntEnv(
  name: string,
  fallback: number,
  max: number,
  env: NodeJS.ProcessEnv = process.env,
): number {
  return resolvePositiveIntEnv(name, {
    env,
    fallback,
    max,
    loggerContext: { configSurface: 'ambient_scribe' },
  });
}

export function ambientHttpTimeoutMs(): number {
  return parsePositiveIntEnv('AMBIENT_HTTP_TIMEOUT_MS', DEFAULT_AMBIENT_HTTP_TIMEOUT_MS, 90 * 60 * 1000);
}

export function ambientWhisperTimeoutMs(): number {
  return parsePositiveIntEnv('AMBIENT_WHISPER_TIMEOUT_MS', DEFAULT_AMBIENT_WHISPER_TIMEOUT_MS, 120 * 60 * 1000);
}

export function ambientOllamaTimeoutMs(): number {
  return parsePositiveIntEnv('AMBIENT_OLLAMA_TIMEOUT_MS', DEFAULT_AMBIENT_OLLAMA_TIMEOUT_MS, 30 * 60 * 1000);
}

export function ambientOllamaNumPredict(): number {
  return parsePositiveIntEnv('AMBIENT_OLLAMA_NUM_PREDICT', DEFAULT_AMBIENT_OLLAMA_NUM_PREDICT, 4096);
}

export function ambientAudioMaxBytes(): number {
  return parsePositiveIntEnv('AMBIENT_AUDIO_MAX_BYTES', DEFAULT_AMBIENT_AUDIO_MAX_BYTES, 1024 * MIB);
}

export function ambientTranscriptChunkChars(): number {
  return parsePositiveIntEnv(
    'AMBIENT_TRANSCRIPT_CHUNK_CHARS',
    DEFAULT_AMBIENT_TRANSCRIPT_CHUNK_CHARS,
    40_000,
  );
}

export function formatAmbientBytes(bytes: number): string {
  if (bytes >= MIB) return `${Math.round(bytes / MIB)} MB`;
  return `${Math.round(bytes / 1024)} KB`;
}
