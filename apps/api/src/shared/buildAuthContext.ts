// apps/api/src/shared/buildAuthContext.ts
//
// Builds an AuthContext from the authenticated Express request.
// Controllers call this ONCE at the top of each handler, then pass
// the context to every service method. Centralises the scattered
// req.clinicId / req.user!.id extraction into one type-safe call.

import type { Request } from 'express';
import type { AuthContext } from '@signacare/shared';
import { AppError } from './errors';

export function buildAuthContext(req: Request, patientId?: string): AuthContext {
  const user = req.user;
  const clinicId = req.clinicId;

  if (!user || !clinicId) {
    throw new AppError('Authentication required', 401, 'AUTH_REQUIRED');
  }

  return {
    staffId: user.id,
    clinicId,
    role: user.role,
    permissions: user.permissions ?? [],
    patientId,
    requestId: req.requestId,
    breakGlassSessionId: req.breakGlassSessionId,
  };
}
