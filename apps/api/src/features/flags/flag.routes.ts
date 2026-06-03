// apps/api/src/features/flags/flag.routes.ts
// READ-ONLY — no client write endpoints. Flags are raised/resolved
// by backend services only (riskService, allergyService).
import { Router } from 'express';
import type { Request, Response, NextFunction } from 'express';
import { authMiddleware } from '../../middleware/authMiddleware';
import { tenantMiddleware } from '../../middleware/tenantMiddleware';
import { flagService } from './flagService';

const router = Router();

router.get(
  '/api/v1/patients/:patientId/flags/high-severity',
  authMiddleware,
  tenantMiddleware,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const clinicId  = req.clinicId as string;
      const patientId = req.params['patientId'] as string;
      if (!clinicId) {
        res.status(401).json({ error: 'Unauthorized', code: 'UNAUTHORIZED' });
        return;
      }
      const flags = await flagService.listHighSeverityForPatient(clinicId, patientId);
      res.json(flags);
    } catch (err) {
      next(err);
    }
  },
);

router.get(
  '/api/v1/patients/:patientId/flags',
  authMiddleware,
  tenantMiddleware,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const clinicId  = req.clinicId as string;
      const patientId = req.params['patientId'] as string;
      if (!clinicId) {
        res.status(401).json({ error: 'Unauthorized', code: 'UNAUTHORIZED' });
        return;
      }
      const flags = await flagService.listForPatient(clinicId, patientId);
      res.json(flags);
    } catch (err) {
      next(err);
    }
  },
);

export default router;
