import { normalizeAiJobResultJson, normalizeAiJobWarnings } from '../../features/llm/aiJobJsonb';

interface AiJobResultLike {
  payload?: unknown;
  validationWarnings: string[];
}

export function buildDurableAiJobResult<T extends AiJobResultLike>(jobResult: T): T {
  return {
    ...jobResult,
    payload: normalizeAiJobResultJson(jobResult.payload),
    validationWarnings: normalizeAiJobWarnings(jobResult.validationWarnings),
  };
}
