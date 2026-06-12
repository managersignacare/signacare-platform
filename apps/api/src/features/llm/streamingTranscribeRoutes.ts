/**
 * Streaming Transcription — Real-time audio-to-text
 *
 * POST /api/v1/scribe/stream-chunk   — Send an audio chunk, get partial transcript
 * POST /api/v1/scribe/stream-final   — Send final chunk + get complete transcript
 *
 * The frontend records audio in 5-second chunks using MediaRecorder,
 * sends each chunk for transcription, and displays results progressively.
 */

import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { authMiddleware } from '../../middleware/authMiddleware';
import { requireModuleRead } from '../../middleware/moduleAccessMiddleware';
import { requireClinicModuleEnabled } from '../../middleware/clinicModuleMiddleware';
import { requireFeatureEnabled } from '../../middleware/featureFlagMiddleware';
import { MODULE_KEYS } from '../../shared/moduleKeys';
import multer from 'multer';
import { logger } from '../../utils/logger';
import { uploadLimiter } from '../../middleware/rateLimiters';

const router = Router();
router.use(authMiddleware);
// Gated behind the 'medical-scribe' module grant — streaming
// transcription is the same clinical feature as /scribe/* but
// split across two route files for historical reasons.
router.use(requireModuleRead(MODULE_KEYS.MEDICAL_SCRIBE));
router.use(requireClinicModuleEnabled(MODULE_KEYS.MEDICAL_SCRIBE));
// Audit Tier 5.1 — stream transcription shares the `ai-scribe`
// kill switch with the main scribe router.
router.use(requireFeatureEnabled('ai-scribe'));

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 50 * 1024 * 1024 } }); // 50MB max per chunk

function whisperUrl(): string {
  return process.env.WHISPER_API_URL ?? 'http://localhost:8080';
}

function summarizeWhisperError(err: unknown): {
  message: string;
  status?: number;
  upstreamError?: string;
  isChunkDecodeFailure: boolean;
} {
  const e = err as {
    message?: unknown;
    response?: { status?: unknown; data?: { error?: unknown; message?: unknown } };
  };
  const message = typeof e?.message === 'string' ? e.message : String(err);
  const status = typeof e?.response?.status === 'number' ? e.response.status : undefined;
  const upstreamError =
    typeof e?.response?.data?.error === 'string'
      ? e.response.data.error
      : typeof e?.response?.data?.message === 'string'
        ? e.response.data.message
        : undefined;
  const haystack = `${message}\n${upstreamError ?? ''}`;
  const isChunkDecodeFailure = /EBML header parsing failed|Invalid data found when processing input|unknown-length element/i.test(haystack);

  return { message, status, upstreamError, isChunkDecodeFailure };
}

const StreamChunkBodySchema = z.object({
  chunkIndex: z.coerce.number().int().min(0).max(100_000).default(0),
  sessionId: z.string().max(128).optional(),
});

const StreamChunkDecodeDegradedResponseSchema = z.object({
  chunkIndex: z.number().int().nonnegative(),
  transcript: z.literal(''),
  sessionId: z.string(),
  degradedMode: z.literal(true),
  code: z.literal('SCRIBE_PARTIAL_CHUNK_NOT_DECODABLE'),
  message: z.string(),
});

const StreamFinalBodySchema = z.object({
  sessionId: z.string().max(128).optional(),
  existingTranscript: z.string().max(200_000).optional(),
});

