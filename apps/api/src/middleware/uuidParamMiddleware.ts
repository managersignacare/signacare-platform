// apps/api/src/middleware/uuidParamMiddleware.ts
//
// Validates that route parameters matching common ID patterns are valid UUIDs.
// Returns 400 instead of letting PostgreSQL crash with 500.

import type { Request, Response, NextFunction } from 'express';
import type { Express } from 'express';

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Register Express param handlers that validate UUID format.
 * Returns 400 instead of letting PostgreSQL crash with 500.
 * Call once after app creation: registerUuidValidation(app)
 */
export function registerUuidValidation(app: Express): void {
  const paramNames = ['id', 'patientId', 'episodeId', 'staffId', 'taskId',
    'noteId', 'alertId', 'orderId', 'threadId', 'messageId', 'bedId',
    'attendeeId', 'scheduleId', 'registrationId', 'hotspotId', 'contactId'];

  for (const name of paramNames) {
    app.param(name, (_req: Request, res: Response, next: NextFunction, value: string) => {
      if (!UUID_REGEX.test(value)) {
        res.status(400).json({ error: `Invalid ${name}: must be a valid UUID`, code: 'VALIDATION_ERROR' });
        return;
      }
      next();
    });
  }
}

// Keep backwards-compatible middleware export (no-op since params aren't populated at global level)
export function uuidParamMiddleware(_req: Request, _res: Response, next: NextFunction): void {
  next();
}
