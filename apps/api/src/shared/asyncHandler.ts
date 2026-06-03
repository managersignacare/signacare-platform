// apps/api/src/shared/asyncHandler.ts
//
// Wraps an async Express route handler so unhandled rejections
// are forwarded to next(err) automatically. Eliminates the need
// for try/catch + next(err) boilerplate in every handler, which
// was the root cause of 40 raw res.status(500) responses found
// during the audit.

import type { Request, Response, NextFunction } from 'express';

type AsyncHandler = (req: Request, res: Response, next: NextFunction) => Promise<void>;

export function asyncHandler(fn: AsyncHandler) {
  return (req: Request, res: Response, next: NextFunction): void => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}
