import { SignacareApiError } from './apiClient';

function trimActionLabel(actionLabel: string | undefined, fallback: string): string {
  const normalized = actionLabel?.trim();
  return normalized && normalized.length > 0 ? normalized : fallback;
}

export function isClinicalAiQueueUnavailableError(err: unknown): err is SignacareApiError {
  return (
    err instanceof SignacareApiError &&
    err.code === 'AI_JOB_QUEUE_UNAVAILABLE'
  );
}

export function isClinicalAiJobQueueSubmitError(err: unknown): err is SignacareApiError {
  return (
    err instanceof SignacareApiError &&
    (err.code === 'AI_JOB_QUEUE_UNAVAILABLE' || err.code === 'JOB_QUEUE_ERROR')
  );
}

export function formatClinicalAiQueueUnavailableMessage(actionLabel?: string): string {
  const subject = trimActionLabel(actionLabel, 'Async AI generation');
  return `${subject} is temporarily unavailable because the background AI queue cannot be reached. Retry shortly or contact your administrator if it persists.`;
}

export function formatClinicalAiJobQueueSubmitErrorMessage(actionLabel?: string): string {
  const subject = trimActionLabel(actionLabel, 'Async AI generation');
  return `${subject} could not be queued for background processing. Retry shortly or contact your administrator if it persists.`;
}

export function normalizeClinicalAiJobSubmitError(err: unknown, actionLabel?: string): unknown {
  if (isClinicalAiQueueUnavailableError(err)) {
    return new SignacareApiError(
      formatClinicalAiQueueUnavailableMessage(actionLabel),
      err.code,
      err.status,
      err.details,
    );
  }

  if (err instanceof SignacareApiError && err.code === 'JOB_QUEUE_ERROR') {
    return new SignacareApiError(
      formatClinicalAiJobQueueSubmitErrorMessage(actionLabel),
      err.code,
      err.status,
      err.details,
    );
  }

  return err;
}
