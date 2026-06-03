import { AppError } from '../errors';

export async function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  stage: string,
): Promise<T> {
  const normalizedStage = stage.trim();
  if (!normalizedStage) {
    throw new Error('withTimeout stage is required');
  }
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    throw new Error('withTimeout timeoutMs must be > 0');
  }

  return await new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(
        new AppError(
          `Upstream stage '${normalizedStage}' timed out after ${timeoutMs}ms`,
          503,
          'UPSTREAM_TIMEOUT',
          {
            stage: normalizedStage,
            timeoutMs,
          },
        ),
      );
    }, timeoutMs);

    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}
