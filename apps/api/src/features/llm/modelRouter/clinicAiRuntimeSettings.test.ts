import { describe, expect, it } from 'vitest';
import { AppError } from '../../../shared/errors';
import { assertClinicAiRuntimeSelectionSupported } from './clinicAiRuntimeSettings';

describe('assertClinicAiRuntimeSelectionSupported', () => {
  it('allows the default ollama lane without hosted runtime config', () => {
    expect(() => assertClinicAiRuntimeSelectionSupported('local_ollama', {})).not.toThrow();
  });

  it('blocks explicit openai selection when hosted runtime config is incomplete', () => {
    expect(() => assertClinicAiRuntimeSelectionSupported('azure_openai', {})).toThrow(AppError);
    expect(() => assertClinicAiRuntimeSelectionSupported('azure_openai', {})).toThrow(
      'OpenAI (Azure-hosted) cannot be selected until the hosted runtime is fully configured and healthy.',
    );
  });

  it('allows explicit openai selection when hosted runtime config is complete', () => {
    const env = {
      AZURE_OPENAI_ENDPOINT: 'https://example.openai.azure.com',
      AZURE_OPENAI_AUTH_MODE: 'managed_identity',
      AZURE_OPENAI_API_VERSION: '2025-01-01-preview',
      AZURE_OPENAI_DEPLOYMENT_FAST_CLINICAL: 'fast-clinical',
      AZURE_OPENAI_DEPLOYMENT_FAST_CLINICAL_VERSION: '2024-07-18',
      AZURE_OPENAI_DEPLOYMENT_BEST_CLINICAL: 'best-clinical',
      AZURE_OPENAI_DEPLOYMENT_BEST_CLINICAL_VERSION: '2024-11-20',
    } as NodeJS.ProcessEnv;

    expect(() => assertClinicAiRuntimeSelectionSupported('azure_openai', env)).not.toThrow();
  });
});
