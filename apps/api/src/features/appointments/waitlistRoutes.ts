// apps/api/src/features/appointments/waitlistRoutes.ts
import { Router } from 'express';
import { authMiddleware } from '../../middleware/authMiddleware';
import { tenantMiddleware } from '../../middleware/tenantMiddleware';
import { requireRole } from '../../middleware/rbacMiddleware';
import { waitlistController } from './waitlistController';

export const waitlistRoutes = Router();

waitlistRoutes.use(authMiddleware, tenantMiddleware);

waitlistRoutes.post(
  '/',
  requireRole('clinician', 'admin', 'manager', 'receptionist'),
  waitlistController.create,
);
waitlistRoutes.get(
  '/',
  requireRole('clinician', 'admin', 'manager', 'receptionist'),
  waitlistController.list,
);
waitlistRoutes.put(
  '/:id',
  requireRole('clinician', 'admin', 'manager', 'receptionist'),
  waitlistController.update,
);
waitlistRoutes.post(
  '/:id/promote',
  requireRole('clinician', 'admin', 'manager', 'receptionist'),
  waitlistController.promoteToAppointment,
);