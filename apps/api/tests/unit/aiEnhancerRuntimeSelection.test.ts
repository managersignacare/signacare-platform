import { beforeEach, describe, expect, it, vi } from 'vitest';

const routeTextGeneration = vi.fn();
const resolveLockedRuntimeSelection = vi.fn();

vi.mock('../../src/features/llm/modelRouter/modelRouter', () => ({
  routeTextGeneration,
  resolveLockedRuntimeSelection,
}));

const { enhancedGenerate } = await import('../../src/mcp/aiEnhancer');

describe('aiEnhancer runtime-aware refinement', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resolveLockedRuntimeSelection.mockResolvedValue({
      clinicId: '11111111-1111-1111-1111-111111111111',
      backend: 'local_ollama',
      localStyleAdapterModelName: null,
    });
    routeTextGeneration.mockResolvedValue({
      text: 'GENERATED OUTPUT',
      execution: {
        alias: 'best_clinical',
        backend: 'local_ollama',
        modelName: 'llama3.2:latest',
        modelVersion: 'llama3.2:latest',
        deployment: null,
        localStyleAdapterModelName: null,
      },
      promptTokens: 10,
      completionTokens: 20,
      cachedPromptTokens: null,
      promptPrefixHash: 'abc',
      fallbackFromModelName: null,
    });
  });

  it('uses single-pass generation for complex actions on the local Ollama lane', async () => {
    await enhancedGenerate({
      clinicId: '11111111-1111-1111-1111-111111111111',
      action: 'maudsley',
      data: 'Clinical source block',
    });

    expect(resolveLockedRuntimeSelection).toHaveBeenCalledWith('11111111-1111-1111-1111-111111111111');
    expect(routeTextGeneration).toHaveBeenCalledTimes(1);
  });

  it('keeps two-pass refinement for complex actions on Azure OpenAI', async () => {
    resolveLockedRuntimeSelection.mockResolvedValueOnce({
      clinicId: '11111111-1111-1111-1111-111111111111',
      backend: 'azure_openai',
      localStyleAdapterModelName: null,
    });

    routeTextGeneration
      .mockResolvedValueOnce({
        text: 'DRAFT OUTPUT',
        execution: {
          alias: 'best_clinical',
          backend: 'azure_openai',
          modelName: 'gpt-4o-mini',
          modelVersion: '2026-06-01',
          deployment: 'fast-clinical-au',
          localStyleAdapterModelName: null,
        },
        promptTokens: 10,
        completionTokens: 20,
        cachedPromptTokens: 2,
        promptPrefixHash: 'draft',
        fallbackFromModelName: null,
      })
      .mockResolvedValueOnce({
        text: 'REFINED OUTPUT',
        execution: {
          alias: 'best_clinical',
          backend: 'azure_openai',
          modelName: 'gpt-4o-mini',
          modelVersion: '2026-06-01',
          deployment: 'fast-clinical-au',
          localStyleAdapterModelName: null,
        },
        promptTokens: 11,
        completionTokens: 21,
        cachedPromptTokens: 3,
        promptPrefixHash: 'refined',
        fallbackFromModelName: null,
      });

    const result = await enhancedGenerate({
      clinicId: '11111111-1111-1111-1111-111111111111',
      action: 'maudsley',
      data: 'Clinical source block',
    });

    expect(routeTextGeneration).toHaveBeenCalledTimes(2);
    expect(result.result).toBe('REFINED OUTPUT');
    expect(result.model).toBe('gpt-4o-mini');
  });
});
