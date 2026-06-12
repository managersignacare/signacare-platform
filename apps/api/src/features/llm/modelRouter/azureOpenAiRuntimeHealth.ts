import type { config as appConfig } from '../../../config/config';

export interface AzureOpenAiHealthEntry {
  status: 'OK' | 'UNCONFIGURED' | 'UNREACHABLE' | 'ERROR';
  lastCheckedAt: string;
  error?: string;
  backend?: 'azure_openai';
  authMode?: 'managed_identity' | 'api_key';
  endpoint?: string | null;
  missingEnvVars?: string[];
  configuredDeployments?: {
    fastClinical: string | null;
    bestClinical: string | null;
  };
}

export function buildAzureOpenAiHealthEntry(
  env: NodeJS.ProcessEnv = process.env,
): AzureOpenAiHealthEntry {
  const now = new Date().toISOString();
  const authMode = env['AZURE_OPENAI_AUTH_MODE'] === 'api_key' ? 'api_key' : 'managed_identity';
  const requirements = [
    ['AZURE_OPENAI_ENDPOINT', env['AZURE_OPENAI_ENDPOINT']],
    ['AZURE_OPENAI_API_VERSION', env['AZURE_OPENAI_API_VERSION']],
    ['AZURE_OPENAI_DEPLOYMENT_FAST_CLINICAL', env['AZURE_OPENAI_DEPLOYMENT_FAST_CLINICAL']],
    ['AZURE_OPENAI_DEPLOYMENT_FAST_CLINICAL_VERSION', env['AZURE_OPENAI_DEPLOYMENT_FAST_CLINICAL_VERSION']],
    ['AZURE_OPENAI_DEPLOYMENT_BEST_CLINICAL', env['AZURE_OPENAI_DEPLOYMENT_BEST_CLINICAL']],
    ['AZURE_OPENAI_DEPLOYMENT_BEST_CLINICAL_VERSION', env['AZURE_OPENAI_DEPLOYMENT_BEST_CLINICAL_VERSION']],
  ] as const;
  const missingEnvVars: string[] = requirements
    .filter(([, value]) => !value || value.trim().length === 0)
    .map(([key]) => key);

  if (authMode === 'api_key' && !(env['AZURE_OPENAI_API_KEY'] && env['AZURE_OPENAI_API_KEY']!.trim().length > 0)) {
    missingEnvVars.push('AZURE_OPENAI_API_KEY');
  }

  const endpoint = env['AZURE_OPENAI_ENDPOINT'] ?? null;
  const configuredDeployments = {
    fastClinical: env['AZURE_OPENAI_DEPLOYMENT_FAST_CLINICAL'] ?? null,
    bestClinical: env['AZURE_OPENAI_DEPLOYMENT_BEST_CLINICAL'] ?? null,
  };

  if (missingEnvVars.length > 0) {
    return {
      status: 'UNCONFIGURED',
      backend: 'azure_openai',
      authMode,
      endpoint,
      configuredDeployments,
      missingEnvVars,
      lastCheckedAt: now,
      error: `Missing Azure OpenAI runtime settings: ${missingEnvVars.join(', ')}`,
    };
  }

  return {
    status: 'OK',
    backend: 'azure_openai',
    authMode,
    endpoint,
    configuredDeployments,
    lastCheckedAt: now,
  };
}

export function buildAzureOpenAiHealthEntryFromConfig(
  config: typeof appConfig,
): AzureOpenAiHealthEntry {
  return buildAzureOpenAiHealthEntry({
    AZURE_OPENAI_ENDPOINT: config.azureOpenAi.endpoint ?? undefined,
    AZURE_OPENAI_API_KEY: config.azureOpenAi.apiKey ?? undefined,
    AZURE_OPENAI_AUTH_MODE: config.azureOpenAi.authMode,
    AZURE_OPENAI_API_VERSION: config.azureOpenAi.apiVersion,
    AZURE_OPENAI_DEPLOYMENT_FAST_CLINICAL: config.azureOpenAi.fastClinicalDeployment ?? undefined,
    AZURE_OPENAI_DEPLOYMENT_FAST_CLINICAL_VERSION: config.azureOpenAi.fastClinicalModelVersion ?? undefined,
    AZURE_OPENAI_DEPLOYMENT_BEST_CLINICAL: config.azureOpenAi.bestClinicalDeployment ?? undefined,
    AZURE_OPENAI_DEPLOYMENT_BEST_CLINICAL_VERSION: config.azureOpenAi.bestClinicalModelVersion ?? undefined,
  });
}
