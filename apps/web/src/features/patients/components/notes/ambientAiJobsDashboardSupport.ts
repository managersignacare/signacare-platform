import { SignacareApiError } from '../../../../shared/services/apiClient';

export interface AmbientAiJobsFeedback {
  message: string;
  severity: 'error' | 'info' | 'warning';
}

const RECOVERY_UNAVAILABLE_MESSAGE =
  'Async scribe recovery is temporarily unavailable in this environment. Recording and note drafting can still continue in the current note.';

export function classifyAmbientAiJobsLoadError(err: unknown): AmbientAiJobsFeedback {
  if (err instanceof SignacareApiError) {
    if (err.code === 'SCHEMA_MISMATCH' || err.status === 404) {
      return {
        message: RECOVERY_UNAVAILABLE_MESSAGE,
        severity: 'info',
      };
    }
    if (err.code === 'MODULE_READ_DENIED' || err.code === 'FORBIDDEN') {
      return {
        message: 'This account cannot open the async scribe recovery dashboard.',
        severity: 'info',
      };
    }
    if (err.code === 'AI_JOB_LIST_ERROR' || err.status >= 500) {
      return {
        message: RECOVERY_UNAVAILABLE_MESSAGE,
        severity: 'warning',
      };
    }
  }

  return {
    message: err instanceof Error ? err.message : 'Failed to load async scribe jobs.',
    severity: 'error',
  };
}
