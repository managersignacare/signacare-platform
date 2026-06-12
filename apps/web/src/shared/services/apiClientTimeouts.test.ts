import { describe, expect, it } from 'vitest';
import {
  DEFAULT_API_TIMEOUT_MS,
  formatApiErrorMessage,
  isLongRunningAiEndpoint,
  LONG_RUNNING_AI_TIMEOUT_MS,
} from './apiClient';
import { AMBIENT_NOTE_HTTP_TIMEOUT_MS } from './llmAmbientApi';

describe('apiClient AI timeout routing', () => {
  it('classifies relative AI URLs as long-running endpoints', () => {
    expect(isLongRunningAiEndpoint('llm/clinical-ai')).toBe(true);
    expect(isLongRunningAiEndpoint('llm/ambient-note')).toBe(true);
    expect(isLongRunningAiEndpoint('scribe/stream-final')).toBe(true);
    expect(isLongRunningAiEndpoint('voice/transcribe')).toBe(true);
  });

  it('classifies slash-prefixed and absolute AI URLs as long-running endpoints', () => {
    expect(isLongRunningAiEndpoint('/api/v1/llm/clinical-ai')).toBe(true);
    expect(isLongRunningAiEndpoint('https://example.test/api/v1/llm/clinical-ai')).toBe(true);
  });

  it('does not classify ordinary API calls as AI endpoints', () => {
    expect(isLongRunningAiEndpoint('patients/123')).toBe(false);
    expect(isLongRunningAiEndpoint('/api/v1/patients')).toBe(false);
  });

  it('keeps the AI timeout above the normal API timeout', () => {
    expect(DEFAULT_API_TIMEOUT_MS).toBe(30_000);
    expect(LONG_RUNNING_AI_TIMEOUT_MS).toBeGreaterThan(DEFAULT_API_TIMEOUT_MS);
    expect(LONG_RUNNING_AI_TIMEOUT_MS).toBe(600_000);
  });

  it('keeps ambient-note uploads on the capped synchronous timeout', () => {
    expect(AMBIENT_NOTE_HTTP_TIMEOUT_MS).toBe(210_000);
    expect(AMBIENT_NOTE_HTTP_TIMEOUT_MS).toBeLessThan(LONG_RUNNING_AI_TIMEOUT_MS);
  });

  it('turns AI 499 disconnects into an async-job recovery message', () => {
    expect(formatApiErrorMessage({
      status: 499,
      url: 'llm/clinical-ai',
      fallbackMessage: 'Request failed with status code 499',
    })).toContain('async AI job workflow');
  });
});
