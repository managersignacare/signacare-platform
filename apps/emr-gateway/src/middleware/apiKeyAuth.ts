import type { Request, Response, NextFunction } from 'express';
import { env } from '../config/env';

export function apiKeyAuth(req: Request, res: Response, next: NextFunction): void {
  const key = req.headers['x-api-key'] as string ?? req.query.apiKey as string;
  if (!key || !env.apiKeys.includes(key)) {
    res.status(401).json({ success: false, error: { code: 'UNAUTHORIZED', message: 'Invalid or missing API key' } });
    return;
  }
  next();
}
