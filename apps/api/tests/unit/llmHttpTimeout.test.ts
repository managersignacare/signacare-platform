import { describe, expect, it } from 'vitest';
import { isLongRunningAiHttpPath, resolveLlmHttpTimeoutMs } from '../../src/shared/llmHttpTimeout';

describe('resolveLlmHttpTimeoutMs', () => {
  it('defaults to local LLM timeout plus HTTP grace', () => {
    expect(resolveLlmHttpTimeoutMs({})).toBe(660_000);
  });

  it('uses explicit HTTP timeout when configured', () => {
    expect(resolveLlmHttpTimeoutMs({
      LOCAL_LLM_GENERATE_TIMEOUT_MS: '600000',
      LLM_HTTP_TIMEOUT_MS: '900000',
    })).toBe(900_000);
  });

  it('falls back safely when explicit values are invalid', () => {
    expect(resolveLlmHttpTimeoutMs({
      LOCAL_LLM_GENERATE_TIMEOUT_MS: 'bad',
      LLM_HTTP_TIMEOUT_MS: '-1',
    })).toBe(660_000);
  });

  it('classifies all backend AI routes that can exceed normal request timeout', () => {
    expect(isLongRunningAiHttpPath('/api/v1/llm/clinical-ai')).toBe(true);
    expect(isLongRunningAiHttpPath('/api/v1/scribe/stream-final')).toBe(true);
    expect(isLongRunningAiHttpPath('/api/v1/voice/transcribe')).toBe(true);
    expect(isLongRunningAiHttpPath('/api/v1/documents/ocr')).toBe(true);
    expect(isLongRunningAiHttpPath('/api/v1/patients')).toBe(false);
  });
});
