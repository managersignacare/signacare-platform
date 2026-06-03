// apps/api/src/middleware/rbacMiddleware.ts
import type { Request, Response, NextFunction } from 'express';

export function requireRole(...roles: string[]) {
  return requireRoles(roles);
}

export function requireRoles(roles: string[]) {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!req.user) {
      res
        .status(401)
        .json({ error: 'Unauthenticated', code: 'UNAUTHENTICATED' });
      return;
    }
    if (req.user.role === 'superadmin' || roles.includes(req.user.role)) {
      next();
      return;
    }
    res.status(403).json({ error: 'Forbidden', code: 'FORBIDDEN' });
  };
}

export function requirePermission(permission: string) {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!req.user) {
      res.status(401).json({ error: 'Unauthenticated', code: 'UNAUTHENTICATED' });
      return;
    }
    // Superadmin bypasses all permission checks
    if (req.user.role === 'superadmin') {
      next();
      return;
    }
    // permissions is optional on the AuthUser shape — patient-app
    // JWTs don't carry a permissions list. Treat missing as empty
    // (forbidden) so the fail-closed semantics stay intact.
    if (!(req.user.permissions ?? []).includes(permission as never)) {
      res.status(403).json({ error: 'Forbidden', code: 'FORBIDDEN' });
      return;
    }
    next();
  };
}

export function requirePermissions(permission: string) {
  return requirePermission(permission);
}
