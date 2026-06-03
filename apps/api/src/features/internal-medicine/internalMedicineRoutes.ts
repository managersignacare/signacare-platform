// apps/api/src/features/internal-medicine/internalMedicineRoutes.ts
//
// Multi-specialty Phase 3 — Internal Medicine routes.
//
// Mounted under /api/v1/internal-medicine (see server.ts). Two
// resources: problem_list and medication_reconciliations. Both are
// patient-level so the URLs nest under /patients/:patientId.
//
// All routes require auth + tenant + the relevant permission.
// Problem list reads use `note:read` (already broadly granted to
// clinical roles) — there is no dedicated `problem:*` permission and
// minting one would expand the RBAC surface unnecessarily for a
// patient-level read. Writes require `note:create`/`note:update` for
// the same reason.
import { Router, type Request, type Response, type NextFunction } from 'express';
import {
  CreateProblemSchema,
  UpdateProblemSchema,
  ProblemListFiltersSchema,
  CreateMedRecSchema,
} from '@signacare/shared';
import { authMiddleware } from '../../middleware/authMiddleware';
import { tenantMiddleware } from '../../middleware/tenantMiddleware';
import { requirePermission } from '../../middleware/rbacMiddleware';
import { problemListService } from './problemListService';
import { medRecService } from './medRecService';

const router = Router();

router.use(authMiddleware, tenantMiddleware);

// ── Problem list ──────────────────────────────────────────────────────────

router.get(
  '/patients/:patientId/problems',
  requirePermission('note:read'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const filters = ProblemListFiltersSchema.parse(req.query);
      const items = await problemListService.listForPatient(
        req.clinicId,
        req.params.patientId,
        filters,
      );
      res.json({ items });
    } catch (err) { next(err); }
  },
);

router.post(
  '/patients/:patientId/problems',
  requirePermission('note:create'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const dto = CreateProblemSchema.parse({ ...req.body, patientId: req.params.patientId });
      const created = await problemListService.create(req.clinicId, req.user!.id, dto);
      res.status(201).json(created);
    } catch (err) { next(err); }
  },
);

router.patch(
  '/problems/:id',
  requirePermission('note:update'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const dto = UpdateProblemSchema.parse(req.body);
      const updated = await problemListService.update(
        req.clinicId,
        req.user!.id,
        req.params.id,
        dto,
      );
      res.json(updated);
    } catch (err) { next(err); }
  },
);

router.delete(
  '/problems/:id',
  requirePermission('note:update'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      await problemListService.softDelete(req.clinicId, req.user!.id, req.params.id);
      res.status(204).send();
    } catch (err) { next(err); }
  },
);

// ── Medication reconciliation ────────────────────────────────────────────

router.get(
  '/patients/:patientId/med-reconciliations',
  requirePermission('medication:read'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const items = await medRecService.listForPatient(req.clinicId, req.params.patientId);
      res.json({ items });
    } catch (err) { next(err); }
  },
);

router.post(
  '/patients/:patientId/med-reconciliations',
  requirePermission('medication:create'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const dto = CreateMedRecSchema.parse({ ...req.body, patientId: req.params.patientId });
      const created = await medRecService.create(req.clinicId, req.user!.id, dto);
      res.status(201).json(created);
    } catch (err) { next(err); }
  },
);

export default router;
