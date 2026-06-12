/**
 * Module-level access middleware.
 *
 * Layers an ABAC override on top of the existing role-based RBAC.
 * The decision tree every request walks:
 *
 *   1. Bypass for admin + superadmin — the role itself implies
 *      full access, matching how existing permission checks treat
 *      these roles throughout the codebase.
 *   2. Explicit `staff_module_access` row wins. Values:
 *        - 'write' or 'full'  → read + write allowed
 *        - 'read'             → read allowed, write denied
 *        - 'none'             → both denied (explicit deny beats
 *                               RBAC, lets an admin revoke access
 *                               from a clinician whose role would
 *                               otherwise allow it)
 *   3. No row → fall back to the MODULE_TO_PERMISSION map in
 *      shared/moduleToPermission.ts. The caller passes if
 *      `req.user.permissions` contains ANY of the permissions
 *      listed for the requested level. This is the additive-safe
 *      path: adding `requireModuleRead('patients')` to an
 *      existing route doesn't lock receptionists out because
 *      their `patient:read` RBAC permission still carries them.
 *   4. No mapping → fall-through allow. Preserves behaviour for
 *      any unmapped legacy module so the retrofit is never a
 *      hidden regression.
 *
 * The middleware is strictly ADDITIVE to existing guards. A route
 * can stack `requireRoles([...]) + requirePermission(...) +
 * requireModuleWrite(...)` and the three AND-compose.
 *
 * Tenant safety: the query filters on `staff_id` AND `clinic_id`
 * from the authenticated request context so a module-access grant
 * from clinic A cannot be reused in clinic B.
 */
import type { Request, Response, NextFunction } from 'express';
import { db } from '../db/db';
import { requiredPermissionsFor } from '../shared/moduleToPermission';
import { AppError } from '../shared/errors';

const BYPASS_ROLES = new Set(['superadmin', 'admin']);

/**
 * The staff_module_access.access_level column carries a small set
 * of values today — 'none', 'read', 'write' and the legacy 'full'.
 * 'full' is the pre-read/write-split admin label we treat as
 * equivalent to 'write'. 'none' is an explicit denial that beats
 * the RBAC fallback — that's the feature the admin matrix ships:
 * revoke a capability per-staff without touching the role.
 */
const WRITE_LEVELS = new Set(['write', 'full']);
const READ_LEVELS = new Set(['read', 'write', 'full']);
const DENY_LEVELS = new Set(['none']);

type GrantDecision =
  | { kind: 'allow' }
  | { kind: 'deny' }
  | { kind: 'unknown' };

async function evaluateExplicitGrant(
  staffId: string,
  clinicId: string,
  module: string,
  needed: 'read' | 'write',
): Promise<GrantDecision> {
  const row = (await db('staff_module_access')
    .where({ staff_id: staffId, clinic_id: clinicId, module })
    .select('access_level')
    .first()) as { access_level: string } | undefined;
  if (!row) return { kind: 'unknown' };
  const level = (row.access_level ?? '').toLowerCase();
  if (DENY_LEVELS.has(level)) return { kind: 'deny' };
  if (needed === 'read') {
    return READ_LEVELS.has(level) ? { kind: 'allow' } : { kind: 'deny' };
  }
  return WRITE_LEVELS.has(level) ? { kind: 'allow' } : { kind: 'deny' };
}

function passesRbacFallback(
  req: Request,
  module: string,
  needed: 'read' | 'write',
): boolean {
  const required = requiredPermissionsFor(module, needed);
  // Unmapped module — fall-through allow. Preserves pre-retrofit
  // behaviour so adding the middleware to a route can never be a
  // hidden regression for a module with no mapping entry.
  if (required === null) return true;
  // Mapping exists but is empty (e.g. audit log) — admin-tier
  // only; fall-back denies non-admins. Admin / superadmin never
  // reach this branch because of the bypass short-circuit above.
  if (required.length === 0) return false;
  const perms = new Set<string>((req.user?.permissions ?? []) as string[]);
  return required.some((p) => perms.has(p));
}

async function isAllowed(
  req: Request,
  module: string,
  needed: 'read' | 'write',
): Promise<boolean> {
  const user = req.user as { id: string; role?: string } | undefined;
  const clinicId = req.clinicId;
  if (!user || !clinicId) return false;
  if (user.role && BYPASS_ROLES.has(user.role)) return true;

  const explicit = await evaluateExplicitGrant(user.id, clinicId, module, needed);
  if (explicit.kind === 'allow') return true;
  if (explicit.kind === 'deny') return false;
  // 'unknown' → fall back to the RBAC permission mapping.
  return passesRbacFallback(req, module, needed);
}

export function requireModuleRead(module: string) {
  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      if (!req.user || !req.clinicId) {
        res.status(401).json({ error: 'Unauthenticated' });
        return;
      }
      const ok = await isAllowed(req, module, 'read');
      if (!ok) {
        res.status(403).json({
          error: `Read access denied for module '${module}'`,
          code: 'MODULE_READ_DENIED',
        });
        return;
      }
      next();
    } catch (err) {
      next(err);
    }
  };
}

export async function assertModuleRead(req: Request, module: string): Promise<void> {
  if (!req.user || !req.clinicId) {
    throw new AppError('Unauthenticated', 401, 'UNAUTHENTICATED');
  }
  const ok = await isAllowed(req, module, 'read');
  if (!ok) {
    throw new AppError(`Read access denied for module '${module}'`, 403, 'MODULE_READ_DENIED');
  }
}

export function requireModuleWrite(module: string) {
  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      if (!req.user || !req.clinicId) {
        res.status(401).json({ error: 'Unauthenticated' });
        return;
      }
      const ok = await isAllowed(req, module, 'write');
      if (!ok) {
        res.status(403).json({
          error: `Write access denied for module '${module}' — read-only or no grant`,
          code: 'MODULE_WRITE_DENIED',
        });
        return;
      }
      next();
    } catch (err) {
      next(err);
    }
  };
}
