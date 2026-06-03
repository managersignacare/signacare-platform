// apps/api/src/middleware/featureFlagMiddleware.ts
//
// Audit Tier 5.1 — AI kill switch.
//
// `requireFeatureEnabled(flagName)` gates every AI route. When a
// clinic admin completes the 2-person approval flow to disable an
// `ai-*` flag, every downstream request returns 403 FEATURE_DISABLED
// within the cache TTL (60s) of featureFlags.ts. Admin/superadmin
// callers are NOT bypassed — disabling the scribe feature disables
// it for everyone, including admins, so an accidental "admin-only"
// bypass can't turn a kill switch into a suggestion.

import type { Request, Response, NextFunction } from 'express';
import { isFeatureEnabled, isValidFlagName } from '../shared/featureFlags';
import { AppError } from '../shared/errors';

export function requireFeatureEnabled(flagName: string) {
  if (!isValidFlagName(flagName)) {
    throw new AppError(`Invalid flag name '${flagName}'`, 500, 'INVALID_FLAG_NAME');
  }
  return async function featureFlagGuard(req: Request, res: Response, next: NextFunction) {
    try {
      const enabled = await isFeatureEnabled(flagName, req.clinicId ?? null, {
        staffId: req.user?.id,
      });
      if (!enabled) {
        res.status(403).json({
          error: `Feature '${flagName}' is currently disabled for this clinic`,
          code: 'FEATURE_DISABLED',
          flag: flagName,
        });
        return;
      }
      next();
    } catch (err) {
      next(err);
    }
  };
}
