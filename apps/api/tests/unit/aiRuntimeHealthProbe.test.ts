import { describe, expect, it } from 'vitest';
import {
  resolveOllamaHealthBaseUrl,
  resolveWhisperHealthUrl,
} from '../../src/routes/health';

describe('AI runtime integration health probes', () => {
  it('probes the Whisper sidecar /health endpoint instead of the root path', () => {
    expect(resolveWhisperHealthUrl({ WHISPER_API_URL: 'http://localhost:8080' })).toBe('http://localhost:8080/health');
    expect(resolveWhisperHealthUrl({ WHISPER_API_URL: 'http://localhost:8080/' })).toBe('http://localhost:8080/health');
  });

  it('honours both Ollama env names and normalises trailing slashes', () => {
    expect(resolveOllamaHealthBaseUrl({ OLLAMA_BASE_URL: 'http://localhost:11434/' })).toBe('http://localhost:11434');
    expect(resolveOllamaHealthBaseUrl({
      OLLAMA_URL: 'http://ollama.internal:11434/',
      OLLAMA_BASE_URL: 'http://localhost:11434',
    })).toBe('http://ollama.internal:11434');
  });
});
