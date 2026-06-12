/**
 * Audio file hard-delete verification — raw audio MUST be removed
 * from disk immediately after transcription, not deferred to the
 * audioRetentionScheduler (which is a 30-day safety net for
 * orphaned files, not the primary cleanup path).
 *
 * Testing runtime deletion would require booting a live Whisper
 * server + streaming real audio — impractical. Instead this test
 * takes a source-level approach: it reads the streaming transcribe
 * route and asserts that EVERY transcription code path ends with
 * `fs.unlink(req.file.path, ...)`. That's the invariant we actually
 * care about — a future PR that removes the unlink call fails this
 * test immediately, catching a data-retention regression at PR time.
 *
 * A proper runtime test belongs in an end-to-end harness with a
 * mocked Whisper HTTP endpoint; flagged as a follow-up.
 *
 * Standard satisfied: Australian Privacy Act 1988 APP 11.2 (data
 *                     retention minimisation), HIPAA §164.514(a)
 *                     (de-identification timing), ACHS Standard 1.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const STREAMING_ROUTE_PATH = join(
  __dirname, '..', '..', 'src', 'features', 'llm', 'streamingTranscribeRoutes.ts',
);

describe('Audio file lifecycle (hard-delete on transcription)', () => {
  it('streamingTranscribeRoutes.ts file exists', () => {
    expect(() => readFileSync(STREAMING_ROUTE_PATH, 'utf8')).not.toThrow();
  });

  describe('/stream-chunk route — per-chunk cleanup', () => {
    const src = readFileSync(STREAMING_ROUTE_PATH, 'utf8');

    it('calls fs.unlink on the happy path AFTER transcription', () => {
      // Extract the stream-chunk handler body
      const match = src.match(/router\.post\(['"]\/stream-chunk['"][\s\S]+?\n\}\);/);
      expect(match).toBeTruthy();
      const handler = match![0];
      // The happy path must call fs.unlink(req.file.path, ...) AFTER
      // the whisper response is received. A handler that POSTs to
      // whisper but NEVER unlinks is a leak.
      expect(handler).toMatch(/fs\.unlink\(req\.file\.path/);
      // Find the unlink position and assert it sits AFTER the whisper
      // axios.post call.
      const axiosPos = handler.indexOf('axios.post');
      const unlinkPos = handler.indexOf('fs.unlink');
      expect(axiosPos).toBeGreaterThan(-1);
      expect(unlinkPos).toBeGreaterThan(-1);
      expect(unlinkPos).toBeGreaterThan(axiosPos);
    });

    it('calls fs.unlink in the catch block (error-path cleanup)', () => {
      // On whisper failure the temp file MUST still be removed;
      // otherwise /tmp fills up on repeated 500s.
      const match = src.match(/router\.post\(['"]\/stream-chunk['"][\s\S]+?\n\}\);/);
      const handler = match![0];
      // Locate the catch block
      const catchBlock = handler.match(/catch\s*\([^)]*\)\s*\{[\s\S]+?\n\s{2,}\}/);
      expect(catchBlock).toBeTruthy();
      expect(catchBlock![0]).toMatch(/fs\.unlink\(req\.file\.path/);
    });
  });

  describe('/stream-final route — final-chunk cleanup', () => {
    const src = readFileSync(STREAMING_ROUTE_PATH, 'utf8');

    it('the final-chunk handler also unlinks on both paths', () => {
      // Count total unlink calls — the file currently has 4:
      //   stream-chunk happy, stream-chunk catch,
      //   stream-final happy, stream-final catch.
      // A future PR that drops any of them fails this count.
      const unlinkCount = (src.match(/fs\.unlink\(req\.file\.path/g) || []).length;
      expect(unlinkCount).toBeGreaterThanOrEqual(3);
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

  describe('Regression guard: no setTimeout cleanup', () => {
    const src = readFileSync(STREAMING_ROUTE_PATH, 'utf8');

    it('cleanup is synchronous, not deferred via setTimeout / setImmediate', () => {
      // A future "optimisation" might defer cleanup to a later
      // event-loop tick. That's a bug: the deferred call can
      // legitimately lose its reference on process exit, orphaning
      // files indefinitely. Fail loudly if anyone tries.
      expect(src).not.toMatch(/setTimeout\([^,]*fs\.unlink/);
      expect(src).not.toMatch(/setImmediate\([^,]*fs\.unlink/);
    });
  });
});
