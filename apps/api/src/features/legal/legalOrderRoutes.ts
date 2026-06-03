import { Router } from 'express';
import type { NextFunction, Request, Response } from 'express';
import {
  ActiveLegalOrderClinicListResponseSchema,
  CreateLegalOrderSchema,
  LegalOrderCreateResponseSchema,
  LegalOrderListResponseSchema,
  LegalOrderUpdateResponseSchema,
  UpdateLegalOrderSchema,
} from '@signacare/shared';
import { authMiddleware } from '../../middleware/authMiddleware';
import { tenantMiddleware } from '../../middleware/tenantMiddleware';
import { requireModuleRead } from '../../middleware/moduleAccessMiddleware';
import { requireRoles } from '../../middleware/rbacMiddleware';
import { MODULE_KEYS } from '../../shared/moduleKeys';
import { buildAuthContext } from '../../shared/buildAuthContext';
import { legalOrderCrudService } from './legalOrderCrudService';

export const legalOrderRoutes = Router();
// R-FIX-BUG-576-LEGAL-ROUTES-MODULE
// BUG-576 — dedicated legal-order route module with explicit
// auth/tenant/module guards. Mounted at server-level /api/v1/patients.
legalOrderRoutes.use(
  authMiddleware,
  tenantMiddleware,
  requireModuleRead(MODULE_KEYS.LEGAL_ORDERS),
);

const LEGAL_READ_ROLES = ['clinician', 'admin', 'manager', 'superadmin'] as const;
const LEGAL_WRITE_ROLES = ['clinician', 'superadmin'] as const;

legalOrderRoutes.get(
  '/legal-orders/active',
  requireRoles([...LEGAL_READ_ROLES]),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const auth = buildAuthContext(req);
      const response = await legalOrderCrudService.listActiveForClinic(auth);
      res.json(ActiveLegalOrderClinicListResponseSchema.parse(response));
    } catch (err) {
      next(err);
    }
  },
);

legalOrderRoutes.get(
  '/:id/legal-orders',
  requireRoles([...LEGAL_READ_ROLES]),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const patientId = req.params.id;
      const auth = buildAuthContext(req, patientId);
      const response = await legalOrderCrudService.listForPatient(auth, patientId);
      res.json(LegalOrderListResponseSchema.parse(response));
    } catch (err) {
      next(err);
    }
  },
);

legalOrderRoutes.post(
  '/:id/legal-orders',
  requireRoles([...LEGAL_WRITE_ROLES]),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const patientId = req.params.id;
      const dto = CreateLegalOrderSchema.parse(req.body);
      const auth = buildAuthContext(req, patientId);
      const response = await legalOrderCrudService.create(auth, patientId, dto);
      res.status(201).json(LegalOrderCreateResponseSchema.parse(response));
    } catch (err) {
      next(err);
    }
  },
);

legalOrderRoutes.patch(
  '/legal-orders/:orderId',
  requireRoles([...LEGAL_WRITE_ROLES]),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const dto = UpdateLegalOrderSchema.parse(req.body);
      const auth = buildAuthContext(req);
      const response = await legalOrderCrudService.update(
        auth,
        req.params.orderId,
        dto,
      );
      res.json(LegalOrderUpdateResponseSchema.parse(response));
    } catch (err) {
      next(err);
    }
  },
);
