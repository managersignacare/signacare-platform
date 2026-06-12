import { resolvePositiveIntEnv } from './positiveIntEnv';

const DEFAULT_LOCAL_LLM_GENERATE_TIMEOUT_MS = 10 * 60 * 1000;
const DEFAULT_HTTP_GRACE_MS = 60 * 1000;
const MAX_LLM_HTTP_TIMEOUT_MS = 31 * 60 * 1000;
const LONG_RUNNING_AI_PATH_MARKERS = [
  '/llm/',
  '/scribe/',
  '/voice/',
  '/documents/',
] as const;

export function isLongRunningAiHttpPath(path: string): boolean {
  return LONG_RUNNING_AI_PATH_MARKERS.some((marker) => path.includes(marker));
}

export function resolveLlmHttpTimeoutMs(env: NodeJS.ProcessEnv = process.env): number {
  const localGenerateTimeoutMs = resolvePositiveIntEnv(
    'LOCAL_LLM_GENERATE_TIMEOUT_MS',
    {
      env,
      fallback: DEFAULT_LOCAL_LLM_GENERATE_TIMEOUT_MS,
      max: MAX_LLM_HTTP_TIMEOUT_MS - DEFAULT_HTTP_GRACE_MS,
      loggerContext: { configSurface: 'llm_http_timeout' },
    },
  );

  return resolvePositiveIntEnv(
    'LLM_HTTP_TIMEOUT_MS',
    {
      env,
      fallback: localGenerateTimeoutMs + DEFAULT_HTTP_GRACE_MS,
      max: MAX_LLM_HTTP_TIMEOUT_MS,
      loggerContext: { configSurface: 'llm_http_timeout' },
    },
  );
}
