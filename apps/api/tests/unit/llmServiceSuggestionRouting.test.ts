import { beforeEach, describe, expect, it, vi } from 'vitest';

const resolveLockedRuntimeSelection = vi.fn();
const routeTextGeneration = vi.fn();
const recordLlmInteraction = vi.fn();

vi.mock('../../src/features/llm/modelRouter/modelRouter', () => ({
  resolveLockedRuntimeSelection,
  routeTextGeneration,
}));

vi.mock('../../src/shared/recordLlmInteraction', () => ({
  recordLlmInteraction,
}));

const { processSuggestion } = await import('../../src/features/llm/llmService');

describe('llmService.processSuggestion', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    recordLlmInteraction.mockResolvedValue('11111111-1111-4111-8111-111111111111');
  });

  it('routes Azure-backed suggestion requests through the locked runtime and ignores explicit local model overrides', async () => {
    resolveLockedRuntimeSelection.mockResolvedValueOnce({
      clinicId: '22222222-2222-4222-8222-222222222222',
      backend: 'azure_openai',
      localStyleAdapterModelName: null,
    });
    routeTextGeneration.mockResolvedValueOnce({
      text: 'Suggested response',
      execution: {
        alias: 'fast_clinical',
        backend: 'azure_openai',
        modelName: 'gpt-4o-mini',
        modelVersion: '2026-06-01',
        deployment: 'fast-clinical-au',
        localStyleAdapterModelName: null,
      },
      promptTokens: 120,
      completionTokens: 45,
      fallbackFromModelName: null,
    });

    const result = await processSuggestion(
      '22222222-2222-4222-8222-222222222222',
      '33333333-3333-4333-8333-333333333333',
      {
        feature: 'suggestion',
        contextRef: 'Context body',
        modelName: 'local-only-model',
      },
    );

    expect(routeTextGeneration).toHaveBeenCalledWith(expect.objectContaining({
      clinicId: '22222222-2222-4222-8222-222222222222',
      alias: 'fast_clinical',
      requestedModel: undefined,
      allowLocalStyleAdapter: false,
    }));
    expect(recordLlmInteraction).toHaveBeenCalledWith(expect.objectContaining({
      modelName: 'gpt-4o-mini',
      modelVersion: '2026-06-01',
      modelProvider: 'azure_openai',
      metadata: expect.objectContaining({
        routedAlias: 'fast_clinical',
        routedBackend: 'azure_openai',
        ignoredRequestedModel: 'local-only-model',
        versionSource: 'provider',
      }),
    }));
    expect(result).toMatchObject({
      interactionId: '11111111-1111-4111-8111-111111111111',
      success: true,
    });
    expect(result.outputRef).toContain('Suggested response');
    expect(result.outputRef).toContain('Verify against current clinical guidelines');
  });

  it('records a failed local suggestion attempt while preserving the requested local model identity', async () => {
    resolveLockedRuntimeSelection.mockResolvedValueOnce({
      clinicId: '22222222-2222-4222-8222-222222222222',
      backend: 'local_ollama',
      localStyleAdapterModelName: 'clinic-style:latest',
    });
    routeTextGeneration.mockRejectedValueOnce(new Error('provider unavailable'));

    const result = await processSuggestion(
      '22222222-2222-4222-8222-222222222222',
      '33333333-3333-4333-8333-333333333333',
      {
        feature: 'coding_assist',
        contextRef: 'Coding context',
        modelName: 'qwen2.5:32b',
      },
    );

    expect(routeTextGeneration).toHaveBeenCalledWith(expect.objectContaining({
      alias: 'best_clinical',
      requestedModel: 'qwen2.5:32b',
      allowLocalStyleAdapter: false,
    }));
    expect(recordLlmInteraction).toHaveBeenCalledWith(expect.objectContaining({
      success: false,
      errorCode: 'LLM_PROVIDER_ERROR',
      modelName: 'qwen2.5:32b',
      modelProvider: 'ollama',
      promptText: 'Coding context',
      outputText: '',
      metadata: expect.objectContaining({
        routedBackend: 'local_ollama',
        requestedLocalModel: 'qwen2.5:32b',
      }),
    }));
    expect(result).toMatchObject({
      interactionId: '11111111-1111-4111-8111-111111111111',
      outputRef: null,
      success: false,
    });
  });
});
