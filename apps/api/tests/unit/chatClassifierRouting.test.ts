import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const first = vi.fn();
const select = vi.fn(() => ({ first }));
const where = vi.fn(() => ({ select }));
const db = vi.fn(() => ({ where }));

const resolveLockedRuntimeSelection = vi.fn();
const routeTextGeneration = vi.fn();

vi.mock('../../src/db/db', () => ({
  db,
}));

vi.mock('../../src/features/llm/modelRouter/modelRouter', () => ({
  resolveLockedRuntimeSelection,
  routeTextGeneration,
}));

const { classifyForClinic, _internal } = await import('../../src/mcp/chatClassifier');

describe('chatClassifier model routing', () => {
  const originalModel = process.env.AI_CHAT_CLASSIFIER_MODEL;

  beforeEach(() => {
    vi.clearAllMocks();
    process.env.AI_CHAT_CLASSIFIER_MODEL = originalModel;
  });

  afterEach(() => {
    process.env.AI_CHAT_CLASSIFIER_MODEL = originalModel;
  });

  it('routes model-based classifier mode through the locked runtime and accepts a binary BLOCK answer', async () => {
    first.mockResolvedValueOnce({ ai_chat_classifier_mode: 'local_llm' });
    resolveLockedRuntimeSelection.mockResolvedValueOnce({
      clinicId: '11111111-1111-1111-1111-111111111111',
      backend: 'azure_openai',
      localStyleAdapterModelName: null,
    });
    routeTextGeneration.mockResolvedValueOnce({
      text: 'BLOCK',
      execution: {
        alias: 'fast_clinical',
        backend: 'azure_openai',
        modelName: 'gpt-4o-mini',
        modelVersion: '2026-06-01',
        deployment: 'fast-clinical-au',
        localStyleAdapterModelName: null,
      },
      promptTokens: 10,
      completionTokens: 2,
      fallbackFromModelName: null,
    });

    const result = await classifyForClinic(
      '11111111-1111-1111-1111-111111111111',
      'Can you prescribe sertraline 50 mg daily?',
    );

    expect(routeTextGeneration).toHaveBeenCalledWith(expect.objectContaining({
      clinicId: '11111111-1111-1111-1111-111111111111',
      alias: 'fast_clinical',
      requestedModel: undefined,
      allowLocalStyleAdapter: false,
      temperature: 0,
      maxTokens: 12,
      action: 'classifier',
    }));
    expect(result).toEqual({
      blocked: true,
      reason: 'model_flagged',
      mode: 'local_llm',
      matched: 'BLOCK',
    });
  });

  it('uses the configured local classifier model only on the local backend', async () => {
    process.env.AI_CHAT_CLASSIFIER_MODEL = 'chat-classifier-v1';
    first.mockResolvedValueOnce({ ai_chat_classifier_mode: 'local_llm' });
    resolveLockedRuntimeSelection.mockResolvedValueOnce({
      clinicId: '11111111-1111-1111-1111-111111111111',
      backend: 'local_ollama',
      localStyleAdapterModelName: 'clinic-style:latest',
    });
    routeTextGeneration.mockResolvedValueOnce({
      text: 'ALLOW',
      execution: {
        alias: 'fast_clinical',
        backend: 'local_ollama',
        modelName: 'chat-classifier-v1',
        modelVersion: 'chat-classifier-v1@sha256:test',
        deployment: null,
        localStyleAdapterModelName: 'clinic-style:latest',
      },
      promptTokens: 11,
      completionTokens: 1,
      fallbackFromModelName: null,
    });

    const result = await classifyForClinic(
      '11111111-1111-1111-1111-111111111111',
      'Summarise the likely side effects discussed today.',
    );

    expect(routeTextGeneration).toHaveBeenCalledWith(expect.objectContaining({
      requestedModel: 'chat-classifier-v1',
      allowLocalStyleAdapter: false,
    }));
    expect(result).toEqual({
      blocked: false,
      reason: null,
      mode: 'local_llm',
      matched: null,
    });
  });

  it('falls back to regex when the model route fails or returns a non-binary answer', async () => {
    first.mockResolvedValueOnce({ ai_chat_classifier_mode: 'local_llm' });
    resolveLockedRuntimeSelection.mockResolvedValueOnce({
      clinicId: '11111111-1111-1111-1111-111111111111',
      backend: 'azure_openai',
      localStyleAdapterModelName: null,
    });
    routeTextGeneration.mockResolvedValueOnce({
      text: 'Maybe block this',
      execution: {
        alias: 'fast_clinical',
        backend: 'azure_openai',
        modelName: 'gpt-4o-mini',
        modelVersion: '2026-06-01',
        deployment: 'fast-clinical-au',
        localStyleAdapterModelName: null,
      },
      promptTokens: 9,
      completionTokens: 3,
      fallbackFromModelName: null,
    });

    const result = await classifyForClinic(
      '11111111-1111-1111-1111-111111111111',
      'Please prescribe diazepam 5 mg bd for this patient.',
    );

    expect(result.blocked).toBe(true);
    expect(result.mode).toBe('regex_keyword');
    expect(result.reason).toBe('prescribing_verb');
    expect(_internal.parseModelClassifierAnswer('unclear')).toBeNull();
  });
});
