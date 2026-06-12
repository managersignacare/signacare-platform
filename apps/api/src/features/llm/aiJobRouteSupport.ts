import { AppError } from '../../shared/errors';

const AI_JOB_STORE_UNAVAILABLE_SQLSTATES = new Set(['42P01', '42703']);
const AI_JOB_QUEUE_UNAVAILABLE_NODE_CODES = new Set([
  'ECONNREFUSED',
  'ECONNRESET',
  'EHOSTUNREACH',
  'ENETUNREACH',
  'ENOTFOUND',
  'ETIMEDOUT',
  'EAI_AGAIN',
]);
const AI_JOB_QUEUE_UNAVAILABLE_MESSAGE_PATTERNS = [
  /connection is closed/i,
  /connection is not open/i,
  /connect econnrefused/i,
  /failed to connect to redis/i,
  /getaddrinfo eai_again/i,
  /max retries per request/i,
  /ready check failed/i,
  /timed out/i,
];

export const AI_JOB_QUEUE_UNAVAILABLE_CODE = 'AI_JOB_QUEUE_UNAVAILABLE';
export const AI_JOB_QUEUE_UNAVAILABLE_MESSAGE =
  'Async AI processing is temporarily unavailable because the background AI queue cannot be reached. Retry shortly or contact your administrator if it persists.';

export function isAiJobStoreUnavailableError(err: unknown): boolean {
  return (
    err instanceof Error &&
    AI_JOB_STORE_UNAVAILABLE_SQLSTATES.has(
      ((err as { code?: string }).code ?? '').toUpperCase(),
    )
  );
}

export function isAiJobQueueUnavailableError(err: unknown): boolean {
  if (!(err instanceof Error)) {
    return false;
  }

  const code = ((err as { code?: string }).code ?? '').toUpperCase();
  if (AI_JOB_QUEUE_UNAVAILABLE_NODE_CODES.has(code)) {
    return true;
  }

  return AI_JOB_QUEUE_UNAVAILABLE_MESSAGE_PATTERNS.some((pattern) => pattern.test(err.message));
}

export function toAiJobQueueSubmitError(err: unknown): AppError {
  if (isAiJobQueueUnavailableError(err)) {
    return new AppError(
      AI_JOB_QUEUE_UNAVAILABLE_MESSAGE,
      503,
      AI_JOB_QUEUE_UNAVAILABLE_CODE,
    );
  }

  return new AppError('Failed to queue AI job', 500, 'JOB_QUEUE_ERROR');
}
