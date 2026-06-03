import { AppError } from './errors';
import { withTimeout } from './observability/withTimeout';

const AUTH_CHAIN_STAGE_TIMEOUT_MS_DEFAULT = 1200;
const AUTH_CHAIN_STAGE_TIMEOUT_MS_MAX = 10_000;

export function resolveAuthChainStageTimeoutMs(): number {
  const raw = process.env.AUTH_CHAIN_STAGE_TIMEOUT_MS;
  if (!raw) {
    return AUTH_CHAIN_STAGE_TIMEOUT_MS_DEFAULT;
  }

  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return AUTH_CHAIN_STAGE_TIMEOUT_MS_DEFAULT;
  }

  return Math.min(parsed, AUTH_CHAIN_STAGE_TIMEOUT_MS_MAX);
}

export async function withAuthChainStageTimeout<T>(
  stage: string,
  promise: Promise<T>,
): Promise<T> {
  return await withTimeout(
    promise,
    resolveAuthChainStageTimeoutMs(),
    stage,
  );
}

export function isAuthChainTimeoutError(err: unknown): err is AppError {
  return err instanceof AppError && err.code === 'UPSTREAM_TIMEOUT';
}
