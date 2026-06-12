import { beforeEach, describe, expect, it, vi } from 'vitest';

const getClinicAiRuntimeSettings = vi.fn();
const callLocalLlm = vi.fn();
const callAzureOpenAiChat = vi.fn();

vi.mock('../../src/features/llm/modelRouter/clinicAiRuntimeSettings', () => ({
  DEFAULT_CLINIC_AI_RUNTIME_SETTINGS: {
    llmBackend: 'local_ollama',
    scribeRuntimeMode: 'standard',
    localStyleAdapterModelName: null,
  },
  getClinicAiRuntimeSettings,
}));

vi.mock('../../src/mcp/localLlmAgent', () => ({
  callLocalLlm,
}));

vi.mock('../../src/features/llm/modelRouter/azureOpenAiAdapter', () => ({
  callAzureOpenAiChat,
}));

const {
  generateClinicalAction,
  resolveLockedRuntimeSelection,
  routeTextGeneration,
  estimateStablePromptPrefixHash,
} = await import('../../src/features/llm/modelRouter/modelRouter');

describe('modelRouter', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getClinicAiRuntimeSettings.mockResolvedValue({
      clinicId: '11111111-1111-1111-1111-111111111111',
      llmBackend: 'local_ollama',
      scribeRuntimeMode: 'standard',
      localStyleAdapterModelName: null,
    });
    callLocalLlm.mockResolvedValue({
      text: 'local-output',
      model: 'qwen2.5:14b',
      modelVersion: 'qwen2.5:14b',
      tokensUsed: 321,
    });
    callAzureOpenAiChat.mockResolvedValue({
      text: 'azure-output',
      modelName: 'gpt-4o-mini',
      modelVersion: '2026-06-01',
      deployment: 'fast-clinical-au',
      promptTokens: 123,
      completionTokens: 45,
      cachedPromptTokens: 12,
    });
  });

  it('routes to Azure when the clinic runtime selects azure_openai', async () => {
    getClinicAiRuntimeSettings.mockResolvedValueOnce({
      clinicId: '11111111-1111-1111-1111-111111111111',
      llmBackend: 'azure_openai',
      scribeRuntimeMode: 'agentic',
      localStyleAdapterModelName: 'clinic-style:latest',
    });

    const result = await routeTextGeneration({
      clinicId: '11111111-1111-1111-1111-111111111111',
      alias: 'fast_clinical',
      prompt: 'Summarise this note',
      system: 'System prompt',
      temperature: 0.2,
    });

    expect(callAzureOpenAiChat).toHaveBeenCalledWith(expect.objectContaining({
      alias: 'fast_clinical',
      prompt: 'Summarise this note',
      system: 'System prompt',
      temperature: 0.2,
    }));
    expect(callLocalLlm).not.toHaveBeenCalled();
    expect(result.execution).toMatchObject({
      alias: 'fast_clinical',
      backend: 'azure_openai',
      modelName: 'gpt-4o-mini',
      modelVersion: '2026-06-01',
      deployment: 'fast-clinical-au',
      localStyleAdapterModelName: 'clinic-style:latest',
    });
    expect(result.cachedPromptTokens).toBe(12);
    expect(result.promptPrefixHash).toEqual(expect.any(String));
    expect(result.promptPrefixHash).toHaveLength(64);
  });

  it('uses the stored local style adapter on eligible local aliases', async () => {
    getClinicAiRuntimeSettings.mockResolvedValueOnce({
      clinicId: '11111111-1111-1111-1111-111111111111',
      llmBackend: 'local_ollama',
      scribeRuntimeMode: 'standard',
      localStyleAdapterModelName: 'clinic-style:latest',
    });

    const result = await generateClinicalAction({
      clinicId: '11111111-1111-1111-1111-111111111111',
      action: 'formulation',
      data: 'Patient data block',
    });

    expect(callLocalLlm).toHaveBeenCalledWith(expect.objectContaining({
      clinicId: '11111111-1111-1111-1111-111111111111',
      model: 'clinic-style:latest',
      action: 'formulation',
    }));
    expect(result.execution).toMatchObject({
      alias: 'best_clinical',
      backend: 'local_ollama',
      modelName: 'qwen2.5:14b',
      localStyleAdapterModelName: 'clinic-style:latest',
    });
    expect(result.cachedPromptTokens).toBeNull();
    expect(result.promptPrefixHash).toEqual(expect.any(String));
  });

  it('produces deterministic prompt-prefix hashes for semantically equivalent prompts', async () => {
    getClinicAiRuntimeSettings.mockResolvedValueOnce({
      clinicId: '11111111-1111-1111-1111-111111111111',
      llmBackend: 'local_ollama',
      scribeRuntimeMode: 'standard',
      localStyleAdapterModelName: null,
    });

    const resultA = await routeTextGeneration({
      clinicId: '11111111-1111-1111-1111-111111111111',
      alias: 'fast_clinical',
      prompt: 'First prompt line\n\n  second  line',
      system: 'A   system prompt\nwith spaces',
      temperature: 0.2,
      maxTokens: 150,
      action: 'note',
    });

    const resultB = await routeTextGeneration({
      clinicId: '11111111-1111-1111-1111-111111111111',
      alias: 'fast_clinical',
      prompt: 'first prompt line\n second  line',
      system: 'A system   prompt with spaces',
      temperature: 0.2,
      maxTokens: 150,
      action: 'note',
    });

    expect(resultA.promptPrefixHash).toBe(resultB.promptPrefixHash);
  });

  it('hashes stable prompt prefixes and ignores terminal dynamic payload changes', () => {
    const hashA = estimateStablePromptPrefixHash({
      alias: 'fast_clinical',
      action: 'admin-report',
      system: 'Clinical report assistant',
      prompt: 'Generate a report from the following context:\n\nPATIENT: Alice\nDOB: 2000-01-01\n\n' +
        'Patient context payload: high variation area',
    });
    const hashB = estimateStablePromptPrefixHash({
      alias: 'fast_clinical',
      action: 'admin-report',
      system: 'Clinical report assistant',
      prompt: 'Generate a report from the following context:\n\nPATIENT: Bob\nDOB: 1999-01-01\n\n' +
        'Completely different payload with changed facts and timestamps',
    });

    expect(hashA).toBe(hashB);
  });

  it('lets an explicit requestedModel override the stored local adapter', async () => {
    getClinicAiRuntimeSettings.mockResolvedValueOnce({
      clinicId: '11111111-1111-1111-1111-111111111111',
      llmBackend: 'local_ollama',
      scribeRuntimeMode: 'standard',
      localStyleAdapterModelName: 'clinic-style:latest',
    });

    await routeTextGeneration({
      clinicId: '11111111-1111-1111-1111-111111111111',
      alias: 'best_clinical',
      prompt: 'Prompt body',
      requestedModel: 'qwen2.5:32b',
    });

    expect(callLocalLlm).toHaveBeenCalledWith(expect.objectContaining({
      model: 'qwen2.5:32b',
    }));
  });

  it('rejects explicit requestedModel overrides for governed Azure aliases', async () => {
    getClinicAiRuntimeSettings.mockResolvedValueOnce({
      clinicId: '11111111-1111-1111-1111-111111111111',
      llmBackend: 'azure_openai',
      scribeRuntimeMode: 'standard',
      localStyleAdapterModelName: null,
    });

    await expect(routeTextGeneration({
      clinicId: '11111111-1111-1111-1111-111111111111',
      alias: 'best_clinical',
      prompt: 'Prompt body',
      requestedModel: 'unreviewed-azure-deployment',
    })).rejects.toMatchObject({
      status: 422,
      code: 'AI_MODEL_OVERRIDE_NOT_ALLOWED',
    });

    expect(callAzureOpenAiChat).not.toHaveBeenCalled();
    expect(callLocalLlm).not.toHaveBeenCalled();
  });

  it('reuses a locked runtime selection without re-reading clinic settings on the second call', async () => {
    const locked = await resolveLockedRuntimeSelection('11111111-1111-1111-1111-111111111111');
    expect(getClinicAiRuntimeSettings).toHaveBeenCalledTimes(1);

    await routeTextGeneration({
      clinicId: '11111111-1111-1111-1111-111111111111',
      runtimeSelection: locked,
      alias: 'best_clinical',
      prompt: 'Prompt body',
    });

    expect(getClinicAiRuntimeSettings).toHaveBeenCalledTimes(1);
    expect(callLocalLlm).toHaveBeenCalledWith(expect.objectContaining({
      clinicId: '11111111-1111-1111-1111-111111111111',
    }));
  });

  it('can disable local style adapters for extraction-oriented calls', async () => {
    getClinicAiRuntimeSettings.mockResolvedValueOnce({
      clinicId: '11111111-1111-1111-1111-111111111111',
      llmBackend: 'local_ollama',
      scribeRuntimeMode: 'standard',
      localStyleAdapterModelName: 'clinic-style:latest',
    });

    await routeTextGeneration({
      clinicId: '11111111-1111-1111-1111-111111111111',
      alias: 'fast_clinical',
      prompt: 'Extraction prompt',
      allowLocalStyleAdapter: false,
      action: 'ambient',
    });

    expect(callLocalLlm).toHaveBeenCalledWith(expect.objectContaining({
      model: undefined,
      action: 'ambient',
    }));
  });
});
