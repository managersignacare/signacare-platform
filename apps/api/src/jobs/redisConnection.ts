import IORedis from 'ioredis';
import { config } from '../config';

export const redisConnection = new IORedis(config.REDIS_URL ?? 'redis://localhost:6379', { maxRetriesPerRequest: null });
