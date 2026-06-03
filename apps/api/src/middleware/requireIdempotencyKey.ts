import type { NextFunction, Request, Response } from 'express';
import { AppError } from '../shared/errors';

/**
 * Enforce explicit Idempotency-Key presence on high-risk mutation routes.
 * This is intentionally stricter than idempotencyMiddleware()'s pass-through
 * behavior and is used only where duplicate execution is unacceptable.
 */
export function requireIdempotencyKey(req: Request, _res: Response, next: NextFunction): void {
  const value = req.header('Idempotency-Key');
  if (!value || value.trim().length === 0) {
    next(
      new AppError(
        'Idempotency-Key header is required for this mutation route',
        400,
        'IDEMPOTENCY_KEY_REQUIRED',
      ),
    );
    return;
  }
  next();
}
