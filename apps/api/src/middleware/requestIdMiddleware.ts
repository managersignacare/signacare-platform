// apps/api/src/middleware/requestIdMiddleware.ts
//
// Generates or propagates a per-request correlation ID. Every log
// entry, audit row, and error response includes this ID so support
// tickets can trace a single request across the full pipeline.

import type { Request, Response, NextFunction } from 'express';
import { randomUUID } from 'crypto';

const HEADER = 'x-request-id';

export function requestIdMiddleware(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  const existing = req.headers[HEADER];
  const requestId = typeof existing === 'string' && existing.length > 0
    ? existing
    : randomUUID();
  req.requestId = requestId;
  res.setHeader('X-Request-ID', requestId);
  next();
}
