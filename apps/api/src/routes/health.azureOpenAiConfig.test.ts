import { describe, expect, it } from 'vitest';
import { buildAzureOpenAiHealthEntry } from './health';

describe('buildAzureOpenAiHealthEntry', () => {
  it('reports Azure OpenAI as unconfigured when required settings are absent', () => {
    const entry = buildAzureOpenAiHealthEntry({});
    expect(entry.status).toBe('UNCONFIGURED');
    expect(entry.missingEnvVars).toContain('AZURE_OPENAI_ENDPOINT');
    expect(entry.missingEnvVars).toContain('AZURE_OPENAI_DEPLOYMENT_FAST_CLINICAL');
  });

  it('requires an API key when auth mode is api_key', () => {
    const entry = buildAzureOpenAiHealthEntry({
      AZURE_OPENAI_ENDPOINT: 'https://example.openai.azure.com',
      AZURE_OPENAI_AUTH_MODE: 'api_key',
      AZURE_OPENAI_API_VERSION: '2025-01-01-preview',
      AZURE_OPENAI_DEPLOYMENT_FAST_CLINICAL: 'fast',
      AZURE_OPENAI_DEPLOYMENT_FAST_CLINICAL_VERSION: '2024-07-18',
      AZURE_OPENAI_DEPLOYMENT_BEST_CLINICAL: 'best',
      AZURE_OPENAI_DEPLOYMENT_BEST_CLINICAL_VERSION: '2024-11-20',
    });
    expect(entry.status).toBe('UNCONFIGURED');
    expect(entry.missingEnvVars).toContain('AZURE_OPENAI_API_KEY');
  });

  it('reports Azure OpenAI as configured when the full runtime contract is present', () => {
    const entry = buildAzureOpenAiHealthEntry({
      AZURE_OPENAI_ENDPOINT: 'https://example.openai.azure.com',
      AZURE_OPENAI_AUTH_MODE: 'managed_identity',
      AZURE_OPENAI_API_VERSION: '2025-01-01-preview',
      AZURE_OPENAI_DEPLOYMENT_FAST_CLINICAL: 'fast',
      AZURE_OPENAI_DEPLOYMENT_FAST_CLINICAL_VERSION: '2024-07-18',
      AZURE_OPENAI_DEPLOYMENT_BEST_CLINICAL: 'best',
      AZURE_OPENAI_DEPLOYMENT_BEST_CLINICAL_VERSION: '2024-11-20',
    });
    expect(entry.status).toBe('OK');
    expect(entry.missingEnvVars).toBeUndefined();
  });
});
