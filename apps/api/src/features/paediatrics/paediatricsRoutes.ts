// apps/api/src/features/paediatrics/paediatricsRoutes.ts
//
// Multi-specialty Phase 5 — Paediatrics routes.
//
// Mounted at /api/v1/paediatrics. Three resources:
//   - growth_measurements        (per-encounter weight/height/HC/BMI)
//   - immunizations              (CVX-coded vaccines)
//   - developmental_milestones   (WHO five domains)
//
// Reads use note:read, writes use note:create. No new RBAC strings
// minted — Phase 0 ABAC discipline.
import { Router, type Request, type Response, type NextFunction } from 'express';
import {
  CreateGrowthMeasurementSchema,
  CreateImmunizationSchema,
  CreateMilestoneSchema,
} from '@signacare/shared';
import { authMiddleware } from '../../middleware/authMiddleware';
import { tenantMiddleware } from '../../middleware/tenantMiddleware';
import { requirePermission } from '../../middleware/rbacMiddleware';
import {
  growthMeasurementService,
  immunizationService,
  milestoneService,
} from './paediatricsServices';

const router = Router();

router.use(authMiddleware, tenantMiddleware);

// ── Growth measurements ──────────────────────────────────────────────────

router.get(
  '/patients/:patientId/growth',
  requirePermission('note:read'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const items = await growthMeasurementService.listForPatient(
        req.clinicId,
        req.params.patientId,
      );
      res.json({ items });
    } catch (err) { next(err); }
  },
);

router.post(
  '/patients/:patientId/growth',
  requirePermission('note:create'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const dto = CreateGrowthMeasurementSchema.parse({
        ...req.body,
        patientId: req.params.patientId,
      });
      const created = await growthMeasurementService.create(
        req.clinicId,
        req.user!.id,
        dto,
      );
      res.status(201).json(created);
    } catch (err) { next(err); }
  },
);

// ── Immunizations ────────────────────────────────────────────────────────

router.get(
  '/patients/:patientId/immunizations',
  requirePermission('note:read'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const items = await immunizationService.listForPatient(
        req.clinicId,
        req.params.patientId,
      );
      res.json({ items });
    } catch (err) { next(err); }
  },
);

router.post(
  '/patients/:patientId/immunizations',
  requirePermission('note:create'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const dto = CreateImmunizationSchema.parse({
        ...req.body,
        patientId: req.params.patientId,
      });
      const created = await immunizationService.create(
        req.clinicId,
        req.user!.id,
        dto,
      );
      res.status(201).json(created);
    } catch (err) { next(err); }
  },
);

// ── Developmental milestones ─────────────────────────────────────────────

router.get(
  '/patients/:patientId/milestones',
  requirePermission('note:read'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const items = await milestoneService.listForPatient(
        req.clinicId,
        req.params.patientId,
      );
      res.json({ items });
    } catch (err) { next(err); }
  },
);

router.post(
  '/patients/:patientId/milestones',
  requirePermission('note:create'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const dto = CreateMilestoneSchema.parse({
        ...req.body,
        patientId: req.params.patientId,
      });
      const created = await milestoneService.create(
        req.clinicId,
        req.user!.id,
        dto,
      );
      res.status(201).json(created);
    } catch (err) { next(err); }
  },
);

export default router;
