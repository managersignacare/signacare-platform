import { describe, expect, it } from 'vitest';
import {
  isBenignRedisLifecycleRejection,
  isRedisConnectionClosedError,
} from '../src/shared/redisErrorClassification';

describe('redisErrorClassification', () => {
  it('recognises the closed-connection error message', () => {
    expect(isRedisConnectionClosedError(new Error('Connection is closed.'))).toBe(true);
    expect(isRedisConnectionClosedError(new Error('Socket closed by peer'))).toBe(false);
    expect(isRedisConnectionClosedError('Connection is closed.')).toBe(false);
  });

  it('suppresses ioredis lifecycle shutdown noise only', () => {
    const redisShutdownError = new Error('Connection is closed.');
    redisShutdownError.stack = [
      'Error: Connection is closed.',
      '    at close (/node_modules/ioredis/built/redis/event_handler.js:1:1)',
    ].join('\n');

    const nonRedisError = new Error('Connection is closed.');
    nonRedisError.stack = [
      'Error: Connection is closed.',
      '    at save (/app/dist/features/tasks/taskService.js:10:5)',
    ].join('\n');

    expect(isBenignRedisLifecycleRejection(redisShutdownError)).toBe(true);
    expect(isBenignRedisLifecycleRejection(nonRedisError)).toBe(false);
    expect(isBenignRedisLifecycleRejection(new Error('Redis timed out'))).toBe(false);
  });
});
