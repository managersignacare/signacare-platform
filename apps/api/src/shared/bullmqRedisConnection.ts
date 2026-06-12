import IORedis from 'ioredis';
import { config } from '../config';

/**
 * BullMQ must use the same Redis URL as readiness and app runtime clients.
 * Azure Cache for Redis commonly requires TLS on port 6380, so reconstructing
 * a host/6379 object from REDIS_HOST is not safe.
 */
export function createBullmqRedisConnection(): IORedis {
  return new IORedis(config.REDIS_URL ?? process.env.REDIS_URL ?? 'redis://localhost:6379', {
    maxRetriesPerRequest: null,
  });
}
