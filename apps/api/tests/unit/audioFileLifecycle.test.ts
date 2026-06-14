/**
 * Audio upload lifecycle verification.
 *
 * The original implementation wrote streamed chunks to disk and had to
 * `fs.unlink(req.file.path, ...)` on every path. The current route uses
 * `multer.memoryStorage()` and forwards `req.file.buffer` directly to
 * Whisper, which is the stricter privacy posture: no temp audio file is
 * ever created, so there is nothing to delete.
 *
 * These tests now pin that stronger invariant and fail loudly if a future
 * refactor regresses back to disk-backed temp files without an explicit
 * decision.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const STREAMING_ROUTE_PATH = join(
  __dirname, '..', '..', 'src', 'features', 'llm', 'streamingTranscribeRoutes.ts',
);

describe('Audio file lifecycle (memory-only transcription transport)', () => {
  it('streamingTranscribeRoutes.ts file exists', () => {
    expect(() => readFileSync(STREAMING_ROUTE_PATH, 'utf8')).not.toThrow();
  });

  describe('/stream-chunk route — in-memory upload handling', () => {
    const src = readFileSync(STREAMING_ROUTE_PATH, 'utf8');

    it('uses multer.memoryStorage and forwards req.file.buffer to Whisper', () => {
      const match = src.match(/router\.post\(['"]\/stream-chunk['"][\s\S]+?\n\}\);/);
      expect(match).toBeTruthy();
      const handler = match![0];
      expect(src).toMatch(/multer\.memoryStorage\(\)/);
      expect(handler).toMatch(/fd\.append\('file', req\.file\.buffer,/);
    });

    it('never references req.file.path or fs.unlink because no disk temp file exists', () => {
      const match = src.match(/router\.post\(['"]\/stream-chunk['"][\s\S]+?\n\}\);/);
      expect(match).toBeTruthy();
      const handler = match![0];
      expect(handler).not.toMatch(/req\.file\.path/);
      expect(handler).not.toMatch(/fs\.unlink/);
    });
  });

  describe('/stream-final route — in-memory upload handling', () => {
    const src = readFileSync(STREAMING_ROUTE_PATH, 'utf8');

    it('reuses the same memory-only transport for the final chunk', () => {
      const match = src.match(/router\.post\(['"]\/stream-final['"][\s\S]+?\n\}\);/);
      expect(match).toBeTruthy();
      const handler = match![0];
      expect(handler).toMatch(/fd\.append\('file', req\.file\.buffer,/);
      expect(handler).not.toMatch(/req\.file\.path/);
      expect(handler).not.toMatch(/fs\.unlink/);
    });
  });

  describe('Whisper HTTP contract', () => {
    const src = readFileSync(STREAMING_ROUTE_PATH, 'utf8');

    it('uses the deployed Whisper /inference endpoint and "file" multipart field', () => {
      // deploy/whisper-server/server.py exposes POST /inference and
      // requires multipart field "file". The stale /transcribe + "audio"
      // shape returns 404 in Azure and degrades Ambient AI streaming.
      expect(src).toMatch(/whisperUrl\(\)}\/inference/);
      expect(src).not.toMatch(/whisperUrl\(\)}\/transcribe/);
      expect(src).toMatch(/fd\.append\('file'/);
      expect(src).not.toMatch(/fd\.append\('audio'/);
    });

    it('treats undecodable MediaRecorder chunks as degraded live-preview failures', () => {
      expect(src).toMatch(/SCRIBE_PARTIAL_CHUNK_NOT_DECODABLE/);
      expect(src).toMatch(/summarizeWhisperError/);
      expect(src).not.toMatch(/logger\.error\(\{\s*err,\s*message,\s*chunkIndex\s*\}/);
    });
  });

  describe('Regression guard: no deferred temp-file cleanup', () => {
    const src = readFileSync(STREAMING_ROUTE_PATH, 'utf8');

    it('does not introduce deferred file cleanup hooks because files stay in memory', () => {
      expect(src).not.toMatch(/setTimeout\([^,]*fs\.unlink/);
      expect(src).not.toMatch(/setImmediate\([^,]*fs\.unlink/);
    });
  });
});
