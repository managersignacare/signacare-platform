import { logger } from '../utils/logger';

export interface PositiveIntEnvOptions {
  fallback: number;
  max: number;
  env?: NodeJS.ProcessEnv;
  failClosed?: boolean;
  loggerContext?: Record<string, unknown>;
}

function shouldFailClosed(env: NodeJS.ProcessEnv, options: PositiveIntEnvOptions): boolean {
  return options.failClosed ?? env.NODE_ENV === 'production';
}

function failOrFallback(input: {
  kind: string;
  name: string;
  value: unknown;
  fallback: number;
  message: string;
  options: PositiveIntEnvOptions;
  env: NodeJS.ProcessEnv;
}): number {
  const logContext = {
    kind: input.kind,
    name: input.name,
    value: input.value,
    fallback: input.fallback,
    ...input.options.loggerContext,
  };
  if (shouldFailClosed(input.env, input.options)) {
    logger.error(logContext, input.message);
    throw new Error(`${input.name}: ${input.message}`);
  }
  logger.warn(logContext, `${input.message}; using fallback`);
  return input.fallback;
}

export function resolvePositiveIntEnv(
  name: string,
  options: PositiveIntEnvOptions,
): number {
  const env = options.env ?? process.env;
  const raw = env[name]?.trim();
  if (!raw) return options.fallback;

  if (!/^[1-9]\d*$/.test(raw)) {
    return failOrFallback({
      kind: 'invalid_positive_int_env',
      name,
      value: raw,
      fallback: options.fallback,
      message: 'Invalid positive integer env var',
      options,
      env,
    });
  }

  const parsed = Number(raw);
  if (!Number.isSafeInteger(parsed)) {
    return failOrFallback({
      kind: 'unsafe_positive_int_env',
      name,
      value: raw,
      fallback: options.fallback,
      message: 'Positive integer env var exceeds safe integer range',
      options,
      env,
    });
  }

  if (parsed > options.max) {
    const logContext = {
      kind: 'clamped_positive_int_env',
      name,
      value: parsed,
      max: options.max,
      ...options.loggerContext,
    };
    if (shouldFailClosed(env, options)) {
      logger.error(logContext, 'Positive integer env var exceeds safety cap');
      throw new Error(`${name}: Positive integer env var exceeds safety cap`);
    }
    logger.warn(logContext, 'Positive integer env var exceeds safety cap; clamping');
    return options.max;
  }

  return parsed;
}
