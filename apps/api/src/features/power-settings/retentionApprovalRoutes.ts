// apps/api/src/features/power-settings/retentionApprovalRoutes.ts
//
// BUG-374b Part 2 — manager-approval HTTP endpoints (Q-F triple-lock 3rd gate).
//
// `POST /api/v1/power-settings/retention/manager-approval` — approve
// `DELETE /api/v1/power-settings/retention/manager-approval` — revoke
//
// Both require admin or superadmin role per service-layer guard. The
// segregation-of-duties check (approver != enabler) is service-side.

import { Router, type Request, type Response, type NextFunction } from 'express';
import { z } from 'zod';
import { isErr } from '@signacare/shared';
import { requireRole } from '../../middleware/rbacMiddleware';
import { buildAuthContext } from '../../shared/buildAuthContext';
import { retentionApprovalService } from './retentionApprovalService';

export const retentionApprovalRoutes = Router();

const ApprovalActionSchema = z.object({
  reason: z.string().min(1).max(500),
});

retentionApprovalRoutes.post(
  '/',
  requireRole('admin', 'superadmin'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const parsed = ApprovalActionSchema.parse(req.body);
      const auth = buildAuthContext(req);
      const r = await retentionApprovalService.approve(auth, parsed.reason);
      if (isErr(r)) return next(r.error);
      res.json({ ok: true });
    } catch (err) {
      next(err);
    }
  },
);

// POST /revoke — semantically a deletion of the approval flag, but
// implemented as POST because apiClient.delete does not carry a body
// (the audit reason is required and lives in the body).
retentionApprovalRoutes.post(
  '/revoke',
  requireRole('admin', 'superadmin'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const parsed = ApprovalActionSchema.parse(req.body);
      const auth = buildAuthContext(req);
      const r = await retentionApprovalService.revoke(auth, parsed.reason);
      if (isErr(r)) return next(r.error);
      res.json({ ok: true });
    } catch (err) {
      next(err);
    }
  },
);
