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
import fs from 'fs';
import os from 'os';
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

const upload = multer({ dest: os.tmpdir(), limits: { fileSize: 50 * 1024 * 1024 } }); // 50MB max per chunk

function whisperUrl(): string {
  return process.env.WHISPER_API_URL ?? 'http://localhost:8080';
}

const StreamChunkBodySchema = z.object({
  chunkIndex: z.coerce.number().int().min(0).max(100_000).default(0),
  sessionId: z.string().max(128).optional(),
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

  // Declared outside try so the catch block can destroy it on error.
  let chunkStream: fs.ReadStream | undefined;
  try {
    // Forward to Whisper server
    const FormData = (await import('form-data')).default;
    const fd = new FormData();
    chunkStream = fs.createReadStream(req.file.path);
    chunkStream.on('error', (streamErr) => logger.error({ err: streamErr }, 'Read stream error in stream-chunk'));
    fd.append('audio', chunkStream, {
      filename: `chunk_${chunkIndex}.webm`,
      contentType: req.file.mimetype || 'audio/webm',
    });

    const axios = (await import('axios')).default;
    const whisperResp = await axios.post(`${whisperUrl()}/transcribe`, fd, {
      headers: fd.getHeaders(),
      timeout: 30_000,
    });

    const transcript = whisperResp.data?.transcript ?? whisperResp.data?.text ?? '';

    // Clean up temp file — log any unlink error so operators can detect
    // filesystem issues, but don't block the response.
    fs.unlink(req.file.path, (unlinkErr) => {
      if (unlinkErr) logger.warn({ err: unlinkErr, path: req.file?.path }, 'Failed to remove chunk temp file');
    });

    logger.info({ sessionId, chunkIndex, chars: transcript.length }, 'Stream chunk transcribed');

    res.json({
      chunkIndex,
      transcript: transcript.trim(),
      sessionId,
    });
  } catch (err) {
    // CRITICAL: destroy the read stream if it's still open. Without this,
    // a whisper-server failure leaks a file descriptor until GC runs.
    if (chunkStream && !chunkStream.destroyed) chunkStream.destroy();

    // Clean up temp file on error
    if (req.file?.path) {
      fs.unlink(req.file.path, (unlinkErr) => {
        if (unlinkErr) logger.warn({ err: unlinkErr, path: req.file?.path }, 'Failed to remove chunk temp file after error');
      });
    }

    const message = err instanceof Error ? err.message : String(err);
    logger.error({ err, message, chunkIndex }, 'Stream chunk transcription failed');
    // @error-envelope-exempt: degraded-mode transport contract for client recovery. @response-shape-exempt: stream route returns retry metadata, not a domain DTO.
    res.status(503).json({
      code: 'SCRIBE_PARTIAL_UNAVAILABLE',
      message,
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
    let finalStream: fs.ReadStream | undefined;
    try {
      const FormData = (await import('form-data')).default;
      const fd = new FormData();
      finalStream = fs.createReadStream(req.file.path);
      finalStream.on('error', (streamErr) => logger.error({ err: streamErr }, 'Read stream error in stream-final'));
      fd.append('audio', finalStream, {
        filename: 'final_chunk.webm',
        contentType: req.file.mimetype || 'audio/webm',
      });

      const axios = (await import('axios')).default;
      const whisperResp = await axios.post(`${whisperUrl()}/transcribe`, fd, {
        headers: fd.getHeaders(),
        timeout: 60_000,
      });

      finalChunkText = (whisperResp.data?.transcript ?? whisperResp.data?.text ?? '').trim();
      fs.unlink(req.file.path, (unlinkErr) => {
        if (unlinkErr) logger.warn({ err: unlinkErr, path: req.file?.path }, 'Failed to remove final temp file');
      });
    } catch (finalErr) {
      // CRITICAL: destroy stream on error (see stream-chunk for rationale)
      if (finalStream && !finalStream.destroyed) finalStream.destroy();
      if (req.file?.path) {
        fs.unlink(req.file.path, (unlinkErr) => {
          if (unlinkErr) logger.warn({ err: unlinkErr, path: req.file?.path }, 'Failed to remove final temp file after error');
        });
      }
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
