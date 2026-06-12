/**
 * Phase 7 — unit coverage for the Whisper backend resolver.
 *
 * Covers the load-bearing properties the operator brief names:
 *   - config validation (only the closed-list enum accepted)
 *   - backend selection fallback behavior (loud, not silent)
 *   - default behavior unchanged when the env var is unset
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { DEFAULT_WHISPER_BACKEND, WhisperBackendSchema } from '@signacare/shared';
import { resolveWhisperBackend, whisperEndpointUrlFor } from './whisperBackend';

// Silence the logger.warn calls the resolver makes during fallback so
// the test output stays focused on assertions.
vi.mock('../utils/logger', () => ({
  logger: {
    warn: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
  },
}));

function envWith(map: Record<string, string | undefined>): NodeJS.ProcessEnv {
  return map as NodeJS.ProcessEnv;
}

describe('whisperBackend — default lane (env unset)', () => {
  it('returns the default backend with no fallback signal when env is unset', () => {
    const r = resolveWhisperBackend(envWith({}));
    expect(r.backend).toBe(DEFAULT_WHISPER_BACKEND);
    expect(r.requested).toBeNull();
    expect(r.fellBackToDefault).toBe(false);
    expect(r.fallbackReason).toBeNull();
  });

  it('returns the default backend with no fallback signal when env is blank', () => {
    const r = resolveWhisperBackend(envWith({ SIGNACARE_WHISPER_BACKEND: '   ' }));
    expect(r.backend).toBe(DEFAULT_WHISPER_BACKEND);
    expect(r.fellBackToDefault).toBe(false);
  });
});

describe('whisperBackend — unrecognised value', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('falls back to default with a loud reason when env value is not in the enum', () => {
    const r = resolveWhisperBackend(envWith({ SIGNACARE_WHISPER_BACKEND: 'definitely-not-a-backend' }));
    expect(r.backend).toBe(DEFAULT_WHISPER_BACKEND);
    expect(r.requested).toBeNull();
    expect(r.fellBackToDefault).toBe(true);
    expect(r.fallbackReason).toContain('definitely-not-a-backend');
    expect(r.fallbackReason).toContain('allowed:');
  });

  it('treats case-sensitive mismatches as unrecognised (no silent normalisation)', () => {
    const r = resolveWhisperBackend(envWith({ SIGNACARE_WHISPER_BACKEND: 'Whisper/CPU' }));
    expect(r.backend).toBe(DEFAULT_WHISPER_BACKEND);
    expect(r.fellBackToDefault).toBe(true);
  });
});

describe('whisperBackend — recognised default selection', () => {
  it('does not signal a fallback when the env value matches the default', () => {
    const r = resolveWhisperBackend(envWith({ SIGNACARE_WHISPER_BACKEND: 'whisper/cpu' }));
    expect(r.backend).toBe('whisper/cpu');
    expect(r.requested).toBe('whisper/cpu');
    expect(r.fellBackToDefault).toBe(false);
    expect(r.fallbackReason).toBeNull();
  });
});

describe('whisperBackend — non-default backend with required config', () => {
  it('selects faster-whisper when FASTER_WHISPER_API_URL is set', () => {
    const r = resolveWhisperBackend(envWith({
      SIGNACARE_WHISPER_BACKEND: 'faster-whisper',
      FASTER_WHISPER_API_URL: 'http://localhost:8081',
    }));
    expect(r.backend).toBe('faster-whisper');
    expect(r.requested).toBe('faster-whisper');
    expect(r.fellBackToDefault).toBe(false);
  });

  it('selects gpu-managed when GPU_MANAGED_ASR_API_URL is set', () => {
    const r = resolveWhisperBackend(envWith({
      SIGNACARE_WHISPER_BACKEND: 'gpu-managed',
      GPU_MANAGED_ASR_API_URL: 'https://asr.example.com',
    }));
    expect(r.backend).toBe('gpu-managed');
    expect(r.fellBackToDefault).toBe(false);
  });
});

describe('whisperBackend — non-default backend without required config', () => {
  it('falls back to default with a structured reason when faster-whisper URL is unset', () => {
    const r = resolveWhisperBackend(envWith({ SIGNACARE_WHISPER_BACKEND: 'faster-whisper' }));
    expect(r.backend).toBe(DEFAULT_WHISPER_BACKEND);
    expect(r.requested).toBe('faster-whisper');
    expect(r.fellBackToDefault).toBe(true);
    expect(r.fallbackReason).toContain('faster-whisper');
    expect(r.fallbackReason).toContain('endpoint URL env var is unset');
  });

  it('falls back to default when gpu-managed URL is unset', () => {
    const r = resolveWhisperBackend(envWith({ SIGNACARE_WHISPER_BACKEND: 'gpu-managed' }));
    expect(r.backend).toBe(DEFAULT_WHISPER_BACKEND);
    expect(r.requested).toBe('gpu-managed');
    expect(r.fellBackToDefault).toBe(true);
    expect(r.fallbackReason).toContain('gpu-managed');
  });
});

describe('whisperBackend — endpoint URL resolution', () => {
  it('returns the configured WHISPER_API_URL for the default backend', () => {
    const original = process.env.WHISPER_API_URL;
    process.env.WHISPER_API_URL = 'http://test-whisper:9999';
    try {
      expect(whisperEndpointUrlFor('whisper/cpu')).toBe('http://test-whisper:9999');
    } finally {
      if (original === undefined) delete process.env.WHISPER_API_URL;
      else process.env.WHISPER_API_URL = original;
    }
  });

  it('returns localhost:8080 as the default lane URL when WHISPER_API_URL is unset', () => {
    const original = process.env.WHISPER_API_URL;
    delete process.env.WHISPER_API_URL;
    try {
      expect(whisperEndpointUrlFor('whisper/cpu')).toBe('http://localhost:8080');
    } finally {
      if (original !== undefined) process.env.WHISPER_API_URL = original;
    }
  });

  it('returns null for non-default backends when their URL env var is unset', () => {
    const fasterOriginal = process.env.FASTER_WHISPER_API_URL;
    const gpuOriginal = process.env.GPU_MANAGED_ASR_API_URL;
    delete process.env.FASTER_WHISPER_API_URL;
    delete process.env.GPU_MANAGED_ASR_API_URL;
    try {
      expect(whisperEndpointUrlFor('faster-whisper')).toBeNull();
      expect(whisperEndpointUrlFor('gpu-managed')).toBeNull();
    } finally {
      if (fasterOriginal !== undefined) process.env.FASTER_WHISPER_API_URL = fasterOriginal;
      if (gpuOriginal !== undefined) process.env.GPU_MANAGED_ASR_API_URL = gpuOriginal;
    }
  });
});

describe('whisperBackend — closed-list enum contract', () => {
  it('the WhisperBackendSchema enum contains exactly the three expected backends', () => {
    expect(WhisperBackendSchema.options.sort()).toEqual(['faster-whisper', 'gpu-managed', 'whisper/cpu']);
  });

  it('rejects any value outside the closed list at schema parse time', () => {
    expect(() => WhisperBackendSchema.parse('something-else')).toThrow();
  });
});
