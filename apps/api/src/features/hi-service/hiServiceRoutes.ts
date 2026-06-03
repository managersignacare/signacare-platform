// apps/api/src/features/hi-service/hiServiceRoutes.ts
//
// BUG-336 + BUG-339 — HI Service verify routes. Mounted at
// /api/v1/hi-service. authMiddleware + RBAC applied per-route so the
// HPI-I verify is gated to staff admins (staff:update) and HPI-O verify
// to clinic admins (clinic:update). Neither endpoint writes state —
// they are thin wrappers over the hiServiceClient helpers.
import { Router } from 'express';
import { authMiddleware } from '../../middleware/authMiddleware';
import { requirePermission } from '../../middleware/rbacMiddleware';
import {
  verifyHpiiController,
  verifyHpioController,
} from './hiServiceController';

export const hiServiceRouter = Router();

hiServiceRouter.use(authMiddleware);

hiServiceRouter.post(
  '/verify-hpii',
  requirePermission('staff:update'),
  verifyHpiiController,
);

hiServiceRouter.post(
  '/verify-hpio',
  requirePermission('clinic:update'),
  verifyHpioController,
);
