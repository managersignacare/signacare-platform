/**
 * apps/api/src/features/telehealth/telehealthRoutes.ts
 *
 * Single endpoint: POST /api/v1/telehealth/appointments/:id/room
 * generates a Jitsi room URL and persists it to
 * `appointments.telehealth_url`, returning the URL. Idempotent —
 * if a URL is already set, it returns the existing one rather
 * than rotating it (so a second click by the same clinician
 * drops them into the same room as the first).
 *
 * Gated behind requireModuleWrite(MODULE_KEYS.TELEHEALTH). The
 * RBAC fallback maps to appointment:create / appointment:update,
 * so any clinician / admin / receptionist can generate a room
 * without an explicit staff_module_access grant.
 */
import { Router, type Request, type Response, type NextFunction } from 'express';
import { authMiddleware } from '../../middleware/authMiddleware';
import { tenantMiddleware } from '../../middleware/tenantMiddleware';
import { requireModuleWrite } from '../../middleware/moduleAccessMiddleware';
import { MODULE_KEYS } from '../../shared/moduleKeys';
import { db } from '../../db/db';
import { generateTelehealthUrl } from './telehealthService';
import { AppError } from '../../shared/errors';

const router = Router();
router.use(authMiddleware, tenantMiddleware);

router.post(
  '/appointments/:id/room',
  requireModuleWrite(MODULE_KEYS.TELEHEALTH),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const clinicId = req.clinicId;
      const appt = await db('appointments')
        .where({ id: req.params.id, clinic_id: clinicId })
        .whereNull('deleted_at')
        .first() as { id: string; telehealth_url: string | null } | undefined;

      if (!appt) {
        throw new AppError('Appointment not found', 404, 'APPOINTMENT_NOT_FOUND' as never);
      }

      // Idempotent — reuse the existing URL if one is set.
      if (appt.telehealth_url) {
        res.json({ url: appt.telehealth_url, created: false });
        return;
      }

      const url = generateTelehealthUrl(clinicId);
      await db('appointments')
        .where({ id: appt.id, clinic_id: clinicId })
        .update({
          telehealth: true,
          telehealth_url: url,
          telehealth_provider: 'jitsi',
          updated_at: new Date(),
        });

      res.status(201).json({ url, created: true });
    } catch (err) { next(err); }
  },
);

export default router;
