import { afterEach, describe, expect, it, vi } from 'vitest';

import { probeWhisperHealth } from '../../src/features/llm/whisperHealthProbe';

describe('probeWhisperHealth', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('probes the sidecar health endpoint with fetch so https URLs stay valid', async () => {
    const fetchSpy = vi.fn(async () => ({ ok: true }));
    vi.stubGlobal('fetch', fetchSpy);

    await expect(probeWhisperHealth('https://signacare-whisper-staging.azurewebsites.net')).resolves.toBe(true);

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(fetchSpy).toHaveBeenCalledWith(
      'https://signacare-whisper-staging.azurewebsites.net/health',
      expect.objectContaining({
        signal: expect.any(AbortSignal),
      }),
    );
  });

  it('returns false when the probe fails', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => {
      throw new Error('connect ECONNREFUSED');
    }));

    await expect(probeWhisperHealth('https://signacare-whisper-staging.azurewebsites.net')).resolves.toBe(false);
  });
});
