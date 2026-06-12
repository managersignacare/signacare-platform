import { z } from 'zod';
import {
  AMBIENT_LONG_RECORDING_TARGET_MINUTES,
  ambientAudioMaxBytes,
  formatAmbientBytes,
} from '../../shared/ambientScribeConfig';

export const AmbientAudioTooLargeResponseSchema = z.object({
  error: z.string(),
  code: z.literal('AUDIO_TOO_LARGE'),
  targetMinutes: z.number().int().positive(),
});

export const AmbientProcessingTimeoutResponseSchema = z.object({
  error: z.string(),
  code: z.literal('PROCESSING_TIMEOUT'),
  targetMinutes: z.number().int().positive(),
});

export function buildAmbientAudioTooLargeResponse(): {
  error: string;
  code: 'AUDIO_TOO_LARGE';
  targetMinutes: number;
} {
  return {
    error: `Recording is too large for the current synchronous upload path. Maximum accepted size is ${formatAmbientBytes(ambientAudioMaxBytes())}.`,
    code: 'AUDIO_TOO_LARGE',
    targetMinutes: AMBIENT_LONG_RECORDING_TARGET_MINUTES,
  };
}

export function buildAmbientProcessingTimeoutResponse(): {
  error: string;
  code: 'PROCESSING_TIMEOUT';
  targetMinutes: number;
} {
  return {
    error: `Processing timed out. The current synchronous scribe path is capped below Azure App Service request limits. ${AMBIENT_LONG_RECORDING_TARGET_MINUTES}-minute psychiatric interviews require the async scribe job workflow.`,
    code: 'PROCESSING_TIMEOUT',
    targetMinutes: AMBIENT_LONG_RECORDING_TARGET_MINUTES,
  };
}
