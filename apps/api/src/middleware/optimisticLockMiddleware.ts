// apps/api/src/middleware/optimisticLockMiddleware.ts
//
// Prevents lost-update (last-write-wins) on concurrent edits.
// When a PATCH/PUT response includes an ETag (based on updated_at),
// subsequent PATCH/PUT requests must include If-Match with that ETag.
// Returns 409 Conflict if the record has been modified since.
//
// Usage: Apply to individual routes, not globally.
//
//   router.patch('/:id', optimisticLock('clinical_notes'), handler);

import type { Request, Response, NextFunction } from 'express';
import { db } from '../db/db';

function extractUpdatedAt(value: unknown): string | Date | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const row = value as { updatedAt?: string | Date; updated_at?: string | Date };
  return row.updatedAt ?? row.updated_at;
}

/**
 * Create middleware that checks If-Match header against updated_at.
 * @param tableName - DB table to check
 * @param idParam - Route param name for the record ID (default: 'id')
 */
export function optimisticLock(tableName: string, idParam = 'id') {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    // Only enforce on PATCH/PUT (mutations)
    if (req.method !== 'PATCH' && req.method !== 'PUT') {
      next();
      return;
    }

    const ifMatch = req.headers['if-match'];
    if (!ifMatch) {
      // No If-Match header — allow (backwards compatible)
      next();
      return;
    }

    const id = req.params[idParam];
    if (!id) {
      next();
      return;
    }

    try {
      const row = await db(tableName).where({ id }).first('updated_at');
      if (!row) {
        res.status(404).json({ error: 'Record not found', code: 'NOT_FOUND' });
        return;
      }

      const currentEtag = `"${new Date(row.updated_at).getTime()}"`;
      if (ifMatch !== currentEtag) {
        res.status(409).json({
          error: 'This record has been modified by another user. Please refresh and try again.',
          code: 'CONFLICT',
          currentEtag,
        });
        return;
      }

      // Set ETag on response for next update
      const origJson = res.json.bind(res);
      res.json = function (body: unknown) {
        const ts = extractUpdatedAt(body);
        if (ts) {
          res.setHeader('ETag', `"${new Date(ts).getTime()}"`);
        }
        return origJson(body);
      };

      next();
    } catch (err) {
      next(err);
    }
  };
}
