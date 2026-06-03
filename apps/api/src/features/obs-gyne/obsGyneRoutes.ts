// apps/api/src/features/obs-gyne/obsGyneRoutes.ts
//
// Multi-specialty Phase 6 — Obstetrics & Gynaecology routes.
//
// Mounted at /api/v1/obs-gyne. Two resources:
//   - pregnancies       (one per gestation, patient-scoped)
//   - antenatal_visits  (per-visit flowsheet, pregnancy-scoped)
//
// Reads use note:read, writes use note:create. No new RBAC strings
// minted — Phase 0 ABAC discipline.
import { Router, type Request, type Response, type NextFunction } from 'express';
import {
  CreatePregnancySchema,
  CreateAntenatalVisitSchema,
} from '@signacare/shared';
import { authMiddleware } from '../../middleware/authMiddleware';
import { tenantMiddleware } from '../../middleware/tenantMiddleware';
import { requirePermission } from '../../middleware/rbacMiddleware';
import {
  pregnancyService,
  antenatalVisitService,
} from './obsGyneServices';

const router = Router();

router.use(authMiddleware, tenantMiddleware);

// ── Pregnancies ───────────────────────────────────────────────────────────

router.get(
  '/patients/:patientId/pregnancies',
  requirePermission('note:read'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const items = await pregnancyService.listForPatient(req.clinicId, req.params.patientId);
      res.json({ items });
    } catch (err) { next(err); }
  },
);

router.post(
  '/patients/:patientId/pregnancies',
  requirePermission('note:create'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const dto = CreatePregnancySchema.parse({
        ...req.body,
        patientId: req.params.patientId,
      });
      const created = await pregnancyService.create(req.clinicId, req.user!.id, dto);
      res.status(201).json(created);
    } catch (err) { next(err); }
  },
);

// ── Antenatal visits ──────────────────────────────────────────────────────

router.get(
  '/pregnancies/:pregnancyId/visits',
  requirePermission('note:read'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const items = await antenatalVisitService.listForPregnancy(
        req.clinicId,
        req.params.pregnancyId,
      );
      res.json({ items });
    } catch (err) { next(err); }
  },
);

router.post(
  '/pregnancies/:pregnancyId/visits',
  requirePermission('note:create'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const dto = CreateAntenatalVisitSchema.parse({
        ...req.body,
        pregnancyId: req.params.pregnancyId,
      });
      const created = await antenatalVisitService.create(
        req.clinicId,
        req.user!.id,
        req.params.pregnancyId,
        dto,
      );
      res.status(201).json(created);
    } catch (err) { next(err); }
  },
);

export default router;
