import { AI_JOB_QUEUE_UNAVAILABLE_CODE, AI_JOB_QUEUE_UNAVAILABLE_MESSAGE } from './aiJobRouteSupport';

const INTERNAL_AI_JOB_ERROR_PATTERNS = [
  /invalid input syntax for type json/i,
  /update\s+"ai_job_runs"/i,
  /relation\s+"[^"]+"\s+does not exist/i,
  /syntax error at or near/i,
  /violates .* constraint/i,
  /database error/i,
];

const AI_JOB_RESULT_PERSISTENCE_FAILED_MESSAGE =
  'AI output was generated but could not be saved durably. Retry shortly or contact your administrator if it persists.';

export function toClinicianFacingAiJobErrorMessage(params: {
  errorCode?: string | null;
  errorMessage?: string | null;
}): string | null {
  const errorCode = params.errorCode?.trim() || null;
  const errorMessage = params.errorMessage?.trim() || null;

  if (!errorCode && !errorMessage) return null;

  if (errorCode === 'AI_MODEL_UNAVAILABLE') {
    return errorMessage ?? 'AI generation is unavailable because the configured model runtime is not reachable.';
  }

  if (errorCode === AI_JOB_QUEUE_UNAVAILABLE_CODE) {
    return AI_JOB_QUEUE_UNAVAILABLE_MESSAGE;
  }

  if (errorCode === 'AI_OUTPUT_VALIDATION_FAILED') {
    return 'AI output could not be validated and was not saved. Retry shortly or review the source material.';
  }

  if (errorCode === 'AI_JOB_RESULT_PERSISTENCE_FAILED') {
    return AI_JOB_RESULT_PERSISTENCE_FAILED_MESSAGE;
  }

  if (errorMessage && INTERNAL_AI_JOB_ERROR_PATTERNS.some((pattern) => pattern.test(errorMessage))) {
    return AI_JOB_RESULT_PERSISTENCE_FAILED_MESSAGE;
  }

  return errorMessage;
}
