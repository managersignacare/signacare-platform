// apps/api/src/middleware/adminImpersonationAuditMiddleware.ts
//
// Tier 12.13 — downstream audit tagging for admin-impersonation sessions.
//
// When a request arrives carrying an impersonation JWT (`impersonator:
// <uuid>` + `impersonationSessionId: <uuid>` in the access-token
// payload), this middleware:
//
//   1. Validates the session row in admin_impersonation_sessions is
//      still open (ended_at NULL) and not past expires_at. If expired
//      or ended, rejects with 401 IMPERSONATION_EXPIRED.
//   2. Attaches the session id + admin id to req so downstream audit
//      rows record BOTH identities (via writeAuditLog's `newData`
//      including `impersonatedBy`).
//
// Order: mount AFTER authMiddleware, BEFORE clinical routes. No-op for
// normal (non-impersonation) sessions.
//
// Standards: HIPAA 164.312(b) — audit of reviewer actions; NSQHS Std 1.

import type { Request, Response, NextFunction } from 'express';
import { dbAdmin } from '../db/db';
import { HttpError } from '../shared/errors';
import { withTenantContext } from '../shared/tenantContext';
import { logger } from '../utils/logger';

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      impersonationSessionId?: string;
      impersonatorId?: string;
    }
  }
}

export async function adminImpersonationAuditMiddleware(
  req: Request,
  _res: Response,
  next: NextFunction,
): Promise<void> {
  // BUG-463 — typed-optional reads via the `AuthRequestUser` projection
  // declared in `types/express.d.ts`. The discriminated `AccessTokenPayload`
  // populates these only when the JWT carried `kind === 'staff_impersonation'`.
  const sessionId = req.user?.impersonationSessionId;
  const impersonatorId = req.user?.impersonator;

  if (!sessionId || !impersonatorId) {
    next();
    return;
  }

  try {
    await withTenantContext(req.clinicId, async () => {
      const session = await dbAdmin('admin_impersonation_sessions')
        .where({ id: sessionId })
        .first();
      if (!session) {
        throw new HttpError(401, 'IMPERSONATION_INVALID', 'Impersonation session not found');
      }
      if (session.ended_at) {
        throw new HttpError(401, 'IMPERSONATION_ENDED', 'Impersonation session already ended');
      }
      if (session.expires_at && new Date(session.expires_at) < new Date()) {
        throw new HttpError(401, 'IMPERSONATION_EXPIRED', 'Impersonation session has expired');
      }
    }, req.user?.id);

    req.impersonationSessionId = sessionId;
    req.impersonatorId = impersonatorId;

    logger.warn(
      {
        sessionId,
        impersonatorId,
        impersonatedStaffId: req.user!.id,
        clinicId: req.clinicId,
        method: req.method,
        path: req.originalUrl.split('?')[0],
      },
      'IMPERSONATION action',
    );

    next();
  } catch (err) {
    next(err);
  }
}
