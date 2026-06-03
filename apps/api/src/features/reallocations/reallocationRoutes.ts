/**
 * @admin-only — operator/manager surface, no UI caller yet
 *
 * Re-allocation approval routes.
 *
 *   POST /reallocations                      — request (clinician)
 *   GET  /reallocations/pending              — approval queue (team leader / manager)
 *   POST /reallocations/:id/approve          — approve + fire Viva outreach
 *   POST /reallocations/:id/reject           — reject with reason
 *
 * Rationale (DEAD-MOUNT exemption per Phase 0.7 PR2): the backend service is
 * fully implemented and the PATIENT_ALLOCATIONS module key is registered, but
 * the dedicated approval-queue UI has not shipped. Today the routes are
 * exercised by managers via curl/Postman during patient transfer workflows
 * (the matrix label exists at apps/web/src/features/staff-settings/components/
 * ModuleAccessMatrix.tsx:75). When the UI lands the sentinel can be removed.
 * See docs/admin-routes.md for the curl examples.
 *
 * Every route is gated behind auth + tenant middleware (same as
 * the rest of the patient surface) AND the module-access
 * middleware so read-only staff cannot create or approve.
 * Fine-grained approver authority (team leader / manager) is
 * enforced inside reallocationService.approve — it depends on the
 * target org unit which the middleware doesn't have at route time.
 */
import { Router, type Request, type Response, type NextFunction } from 'express';
import { z } from 'zod';
import { authMiddleware } from '../../middleware/authMiddleware';
import { tenantMiddleware } from '../../middleware/tenantMiddleware';
import { requireModuleRead, requireModuleWrite } from '../../middleware/moduleAccessMiddleware';
import { idempotencyMiddleware } from '../../middleware/idempotencyMiddleware';
import { requireIdempotencyKey } from '../../middleware/requireIdempotencyKey';
import { MODULE_KEYS } from '../../shared/moduleKeys';
import { reallocationService } from './reallocationService';

const router = Router();
router.use(authMiddleware, tenantMiddleware);

const RequestSchema = z.object({
  patientId: z.string().uuid(),
  targetOrgUnitId: z.string().uuid(),
  targetPrimaryClinicianId: z.string().uuid().nullable().optional(),
  reason: z.string().max(2000).optional(),
});

const RejectSchema = z.object({
  rejectionReason: z.string().min(5).max(2000),
});

// ── Request a re-allocation ───────────────────────────────────────────
router.post(
  '/',
  requireIdempotencyKey,
  idempotencyMiddleware(),
  requireModuleWrite(MODULE_KEYS.PATIENT_ALLOCATIONS),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const parsed = RequestSchema.parse(req.body);
      const row = await reallocationService.request({
        clinicId: req.clinicId,
        patientId: parsed.patientId,
        targetOrgUnitId: parsed.targetOrgUnitId,
        targetPrimaryClinicianId: parsed.targetPrimaryClinicianId ?? null,
        requestedByStaffId: req.user!.id,
        reason: parsed.reason ?? null,
      });
      res.status(201).json({ reallocation: row });
    } catch (err) { next(err); }
  },
);

// ── List pending (approval queue) ─────────────────────────────────────
router.get(
  '/pending',
  requireModuleRead(MODULE_KEYS.PATIENT_ALLOCATIONS),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const rows = await reallocationService.listPending(req.clinicId);
      res.json({ reallocations: rows });
    } catch (err) { next(err); }
  },
);

// ── Approve ───────────────────────────────────────────────────────────
router.post(
  '/:id/approve',
  requireIdempotencyKey,
  idempotencyMiddleware(),
  requireModuleWrite(MODULE_KEYS.PATIENT_ALLOCATIONS),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const row = await reallocationService.approve(
        req.clinicId,
        req.params.id,
        req.user!.id,
      );
      res.json({ reallocation: row });
    } catch (err) { next(err); }
  },
);

// ── Reject ────────────────────────────────────────────────────────────
router.post(
  '/:id/reject',
  requireIdempotencyKey,
  idempotencyMiddleware(),
  requireModuleWrite(MODULE_KEYS.PATIENT_ALLOCATIONS),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const parsed = RejectSchema.parse(req.body);
      const row = await reallocationService.reject(
        req.clinicId,
        req.params.id,
        req.user!.id,
        parsed.rejectionReason,
      );
      res.json({ reallocation: row });
    } catch (err) { next(err); }
  },
);

export default router;
