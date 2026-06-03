export const env = {
  port: parseInt(process.env.PORT ?? '4002', 10),
  nodeEnv: process.env.NODE_ENV ?? 'development',
  mongoUri: process.env.MONGO_URI ?? '',
  apiKeys: (process.env.EMR_API_KEYS ?? '').split(',').map(k => k.trim()).filter(Boolean),
  rateLimitWindowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS ?? '60000', 10),
  rateLimitMax: parseInt(process.env.RATE_LIMIT_MAX ?? '100', 10),
  corsOrigin: process.env.CORS_ORIGIN ?? '*',
};
