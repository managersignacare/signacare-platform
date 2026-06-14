// apps/api/src/config/redis.ts
// Redis logical DB allocation:
//   DB 0: Default (sessions, general)
//   DB 1: Rate limiting
//   DB 2: BullMQ job queues
//   DB 3: SSE pub/sub + cache
import Redis from 'ioredis';
import { logger } from '../utils/logger';
import { isRedisConnectionClosedError } from '../shared/redisErrorClassification';

const baseUrl = process.env.REDIS_URL ?? 'redis://localhost:6379';

type ManagedRedisClient = Pick<Redis, 'status' | 'connect' | 'ping' | 'quit' | 'disconnect' | 'on'>;

function bindRedisLifecycleLogging(
  client: ManagedRedisClient,
  name: 'redis' | 'redisRateLimit' | 'redisCache',
): void {
  client.on('error', (err: Error) => {
    const message = err.message ?? String(err);
    if (message.includes('Connection is closed') && (client.status === 'close' || client.status === 'end')) {
      return;
    }
    logger.error({ err: message, client: name }, 'Redis connection error');
  });

  client.on('connect', () => {
    if (name === 'redis') {
      logger.info('Redis connected');
    }
  });
}

async function closeRedisClient(
  client: ManagedRedisClient,
  name: 'redis' | 'redisRateLimit' | 'redisCache',
): Promise<void> {
  const status = client.status;

  if (status === 'wait' || status === 'end') {
    return;
  }

  if (status === 'close' || status === 'reconnecting') {
    client.disconnect(false);
    return;
  }

  try {
    await client.quit();
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (isRedisConnectionClosedError(err)) {
      return;
    }
    logger.warn({ err: message, client: name }, 'Redis shutdown cleanup fell back to best-effort disconnect');
    client.disconnect(false);
  }
}

// Primary Redis instance (DB 0 — sessions, general)
export const redis = new Redis(baseUrl + '/0', {
  lazyConnect: true,
  maxRetriesPerRequest: 3,
  retryStrategy: (times) => {
    if (times > 10) return null;
    return Math.min(times * 200, 5000);
  },
});

// Rate limiting Redis (DB 1)
export const redisRateLimit = new Redis(baseUrl + '/1', {
  lazyConnect: true,
  maxRetriesPerRequest: 3,
});

// Cache Redis (DB 3)
export const redisCache = new Redis(baseUrl + '/3', {
  lazyConnect: true,
  maxRetriesPerRequest: 1,
});

bindRedisLifecycleLogging(redis, 'redis');
bindRedisLifecycleLogging(redisRateLimit, 'redisRateLimit');
bindRedisLifecycleLogging(redisCache, 'redisCache');

/**
 * Connect to Redis and verify. Call before server.listen().
 * Returns true if connected, false if unavailable (server can still start without Redis).
 */
export async function connectRedis(): Promise<boolean> {
  try {
    const status = redis.status;
    if (status === 'wait' || status === 'end' || status === 'close') {
      await redis.connect();
    }
    await redis.ping();
    logger.info('Redis ping OK');
    return true;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    // ioredis throws on repeated connect() while still being healthy.
    // Treat this idempotent path as success and continue with ping.
    if (message.includes('already connecting/connected')) {
      try {
        await redis.ping();
        logger.info('Redis ping OK');
        return true;
      } catch {
        // Fall through to the standard unavailable warning below.
      }
    }
    logger.warn({ err, message }, 'Redis unavailable — rate limiting will use in-memory fallback');
    return false;
  }
}

export async function shutdownRedisClients(): Promise<void> {
  await Promise.all([
    closeRedisClient(redis, 'redis'),
    closeRedisClient(redisRateLimit, 'redisRateLimit'),
    closeRedisClient(redisCache, 'redisCache'),
  ]);
}