// ── Transcribe a single audio chunk ──
router.post('/stream-chunk', uploadLimiter, upload.single('audio'), async (req: Request, res: Response) => {
  if (!req.file) {
    // @error-envelope-exempt: chunk upload route uses lightweight immediate transport errors for recorder retry UX.
    // @response-shape-exempt: stream endpoint returns transport-level payload (not clinical domain resource).
    res.status(400).json({ error: 'No audio file provided' });
    return;
  }

  const dto = StreamChunkBodySchema.parse(req.body ?? {});
  const chunkIndex = dto.chunkIndex;
  const sessionId = dto.sessionId ?? '';

  try {
    // Forward to Whisper server
    const FormData = (await import('form-data')).default;
    const fd = new FormData();
    fd.append('file', req.file.buffer, {
      filename: `chunk_${chunkIndex}.webm`,
      contentType: req.file.mimetype || 'audio/webm',
      knownLength: req.file.size,
    });
    fd.append('language', 'en');

    const axios = (await import('axios')).default;
    const whisperResp = await axios.post(`${whisperUrl()}/inference`, fd, {
      headers: fd.getHeaders(),
      timeout: 30_000,
    });

    const transcript = whisperResp.data?.transcript ?? whisperResp.data?.text ?? '';

    logger.info({ sessionId, chunkIndex, chars: transcript.length }, 'Stream chunk transcribed');

    res.json({
      chunkIndex,
      transcript: transcript.trim(),
      sessionId,
    });
  } catch (err) {
    const failure = summarizeWhisperError(err);
    logger.warn({
      message: failure.message,
      status: failure.status,
      upstreamError: failure.upstreamError,
      isChunkDecodeFailure: failure.isChunkDecodeFailure,
      chunkIndex,
      sessionId,
    }, 'Stream chunk transcription unavailable; continuing without live partial transcript');

    if (failure.isChunkDecodeFailure) {
      res.status(202).json(StreamChunkDecodeDegradedResponseSchema.parse({
        chunkIndex,
        transcript: '',
        sessionId,
        degradedMode: true,
        code: 'SCRIBE_PARTIAL_CHUNK_NOT_DECODABLE',
        message: 'Browser MediaRecorder chunk is not independently decodable; final full-recording transcription will still run.',
      }));
      return;
    }

    // @error-envelope-exempt: degraded-mode transport contract for client recovery. @response-shape-exempt: stream route returns retry metadata, not a domain DTO.
    res.status(503).json({
      code: 'SCRIBE_PARTIAL_UNAVAILABLE',
      message: failure.message,
      degradedMode: true,
      recovery: {
        sessionId,
        chunkIndex,
        retryRecommended: true,
      },
    });
  }
});

// ── Finalise streaming session — process any remaining audio ──
router.post('/stream-final', uploadLimiter, upload.single('audio'), async (req: Request, res: Response, _next: NextFunction) => {
  const dto = StreamFinalBodySchema.parse(req.body ?? {});
  const sessionId = dto.sessionId ?? '';
  const existingTranscript = dto.existingTranscript ?? '';

  let finalChunkText = '';
  let degradedMode = false;

  if (req.file) {
    try {
      const FormData = (await import('form-data')).default;
      const fd = new FormData();
      fd.append('file', req.file.buffer, {
        filename: 'final_chunk.webm',
        contentType: req.file.mimetype || 'audio/webm',
        knownLength: req.file.size,
      });
      fd.append('language', 'en');

      const axios = (await import('axios')).default;
      const whisperResp = await axios.post(`${whisperUrl()}/inference`, fd, {
        headers: fd.getHeaders(),
        timeout: 60_000,
      });

      finalChunkText = (whisperResp.data?.transcript ?? whisperResp.data?.text ?? '').trim();
    } catch (finalErr) {
      logger.warn({ err: finalErr instanceof Error ? finalErr.message : String(finalErr), sessionId }, 'stream-final transcription failed; returning partial transcript');
      degradedMode = true;
    }
  }

  const fullTranscript = [existingTranscript, finalChunkText].filter(Boolean).join(' ').trim();

  logger.info({ sessionId, totalChars: fullTranscript.length }, 'Stream session finalised');

  res.json({
    transcript: fullTranscript,
    sessionId,
    complete: true,
    degradedMode,
    recovery: degradedMode ? {
      retryRecommended: true,
      fallback: 'use_existing_partial_transcript',
    } : null,
  });
});

export default router;
