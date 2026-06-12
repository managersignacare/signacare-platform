import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  getToken: vi.fn(),
  config: {
    azureOpenAi: {
      endpoint: 'https://signacare-openai.openai.azure.com/',
      apiKey: null as string | null,
      authMode: 'managed_identity' as 'managed_identity' | 'api_key',
      privateNetworkEnforced: true,
      apiVersion: '2025-01-01-preview',
      fastClinicalDeployment: 'fast-clinical',
      bestClinicalDeployment: 'best-clinical',
      fastClinicalModelVersion: '2024-07-18',
      bestClinicalModelVersion: '2024-11-20',
    },
    NODE_ENV: 'test',
  },
}));

vi.mock('../../src/config/config', () => ({
  config: state.config,
}));

vi.mock('@azure/identity', () => ({
  ManagedIdentityCredential: vi.fn(function ManagedIdentityCredential() {
    return {
      getToken: state.getToken,
    };
  }),
}));

const { callAzureOpenAiChat } = await import('../../src/features/llm/modelRouter/azureOpenAiAdapter');

function successfulAzureResponse(): Response {
  return new Response(JSON.stringify({
    model: 'gpt-4o-mini-2024-07-18',
    usage: {
      prompt_tokens: 1200,
      completion_tokens: 120,
      prompt_tokens_details: { cached_tokens: 1024 },
    },
    choices: [
      { message: { content: 'Generated clinical draft.' } },
    ],
  }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

describe('azureOpenAiAdapter', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    state.getToken.mockReset();
    state.config.azureOpenAi.endpoint = 'https://signacare-openai.openai.azure.com/';
    state.config.azureOpenAi.apiKey = null;
    state.config.azureOpenAi.authMode = 'managed_identity';
    state.config.azureOpenAi.privateNetworkEnforced = true;
    state.config.azureOpenAi.apiVersion = '2025-01-01-preview';
    state.config.azureOpenAi.fastClinicalDeployment = 'fast-clinical';
    state.config.azureOpenAi.bestClinicalDeployment = 'best-clinical';
    state.config.azureOpenAi.fastClinicalModelVersion = '2024-07-18';
    state.config.azureOpenAi.bestClinicalModelVersion = '2024-11-20';
    state.config.NODE_ENV = 'test';
    state.getToken.mockResolvedValue({ token: 'entra-token' });
    vi.stubGlobal('fetch', vi.fn(async () => successfulAzureResponse()));
  });

  it('uses Microsoft Entra managed identity by default for Azure OpenAI calls', async () => {
    const result = await callAzureOpenAiChat({
      alias: 'fast_clinical',
      prompt: 'Draft a brief summary.',
      system: 'Clinical assistant.',
    });

    expect(state.getToken).toHaveBeenCalledWith('https://cognitiveservices.azure.com/.default');
    expect(result).toMatchObject({
      text: 'Generated clinical draft.',
      deployment: 'fast-clinical',
      modelVersion: '2024-07-18',
      cachedPromptTokens: 1024,
    });
    const [, init] = vi.mocked(fetch).mock.calls[0]!;
    expect(init?.headers).toMatchObject({
      Authorization: 'Bearer entra-token',
    });
    expect(init?.headers).not.toHaveProperty('api-key');
  });

  it('allows explicit API-key mode for non-private local/dev break-glass deployments only', async () => {
    state.config.azureOpenAi.authMode = 'api_key';
    state.config.azureOpenAi.privateNetworkEnforced = false;
    state.config.azureOpenAi.apiKey = 'dev-api-key';

    await callAzureOpenAiChat({
      alias: 'best_clinical',
      prompt: 'Draft formulation.',
    });

    expect(state.getToken).not.toHaveBeenCalled();
    const [, init] = vi.mocked(fetch).mock.calls[0]!;
    expect(init?.headers).toMatchObject({
      'api-key': 'dev-api-key',
    });
    expect(init?.headers).not.toHaveProperty('Authorization');
  });

  it('fails closed when API-key mode is attempted in the private lane', async () => {
    state.config.azureOpenAi.authMode = 'api_key';
    state.config.azureOpenAi.privateNetworkEnforced = true;
    state.config.azureOpenAi.apiKey = 'should-not-be-used';

    await expect(callAzureOpenAiChat({
      alias: 'best_clinical',
      prompt: 'Draft formulation.',
    })).rejects.toMatchObject({
      status: 503,
      code: 'AI_BACKEND_UNAVAILABLE',
    });

    expect(fetch).not.toHaveBeenCalled();
  });

  it('fails closed when API-key mode is attempted in production even without the private flag', async () => {
    state.config.NODE_ENV = 'production';
    state.config.azureOpenAi.authMode = 'api_key';
    state.config.azureOpenAi.privateNetworkEnforced = false;
    state.config.azureOpenAi.apiKey = 'should-not-be-used';

    await expect(callAzureOpenAiChat({
      alias: 'best_clinical',
      prompt: 'Draft formulation.',
    })).rejects.toMatchObject({
      status: 503,
      code: 'AI_BACKEND_UNAVAILABLE',
    });

    expect(fetch).not.toHaveBeenCalled();
  });

  it('fails closed when production Azure calls lack the private-network assertion', async () => {
    state.config.NODE_ENV = 'production';
    state.config.azureOpenAi.authMode = 'managed_identity';
    state.config.azureOpenAi.privateNetworkEnforced = false;

    await expect(callAzureOpenAiChat({
      alias: 'fast_clinical',
      prompt: 'Draft a brief summary.',
    })).rejects.toMatchObject({
      status: 503,
      code: 'AI_BACKEND_UNAVAILABLE',
      details: expect.objectContaining({
        privateNetworkEnforced: false,
      }),
    });

    expect(fetch).not.toHaveBeenCalled();
  });

  it('uses the pinned configured deployment version for Azure execution provenance', async () => {
    const result = await callAzureOpenAiChat({
      alias: 'best_clinical',
      prompt: 'Draft formulation.',
    });

    expect(result).toMatchObject({
      deployment: 'best-clinical',
      modelName: 'gpt-4o-mini-2024-07-18',
      modelVersion: '2024-11-20',
    });
  });

  it('fails closed when the selected Azure deployment is missing its pinned model version', async () => {
    state.config.azureOpenAi.fastClinicalModelVersion = null;

    await expect(callAzureOpenAiChat({
      alias: 'fast_clinical',
      prompt: 'Draft a brief summary.',
    })).rejects.toMatchObject({
      status: 503,
      code: 'AI_BACKEND_UNAVAILABLE',
      details: expect.objectContaining({
        missingModelVersion: true,
      }),
    });

    expect(fetch).not.toHaveBeenCalled();
  });

  it('fails closed when managed identity cannot acquire a bearer token', async () => {
    state.getToken.mockResolvedValue(null);

    await expect(callAzureOpenAiChat({
      alias: 'fast_clinical',
      prompt: 'Draft a brief summary.',
    })).rejects.toMatchObject({
      status: 503,
      code: 'AI_BACKEND_UNAVAILABLE',
    });

    expect(fetch).not.toHaveBeenCalled();
  });
});
