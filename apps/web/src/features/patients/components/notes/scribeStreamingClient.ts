/**
 * apps/web/src/features/patients/components/notes/scribeStreamingClient.ts
 *
 * S5.1 — Streaming transcription client
 *
 * Wraps the existing /scribe/stream-chunk and /scribe/stream-final
 * endpoints in a small helper class that the recorder can call as
 * MediaRecorder fires `ondataavailable`. Buffers the per-second
 * MediaRecorder output into ~5-second batches before each network
 * call so Whisper has enough audio to produce a useful partial.
 *
 * The class is deliberately decoupled from React. Callers wire the
 * onPartial / onError callbacks into their own state management.
 */

import { apiClient } from '../../../../shared/services/apiClient';

interface StreamingClientOptions {
  /** ms of audio to accumulate before sending each /stream-chunk POST. */
  batchMs?: number;
  onPartial: (delta: { text: string; chunkIndex: number }) => void;
  onError?: (err: Error) => void;
}

interface StreamChunkResponse {
  chunkIndex: number;
  transcript: string;
  sessionId: string;
}

interface StreamFinalResponse {
  transcript: string;
  sessionId: string;
  complete: boolean;
}

export class ScribeStreamingClient {
  private readonly batchMs: number;
  private readonly onPartial: (delta: { text: string; chunkIndex: number }) => void;
  private readonly onError?: (err: Error) => void;
  private readonly sessionId: string;
  private chunkIndex = 0;
  private buffer: Blob[] = [];
  private bufferStartedAt = 0;
  private inFlight = 0;
  private mimeType = 'audio/webm';
  private accumulatedTranscript = '';

  constructor(opts: StreamingClientOptions) {
    this.batchMs = opts.batchMs ?? 5000;
    this.onPartial = opts.onPartial;
    this.onError = opts.onError;
    // sessionId only needs to be unique per recording session, not
    // globally — Math.random+timestamp is sufficient.
    this.sessionId = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  }

  /**
   * Feed one MediaRecorder chunk into the buffer. Once the buffer has
   * accumulated batchMs of audio (or when explicitly flushed), it
   * fires off to /stream-chunk.
   */
  pushChunk(blob: Blob, mimeType?: string): void {
    if (mimeType) this.mimeType = mimeType;
    if (this.bufferStartedAt === 0) this.bufferStartedAt = Date.now();
    this.buffer.push(blob);
    if (Date.now() - this.bufferStartedAt >= this.batchMs) {
      void this.flushBuffer();
    }
  }

  /** Drain the buffer immediately. Called on stop/pause. */
  async flushBuffer(): Promise<void> {
    if (this.buffer.length === 0) return;
    const batch = this.buffer;
    const startedAt = this.bufferStartedAt;
    this.buffer = [];
    this.bufferStartedAt = 0;
    const ourIndex = this.chunkIndex++;

    const blob = new Blob(batch, { type: this.mimeType });
    if (blob.size < 200) {
      // Too small to bother — skip silently.
      return;
    }

    const fd = new FormData();
    fd.append('audio', blob, `chunk_${ourIndex}.webm`);
    fd.append('chunkIndex', String(ourIndex));
    fd.append('sessionId', this.sessionId);

    this.inFlight++;
    try {
      const resp = await apiClient.instance.post<StreamChunkResponse>(
        'scribe/stream-chunk',
        fd,
        { headers: { 'Content-Type': 'multipart/form-data' }, timeout: 30_000 },
      );
      const text = resp.data?.transcript?.trim();
      if (text) {
        this.accumulatedTranscript = [this.accumulatedTranscript, text].filter(Boolean).join(' ').trim();
        this.onPartial({ text: this.accumulatedTranscript, chunkIndex: ourIndex });
      }
    } catch (err) {
      // Streaming failures are non-fatal — the existing 3-pass scribe
      // pipeline will still process the full audio at the end. We just
      // lose the live transcript pane for this batch.
      if (this.onError) this.onError(err instanceof Error ? err : new Error(String(err)));
    } finally {
      this.inFlight--;
      // Suppress unused-var warnings for the diagnostic locals.
      void startedAt;
    }
  }

  /**
   * Flush any remaining buffered chunks and return the accumulated
   * transcript. The /stream-final endpoint also exists but isn't
   * needed when we've flushed all chunks via /stream-chunk.
   */
  async finish(): Promise<string> {
    await this.flushBuffer();
    // Wait briefly for any in-flight requests to settle.
    const start = Date.now();
    while (this.inFlight > 0 && Date.now() - start < 5_000) {
      await new Promise((r) => setTimeout(r, 100));
    }
    return this.accumulatedTranscript;
  }

  /** Reset state for a new session (e.g. user starts a new recording). */
  reset(): void {
    this.buffer = [];
    this.bufferStartedAt = 0;
    this.chunkIndex = 0;
    this.accumulatedTranscript = '';
  }

  get currentTranscript(): string {
    return this.accumulatedTranscript;
  }

  // Expose for tests / diagnostics
  get _sessionId(): string {
    return this.sessionId;
  }

  // Type-only export for the response shape, in case a caller wants it
  // and we don't want to drag all of the implementation along.
  static readonly _types = (null as unknown as {
    StreamChunkResponse: StreamChunkResponse;
    StreamFinalResponse: StreamFinalResponse;
  });
}
