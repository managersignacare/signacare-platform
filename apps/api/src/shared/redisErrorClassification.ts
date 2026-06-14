export function isRedisConnectionClosedError(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }

  return error.message.includes('Connection is closed');
}

export function isBenignRedisLifecycleRejection(error: unknown): boolean {
  if (!isRedisConnectionClosedError(error)) {
    return false;
  }

  const stack = error instanceof Error ? error.stack ?? '' : '';
  return stack.includes('ioredis');
}
