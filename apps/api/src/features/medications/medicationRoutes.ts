import { Router } from 'express';
import { requireAuth } from '../../middleware/authMiddleware';
import { requireRoles } from '../../middleware/rbacMiddleware';
import { requireModuleRead } from '../../middleware/moduleAccessMiddleware';
import { MODULE_KEYS } from '../../shared/moduleKeys';
import { idempotencyMiddleware } from '../../middleware/idempotencyMiddleware';
import {
  listMedications,
  getMedication,
  createMedication,
  updateMedication,
  ceaseMedication,
  deleteMedication,
} from './medicationController';

const router = Router();

router.use(requireAuth);
router.use(requireModuleRead(MODULE_KEYS.MEDICATIONS));

// GET  /api/v1/patients/:patientId/medications
router.get(
  '/patients/:patientId/medications',
  requireRoles(['clinician', 'admin', 'manager', 'superadmin']),
  listMedications,
);

// GET  /api/v1/medications/:id
router.get(
  '/:id',
  requireRoles(['clinician', 'admin', 'manager', 'superadmin']),
  getMedication,
);

// POST /api/v1/medications
// S1.2: Idempotency-Key support — clients can safely retry on network
// failure without risking double-prescribing.
router.post(
  '/',
  requireRoles(['clinician', 'superadmin']),
  idempotencyMiddleware(),
  createMedication,
);

// PATCH /api/v1/medications/:id
router.patch(
  '/:id',
  requireRoles(['clinician', 'superadmin']),
  updateMedication,
);

// POST /api/v1/medications/:id/cease
router.post(
  '/:id/cease',
  requireRoles(['clinician', 'superadmin']),
  ceaseMedication,
);

// DELETE /api/v1/medications/:id  (soft delete)
router.delete(
  '/:id',
  requireRoles(['superadmin']),
  deleteMedication,
);

export default router;