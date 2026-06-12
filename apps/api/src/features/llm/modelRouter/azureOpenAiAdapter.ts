import type { AiTextGenerationModelAlias } from '@signacare/shared';
import { AppError } from '../../../shared/errors';
import { config } from '../../../config/config';

const AZURE_OPENAI_SCOPE = 'https://cognitiveservices.azure.com/.default';

interface AzureChatGenerationRequest {
  alias: AiTextGenerationModelAlias;
  prompt: string;
  system?: string;
  temperature?: number;
  maxTokens?: number;
}

export interface AzureChatGenerationResult {
  text: string;
  modelName: string;
  modelVersion: string;
  deployment: string;
  promptTokens: number | null;
  completionTokens: number | null;
  cachedPromptTokens: number | null;
}

type AzureChatResponse = {
  model?: string;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    prompt_tokens_details?: {
      cached_tokens?: number;
    };
  };
  choices?: AzureChoice[];
};

type AzureMessageContentPart = { text?: string };
type AzureChoice = {
  message?: {
    content?: string | AzureMessageContentPart[];
  };
};

type AzureTokenCredential = {
  getToken(scope: string): Promise<{ token: string } | null>;
};

let azureManagedIdentityCredential: AzureTokenCredential | null = null;

function normalizeCachedTokens(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    return null;
  }
  return Math.trunc(value);
}

function resolveDeployment(alias: AiTextGenerationModelAlias): { deployment: string; modelVersion: string | null } {
  if (alias === 'best_clinical' || alias === 'court_report_reasoning') {
    return {
      deployment: config.azureOpenAi?.bestClinicalDeployment ?? '',
      modelVersion: config.azureOpenAi?.bestClinicalModelVersion ?? null,
    };
  }

  return {
    deployment: config.azureOpenAi?.fastClinicalDeployment ?? '',
    modelVersion: config.azureOpenAi?.fastClinicalModelVersion ?? null,
  };
}

function assertAzureConfigured(deployment: string, modelVersion: string | null): {
  endpoint: string;
  apiKey: string | null;
  authMode: 'managed_identity' | 'api_key';
  apiVersion: string;
  modelVersion: string;
} {
  const endpoint = config.azureOpenAi?.endpoint?.trim() ?? '';
  const apiKey = config.azureOpenAi?.apiKey?.trim() ?? '';
  const authMode = config.azureOpenAi?.authMode ?? 'managed_identity';
  const apiVersion = config.azureOpenAi?.apiVersion?.trim() ?? '';
  const privateNetworkEnforced = config.azureOpenAi?.privateNetworkEnforced ?? false;

  if (!endpoint || !apiVersion || !deployment || !modelVersion || (authMode === 'api_key' && !apiKey)) {
    throw new AppError(
      'Azure OpenAI backend selected but Azure runtime configuration is incomplete',
      503,
      'AI_BACKEND_UNAVAILABLE',
      {
        missingEndpoint: !endpoint,
        missingApiKey: authMode === 'api_key' && !apiKey,
        missingManagedIdentity: authMode === 'managed_identity' ? false : undefined,
        missingApiVersion: !apiVersion,
        missingDeployment: !deployment,
        missingModelVersion: !modelVersion,
        authMode,
      },
    );
  }

  if (config.NODE_ENV === 'production' && !privateNetworkEnforced) {
    throw new AppError(
      'Azure OpenAI private-network enforcement is required for production Azure model calls',
      503,
      'AI_BACKEND_UNAVAILABLE',
      {
        provider: 'azure_openai',
        privateNetworkEnforced,
        nodeEnv: config.NODE_ENV,
      },
    );
  }

  if (authMode === 'api_key' && (config.NODE_ENV === 'production' || privateNetworkEnforced)) {
    throw new AppError(
      'Azure OpenAI API-key auth is not allowed for production or private-lane deployments',
      503,
      'AI_BACKEND_UNAVAILABLE',
      {
        provider: 'azure_openai',
        authMode,
        privateNetworkEnforced,
        nodeEnv: config.NODE_ENV,
      },
    );
  }

  return { endpoint, apiKey: apiKey || null, authMode, apiVersion, modelVersion };
}

function flattenContent(content: string | AzureMessageContentPart[] | undefined): string {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .map((item) => (typeof item?.text === 'string' ? item.text : ''))
      .join('')
      .trim();
  }
  return '';
}

async function getAzureManagedIdentityCredential(): Promise<AzureTokenCredential> {
  if (azureManagedIdentityCredential) return azureManagedIdentityCredential;

  const { ManagedIdentityCredential } = await import('@azure/identity');
  azureManagedIdentityCredential = new ManagedIdentityCredential();
  return azureManagedIdentityCredential;
}

async function buildAzureAuthHeaders(
  auth: Pick<ReturnType<typeof assertAzureConfigured>, 'apiKey' | 'authMode'>,
): Promise<Record<string, string>> {
  if (auth.authMode === 'api_key') {
    return { 'api-key': auth.apiKey ?? '' };
  }

  const credential = await getAzureManagedIdentityCredential();
  const accessToken = await credential.getToken(AZURE_OPENAI_SCOPE);
  if (!accessToken?.token) {
    throw new AppError(
      'Azure OpenAI managed identity token could not be acquired',
      503,
      'AI_BACKEND_UNAVAILABLE',
      { provider: 'azure_openai', authMode: 'managed_identity' },
    );
  }

  return { Authorization: `Bearer ${accessToken.token}` };
}

export async function callAzureOpenAiChat(
  request: AzureChatGenerationRequest,
): Promise<AzureChatGenerationResult> {
  const { deployment, modelVersion } = resolveDeployment(request.alias);
  const azureConfig = assertAzureConfigured(deployment, modelVersion);
  const { endpoint, apiVersion } = azureConfig;
  const url = `${endpoint.replace(/\/$/, '')}/openai/deployments/${deployment}/chat/completions?api-version=${encodeURIComponent(apiVersion)}`;
  const authHeaders = await buildAzureAuthHeaders(azureConfig);

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...authHeaders,
    },
    body: JSON.stringify({
      messages: [
        ...(request.system ? [{ role: 'system', content: request.system }] : []),
        { role: 'user', content: request.prompt },
      ],
      temperature: request.temperature ?? 0.2,
      max_tokens: request.maxTokens ?? 2048,
    }),
  });

  if (!response.ok) {
    throw new AppError(
      `Azure OpenAI request failed with status ${response.status}`,
      502,
      'AI_PROVIDER_ERROR',
      { status: response.status, provider: 'azure_openai', deployment },
    );
  }

  const payload = (await response.json()) as AzureChatResponse;
  const text = flattenContent(payload.choices?.[0]?.message?.content);
  if (!text) {
    throw new AppError(
      'Azure OpenAI returned an empty completion',
      502,
      'AI_PROVIDER_EMPTY_RESPONSE',
      { provider: 'azure_openai', deployment },
    );
  }

  return {
    text,
    modelName: payload.model ?? deployment,
    modelVersion: azureConfig.modelVersion,
    deployment,
    promptTokens: payload.usage?.prompt_tokens ?? null,
    completionTokens: payload.usage?.completion_tokens ?? null,
    cachedPromptTokens: normalizeCachedTokens(
      payload.usage?.prompt_tokens_details?.cached_tokens,
    ),
  };
}
