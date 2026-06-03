// apps/api/src/features/surgery/surgeryRoutes.ts
//
// Multi-specialty Phase 7 — Surgery routes.
//
// Mounted at /api/v1/surgery. Four resources:
//   - surgical_cases      (case list + create, patient-scoped)
//   - safety_checklists   (WHO three-phase, case-scoped)
//   - op_notes            (one per case, refuses until all three
//                          checklist phases exist)
//   - pacu_records        (recovery flowsheet, case-scoped)
//
// Reads use note:read, writes use note:create. No new RBAC strings
// minted — Phase 0 ABAC discipline.
import { Router, type Request, type Response, type NextFunction } from 'express';
import {
  CreateSurgicalCaseSchema,
  CreateSafetyChecklistSchema,
  CreateOpNoteSchema,
  CreatePacuRecordSchema,
} from '@signacare/shared';
import { authMiddleware } from '../../middleware/authMiddleware';
import { tenantMiddleware } from '../../middleware/tenantMiddleware';
import { requirePermission } from '../../middleware/rbacMiddleware';
import {
  surgicalCaseService,
  safetyChecklistService,
  opNoteService,
  pacuRecordService,
} from './surgeryServices';

const router = Router();

router.use(authMiddleware, tenantMiddleware);

// ── Surgical cases ────────────────────────────────────────────────────────

router.get(
  '/patients/:patientId/cases',
  requirePermission('note:read'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const items = await surgicalCaseService.listForPatient(req.clinicId, req.params.patientId);
      res.json({ items });
    } catch (err) { next(err); }
  },
);

router.post(
  '/patients/:patientId/cases',
  requirePermission('note:create'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const dto = CreateSurgicalCaseSchema.parse({
        ...req.body,
        patientId: req.params.patientId,
      });
      const created = await surgicalCaseService.create(req.clinicId, req.user!.id, dto);
      res.status(201).json(created);
    } catch (err) { next(err); }
  },
);

// ── Safety checklists ─────────────────────────────────────────────────────

router.get(
  '/cases/:caseId/checklists',
  requirePermission('note:read'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const items = await safetyChecklistService.listForCase(req.clinicId, req.params.caseId);
      res.json({ items });
    } catch (err) { next(err); }
  },
);

router.post(
  '/cases/:caseId/checklists',
  requirePermission('note:create'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const dto = CreateSafetyChecklistSchema.parse({
        ...req.body,
        caseId: req.params.caseId,
      });
      const created = await safetyChecklistService.create(req.clinicId, req.user!.id, dto);
      res.status(201).json(created);
    } catch (err) { next(err); }
  },
);

// ── Op notes ──────────────────────────────────────────────────────────────

router.get(
  '/cases/:caseId/op-note',
  requirePermission('note:read'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const note = await opNoteService.findForCase(req.clinicId, req.params.caseId);
      res.json({ note });
    } catch (err) { next(err); }
  },
);

router.post(
  '/cases/:caseId/op-note',
  requirePermission('note:create'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const dto = CreateOpNoteSchema.parse({
        ...req.body,
        caseId: req.params.caseId,
      });
      const created = await opNoteService.create(req.clinicId, req.user!.id, dto);
      res.status(201).json(created);
    } catch (err) { next(err); }
  },
);

// ── PACU records ──────────────────────────────────────────────────────────

router.get(
  '/cases/:caseId/pacu',
  requirePermission('note:read'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const items = await pacuRecordService.listForCase(req.clinicId, req.params.caseId);
      res.json({ items });
    } catch (err) { next(err); }
  },
);

router.post(
  '/cases/:caseId/pacu',
  requirePermission('note:create'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const dto = CreatePacuRecordSchema.parse({
        ...req.body,
        caseId: req.params.caseId,
      });
      const created = await pacuRecordService.create(req.clinicId, req.user!.id, dto);
      res.status(201).json(created);
    } catch (err) { next(err); }
  },
);

export default router;
