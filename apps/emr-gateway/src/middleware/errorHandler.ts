import type { Request, Response, NextFunction } from 'express';
import { env } from '../config/env';

interface HttpErrorLike {
  status?: number;
  message?: string;
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  const maybe = error as HttpErrorLike;
  return maybe.message ?? String(error);
}

function getErrorStatus(error: unknown): number {
  const maybe = error as HttpErrorLike;
  return maybe.status ?? 500;
}

export function errorHandler(error: unknown, _req: Request, res: Response, _next: NextFunction): void {
  const message = getErrorMessage(error);
  console.error('[EMR Gateway Error]', message);
  const status = getErrorStatus(error);
  res.status(status).json({
    success: false,
    error: {
      code: status === 404 ? 'NOT_FOUND' : 'INTERNAL_ERROR',
      message: env.nodeEnv === 'production' ? 'An error occurred' : message,
    },
  });
}
