// apps/api/src/features/allergies/allergies.routes.ts
import { Router } from 'express';
import { allergyController } from './allergyController';
import { authMiddleware } from '../../middleware/authMiddleware';
import { tenantMiddleware } from '../../middleware/tenantMiddleware';

const router = Router();

router.post(
  '/api/v1/allergies',
  authMiddleware,
  tenantMiddleware,
  allergyController.create,
);
router.get(
  '/api/v1/patients/:patientId/allergies',
  authMiddleware,
  tenantMiddleware,
  allergyController.listForPatient,
);
router.get(
  '/api/v1/patients/:patientId/allergies/interaction-check',
  authMiddleware,
  tenantMiddleware,
  allergyController.checkInteraction,
);
router.patch(
  '/api/v1/patients/:patientId/allergies/:id',
  authMiddleware,
  tenantMiddleware,
  allergyController.update,
);
router.delete(
  '/api/v1/patients/:patientId/allergies/:id',
  authMiddleware,
  tenantMiddleware,
  allergyController.softDelete,
);

export default router;
