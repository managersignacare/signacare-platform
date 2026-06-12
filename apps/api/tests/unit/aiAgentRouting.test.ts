import { beforeEach, describe, expect, it, vi } from 'vitest';

const resolveLockedRuntimeSelection = vi.fn();
const routeTextGeneration = vi.fn();
const requirePatientRelationship = vi.fn();
const handleToolCall = vi.fn();

vi.mock('../../src/features/llm/modelRouter/modelRouter', () => ({
  resolveLockedRuntimeSelection,
  routeTextGeneration,
}));

vi.mock('../../src/shared/authGuards', () => ({
  requirePatientRelationship,
}));

vi.mock('../../src/mcp/server/mcpServer', () => ({
  handleToolCall,
}));

const { runAgent } = await import('../../src/mcp/server/aiAgent');

describe('aiAgent runtime routing', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    handleToolCall.mockResolvedValue({
      content: [{ text: 'tool-result' }],
      isError: false,
    });
  });

  it('uses the locked local runtime and forwards an explicit local model override without style-adapter injection', async () => {
    resolveLockedRuntimeSelection.mockResolvedValueOnce({
      clinicId: '11111111-1111-1111-1111-111111111111',
      backend: 'local_ollama',
      localStyleAdapterModelName: 'clinic-style:latest',
    });
    routeTextGeneration.mockResolvedValueOnce({
      text: 'A concise operational answer.',
      execution: {
        alias: 'fast_clinical',
        backend: 'local_ollama',
        modelName: 'qwen2.5:32b',
        modelVersion: 'qwen2.5:32b@sha256:test',
        deployment: null,
        localStyleAdapterModelName: 'clinic-style:latest',
      },
      promptTokens: 100,
      completionTokens: 30,
      fallbackFromModelName: null,
    });

    const result = await runAgent(
      'Provide a concise operational summary.',
      {
        staffId: '22222222-2222-4222-8222-222222222222',
        clinicId: '11111111-1111-1111-1111-111111111111',
        role: 'admin',
        permissions: [],
      },
      'qwen2.5:32b',
    );

    expect(routeTextGeneration).toHaveBeenCalledWith(expect.objectContaining({
      alias: 'fast_clinical',
      requestedModel: 'qwen2.5:32b',
      allowLocalStyleAdapter: false,
      action: 'agent',
    }));
    expect(result).toMatchObject({
      model: 'qwen2.5:32b',
      modelVersion: 'qwen2.5:32b@sha256:test',
      requestedTemperature: 0.1,
      fallbackFromModelName: null,
    });
    expect(result.execution).toMatchObject({
      backend: 'local_ollama',
      alias: 'fast_clinical',
    });
  });

  it('uses the locked Azure runtime and ignores explicit local model overrides', async () => {
    resolveLockedRuntimeSelection.mockResolvedValueOnce({
      clinicId: '11111111-1111-1111-1111-111111111111',
      backend: 'azure_openai',
      localStyleAdapterModelName: null,
    });
    routeTextGeneration.mockResolvedValueOnce({
      text: 'Azure-backed answer.',
      execution: {
        alias: 'fast_clinical',
        backend: 'azure_openai',
        modelName: 'gpt-4o-mini',
        modelVersion: '2026-06-01',
        deployment: 'fast-clinical-au',
        localStyleAdapterModelName: null,
      },
      promptTokens: 110,
      completionTokens: 40,
      fallbackFromModelName: null,
    });

    const result = await runAgent(
      'Provide a concise operational summary.',
      {
        staffId: '22222222-2222-4222-8222-222222222222',
        clinicId: '11111111-1111-1111-1111-111111111111',
        role: 'admin',
        permissions: [],
      },
      'qwen2.5:32b',
    );

    expect(routeTextGeneration).toHaveBeenCalledWith(expect.objectContaining({
      alias: 'fast_clinical',
      requestedModel: undefined,
      allowLocalStyleAdapter: false,
    }));
    expect(result).toMatchObject({
      model: 'gpt-4o-mini',
      modelVersion: '2026-06-01',
      requestedTemperature: 0.1,
    });
    expect(result.execution).toMatchObject({
      backend: 'azure_openai',
      deployment: 'fast-clinical-au',
    });
  });
});
