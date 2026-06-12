import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ScribeStreamingClient } from './scribeStreamingClient';
import { apiClient } from '../../../../shared/services/apiClient';

vi.mock('../../../../shared/services/apiClient', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../../shared/services/apiClient')>();
  return {
    ...actual,
    apiClient: {
      ...actual.apiClient,
      instance: {
        post: vi.fn(),
      },
    },
  };
});

describe('ScribeStreamingClient', () => {
  const largeChunk = 'a'.repeat(512);

  beforeEach(() => {
    vi.mocked(apiClient.instance.post).mockReset();
  });

  it('accumulates partial transcripts instead of replacing prior batches', async () => {
    vi.mocked(apiClient.instance.post)
      .mockResolvedValueOnce({ data: { transcript: 'first batch', chunkIndex: 0, sessionId: 's' } })
      .mockResolvedValueOnce({ data: { transcript: 'second batch', chunkIndex: 1, sessionId: 's' } })
      .mockResolvedValueOnce({ data: { transcript: 'first batch second batch', sessionId: 's', complete: true } });

    const seen: string[] = [];
    const client = new ScribeStreamingClient({
      batchMs: 0,
      onPartial: (delta) => seen.push(delta.text),
    });

    client.pushChunk(new Blob([largeChunk]), 'audio/webm');
    await client.flushBuffer();
    client.pushChunk(new Blob([largeChunk]), 'audio/webm');
    await client.flushBuffer();
    const transcript = await client.finish();

    expect(seen).toEqual(['first batch', 'first batch second batch']);
    expect(transcript).toBe('first batch second batch');
  });

  it('finalises through stream-final so a short tail chunk is not lost', async () => {
    vi.mocked(apiClient.instance.post)
      .mockResolvedValueOnce({ data: { transcript: 'intro', chunkIndex: 0, sessionId: 's' } })
      .mockResolvedValueOnce({ data: { transcript: 'intro tail', sessionId: 's', complete: true } });

    const client = new ScribeStreamingClient({
      batchMs: 0,
      onPartial: () => {},
    });

    client.pushChunk(new Blob([largeChunk]), 'audio/webm');
    await client.flushBuffer();
    client.pushChunk(new Blob(['x']), 'audio/webm');
    const transcript = await client.finish();

    expect(apiClient.instance.post).toHaveBeenNthCalledWith(
      2,
      'scribe/stream-final',
      expect.any(FormData),
      expect.objectContaining({
        headers: { 'Content-Type': 'multipart/form-data' },
        timeout: 60_000,
      }),
    );
    expect(transcript).toBe('intro tail');
  });
});
