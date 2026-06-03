// apps/api/src/features/endocrinology/endocrinologyRoutes.ts
//
// Multi-specialty Phase 4 — Endocrinology routes.
//
// Mounted at /api/v1/endocrinology. Two resources:
//   - glucose_readings    (time series + TIR summary)
//   - insulin_regimens    (versioned regimen history + current)
//
// All routes require auth + tenant. Reads use the broad `note:read`
// permission and writes use `medication:create` (the regimen IS a
// medication order; glucose readings are observations recorded by
// any clinical user with note:create authority). No new RBAC strings
// minted — Phase 0 ABAC discipline.
import { Router, type Request, type Response, type NextFunction } from 'express';
import {
  CreateGlucoseReadingSchema,
  GlucoseListFiltersSchema,
  CreateInsulinRegimenSchema,
} from '@signacare/shared';
import { authMiddleware } from '../../middleware/authMiddleware';
// BUG-292 — insulinService.createNewVersion migrated to AuthContext-first.
import { buildAuthContext } from '../../shared/buildAuthContext';
import { tenantMiddleware } from '../../middleware/tenantMiddleware';
import { requirePermission } from '../../middleware/rbacMiddleware';
import { glucoseService } from './glucoseService';
import { insulinService } from './insulinService';

const router = Router();

router.use(authMiddleware, tenantMiddleware);

// ── Glucose readings ──────────────────────────────────────────────────────

router.get(
  '/patients/:patientId/glucose',
  requirePermission('note:read'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const filters = GlucoseListFiltersSchema.parse(req.query);
      const items = await glucoseService.listForPatient(
        req.clinicId,
        req.params.patientId,
        filters,
      );
      res.json({ items });
    } catch (err) { next(err); }
  },
);

router.get(
  '/patients/:patientId/glucose/time-in-range',
  requirePermission('note:read'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const filters = GlucoseListFiltersSchema.parse(req.query);
      const summary = await glucoseService.timeInRange(
        req.clinicId,
        req.params.patientId,
        filters,
      );
      res.json(summary);
    } catch (err) { next(err); }
  },
);

router.post(
  '/patients/:patientId/glucose',
  requirePermission('note:create'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const dto = CreateGlucoseReadingSchema.parse({ ...req.body, patientId: req.params.patientId });
      const created = await glucoseService.create(req.clinicId, req.user!.id, dto);
      res.status(201).json(created);
    } catch (err) { next(err); }
  },
);

router.delete(
  '/glucose/:id',
  requirePermission('note:update'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      await glucoseService.softDelete(req.clinicId, req.user!.id, req.params.id);
      res.status(204).send();
    } catch (err) { next(err); }
  },
);

// ── Insulin regimens ──────────────────────────────────────────────────────

router.get(
  '/patients/:patientId/insulin-regimens',
  requirePermission('medication:read'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const items = await insulinService.listHistory(req.clinicId, req.params.patientId);
      res.json({ items });
    } catch (err) { next(err); }
  },
);

router.get(
  '/patients/:patientId/insulin-regimens/current',
  requirePermission('medication:read'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const current = await insulinService.findCurrent(req.clinicId, req.params.patientId);
      res.json({ current });
    } catch (err) { next(err); }
  },
);

router.post(
  '/patients/:patientId/insulin-regimens',
  requirePermission('medication:create'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const dto = CreateInsulinRegimenSchema.parse({ ...req.body, patientId: req.params.patientId });
      const auth = buildAuthContext(req, dto.patientId);
      const created = await insulinService.createNewVersion(auth, dto);
      res.status(201).json(created);
    } catch (err) { next(err); }
  },
);

export default router;
