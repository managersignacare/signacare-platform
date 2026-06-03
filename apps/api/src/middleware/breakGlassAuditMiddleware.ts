// apps/api/src/middleware/breakGlassAuditMiddleware.ts
//
// GAP-04 (S6.1, 2026-04-11) — downstream audit tagging for break-glass sessions.
//
// When a request arrives carrying a break-glass JWT (`breakGlass: true,
// breakGlassSessionId: <uuid>` in the access-token payload), this middleware:
//
//   1. Validates the session is still 'approved' and not past expires_at.
//      If expired or revoked, rejects the request with 401 BREAK_GLASS_EXPIRED
//      so the attacker / stale client cannot ride an old token past its TTL.
//
//   2. Attaches the session id to `req.breakGlassSessionId` so downstream
//      handlers and the audit trigger can tag rows back to the originating
//      session.
//
//   3. Appends the request descriptor (method, path, timestamp) to
//      break_glass_sessions.actions_performed so we have an immutable record
//      of exactly what was done under emergency elevation.
//
// Order: mount AFTER authMiddleware (so req.user is populated) but BEFORE any
// clinical route. The middleware is a no-op for normal (non-break-glass)
// sessions, so it's cheap enough to mount globally.
//
// Standards: HIPAA 164.312(b), NSQHS Std 1, ISO 27001 A.8.15.

import type { Request, Response, NextFunction } from 'express';
import { dbAdmin } from '../db/db';
import { HttpError } from '../shared/errors';
import { withTenantContext } from '../shared/tenantContext';
import { logger } from '../utils/logger';

function isMentalHealthSensitiveRoute(pathname: string): boolean {
  return pathname.startsWith('/api/v1/patients')
    || pathname.startsWith('/api/v1/clinical-notes')
    || pathname.startsWith('/api/v1/prescriptions')
    || pathname.startsWith('/api/v1/medications')
    || pathname.startsWith('/api/v1/risk');
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      breakGlassSessionId?: string;
    }
  }
}

export async function breakGlassAuditMiddleware(
  req: Request,
  _res: Response,
  next: NextFunction,
): Promise<void> {
  // BUG-463 — typed-optional reads via the `AuthRequestUser` projection
  // declared in `types/express.d.ts`. The discriminated `AccessTokenPayload`
  // populates these only when the JWT carried `kind === 'staff_break_glass'`.
  const sessionId = req.user?.breakGlassSessionId;
  const isBreakGlass = req.user?.breakGlass === true;

  if (!isBreakGlass || !sessionId) {
    next();
    return;
  }

  try {
    let inactiveRequester = false;
    await withTenantContext(req.clinicId, async () => {
      const session = await dbAdmin('break_glass_sessions').where({ id: sessionId }).first();
      if (!session) {
        throw new HttpError(401, 'BREAK_GLASS_INVALID', 'Break-glass session not found');
      }
      if (session.status !== 'approved') {
        throw new HttpError(401, 'BREAK_GLASS_REVOKED', `Break-glass session is ${session.status}`);
      }
      if (session.expires_at && new Date(session.expires_at) < new Date()) {
        // Lazy expiry — flip status so the admin list shows it accurately.
        await dbAdmin('break_glass_sessions').where({ id: sessionId }).update({ status: 'expired' });
        throw new HttpError(401, 'BREAK_GLASS_EXPIRED', 'Break-glass session has expired');
      }

      const currentStaff = await dbAdmin('staff')
        .where({ id: req.user!.id, clinic_id: req.clinicId, deleted_at: null, is_active: true })
        .first('id');
      if (!currentStaff) {
        inactiveRequester = true;
      }
    }, req.user?.id);

    if (inactiveRequester) {
      await withTenantContext(req.clinicId, async () => {
        await dbAdmin('break_glass_sessions')
          .where({ id: sessionId, status: 'approved' })
          .update({
            status: 'revoked',
            revoked_at: new Date(),
            revoked_by: null,
          });
      }, req.user?.id);
      throw new HttpError(
        401,
        'BREAK_GLASS_INACTIVE_ACCOUNT',
        'Break-glass session revoked because staff account is inactive',
      );
    }

    req.breakGlassSessionId = sessionId;

    // Append to actions_performed — the column is JSONB with [] default.
    // Use jsonb concat so we never clobber prior entries.
    const routePath = req.originalUrl.split('?')[0];
    const sensitiveAccess = isMentalHealthSensitiveRoute(routePath);
    const actionDescriptor = {
      method: req.method,
      path: routePath,
      at: new Date().toISOString(),
      sensitiveAccess,
      sensitiveFlag: sensitiveAccess ? 'mental_health_sensitive_record' : null,
    };
    await withTenantContext(req.clinicId, async () => {
      await dbAdmin('break_glass_sessions')
        .where({ id: sessionId })
        .update({
          actions_performed: dbAdmin.raw(`
            COALESCE(actions_performed, '[]'::jsonb) || ?::jsonb
          `, [JSON.stringify([actionDescriptor])]),
        });
    }, req.user?.id);

    logger.warn(
      {
        sessionId,
        staffId: req.user!.id,
        clinicId: req.clinicId,
        method: req.method,
        path: actionDescriptor.path,
      },
      'BREAK-GLASS action',
    );

    next();
  } catch (err) {
    next(err);
  }
}
