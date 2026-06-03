import type { Request, Response, NextFunction } from 'express';

export function tenantMiddleware(req: Request, res: Response, next: NextFunction): void {
  if (!req.clinicId) {
    res.status(401).json({ error: 'Tenant context missing', code: 'UNAUTHENTICATED' });
    return;
  }
  next();
}
