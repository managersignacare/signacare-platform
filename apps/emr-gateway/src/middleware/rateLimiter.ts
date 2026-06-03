import rateLimit from 'express-rate-limit';
import { env } from '../config/env';

export const rateLimiter = rateLimit({
  windowMs: env.rateLimitWindowMs,
  max: env.rateLimitMax,
  keyGenerator: (req) => req.headers['x-api-key'] as string ?? req.ip ?? 'unknown',
  message: { success: false, error: { code: 'RATE_LIMITED', message: 'Too many requests. Please slow down.' } },
});
