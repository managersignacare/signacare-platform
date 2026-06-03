import type { Request, Response, NextFunction } from 'express';
import { logger } from '../../utils/logger';
import { AppError } from '../../shared/errors';

export function fhirErrorMiddleware(
  err: Error | AppError,
  req: Request,
  res: Response,
  _next: NextFunction,
): void {
  // Error objects from different layers use either `status` (AppError)
  // or `statusCode` (some multer/express variants). Check both.
  const errWithStatus = err as Partial<AppError> & { statusCode?: number };
  const status = errWithStatus.status ?? errWithStatus.statusCode ?? 500;
  const severity = status >= 500 ? 'fatal' : 'error';
  const code =
    status === 404 ? 'not-found'
    : status === 400 ? 'invalid'
    : status === 401 ? 'login'
    : status === 403 ? 'forbidden'
    : status === 409 ? 'conflict'
    : status === 422 ? 'processing'
    : 'exception';

  logger.error({ err, path: req.path, method: req.method, status }, 'FHIR endpoint error');

  res.status(status).json({
    resourceType: 'OperationOutcome',
    issue: [{
      severity,
      code,
      diagnostics: process.env.NODE_ENV !== 'production' ? err.message : undefined,
    }],
  });
}
