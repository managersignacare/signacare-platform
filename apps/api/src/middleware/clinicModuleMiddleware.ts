import type { Request, Response, NextFunction } from 'express';
import { db } from '../db/db';

type ClinicModuleRow = { is_enabled: boolean };
type MissingRowPolicy = 'enabled' | 'disabled';

/**
 * Enforces clinic-wide module toggle semantics from clinic_modules.
 *
 * Behaviour:
 * - no row for (clinic_id,module_key) => allow by default (overrideable)
 * - row exists with is_enabled=false => deny with MODULE_DISABLED
 */
export function requireClinicModuleEnabled(
  moduleKey: string,
  opts?: { missingRowPolicy?: MissingRowPolicy },
) {
  const missingRowPolicy: MissingRowPolicy = opts?.missingRowPolicy ?? 'enabled';
  return async function clinicModuleGuard(req: Request, res: Response, next: NextFunction) {
    try {
      if (!req.user || !req.clinicId) {
        res.status(401).json({ error: 'Unauthenticated' });
        return;
      }

      const row = await db('clinic_modules')
        .where({
          clinic_id: req.clinicId,
          module_key: moduleKey,
        })
        .first<ClinicModuleRow>('is_enabled');

      if (!row && missingRowPolicy === 'disabled') {
        res.status(403).json({
          error: `Module '${moduleKey}' is disabled for this clinic`,
          code: 'MODULE_DISABLED',
        });
        return;
      }

      if (row && row.is_enabled === false) {
        res.status(403).json({
          error: `Module '${moduleKey}' is disabled for this clinic`,
          code: 'MODULE_DISABLED',
        });
        return;
      }

      next();
    } catch (err) {
      next(err);
    }
  };
}
