// apps/api/src/features/appointments/appointmentRoutes.ts
import { Router } from 'express';
import { appointmentController } from './appointmentController';
import { authMiddleware } from '../../middleware/authMiddleware';
import { requireModuleRead } from '../../middleware/moduleAccessMiddleware';
import { MODULE_KEYS } from '../../shared/moduleKeys';
import { tenantMiddleware } from '../../middleware/tenantMiddleware';
import { requireRoles } from '../../middleware/rbacMiddleware';
import { idempotencyMiddleware } from '../../middleware/idempotencyMiddleware';
import {
  CLINICAL_ROLES,
  MANAGER_ROLES,
  RECEPTIONIST_ROLES,
} from '../../shared/roleGroups';

export const appointmentRoutes = Router();

appointmentRoutes.use(authMiddleware, tenantMiddleware);
appointmentRoutes.use(requireModuleRead(MODULE_KEYS.APPOINTMENTS));

const APPOINTMENT_READ_ROLES = Array.from(
  new Set([
    ...CLINICAL_ROLES,
    ...MANAGER_ROLES,
    ...RECEPTIONIST_ROLES,
    'readonly',
  ]),
);

const APPOINTMENT_WRITE_ROLES = Array.from(
  new Set([
    ...CLINICAL_ROLES,
    ...MANAGER_ROLES,
    ...RECEPTIONIST_ROLES,
  ]),
);

// S1.2: Idempotency-Key support — appointments must not double-book on retry.
appointmentRoutes.post(
  '/',
  requireRoles(APPOINTMENT_WRITE_ROLES),
  idempotencyMiddleware(),
  appointmentController.create,
);
appointmentRoutes.get(
  '/',
  requireRoles(APPOINTMENT_READ_ROLES),
  appointmentController.list,
);
appointmentRoutes.get(
  '/:id',
  requireRoles(APPOINTMENT_READ_ROLES),
  appointmentController.getById,
);
appointmentRoutes.put(
  '/:id',
  requireRoles(APPOINTMENT_WRITE_ROLES),
  appointmentController.update,
);
appointmentRoutes.patch(
  '/:id',
  requireRoles(APPOINTMENT_WRITE_ROLES),
  appointmentController.update,
);
appointmentRoutes.post(
  '/:id/status',
  requireRoles(APPOINTMENT_WRITE_ROLES),
  appointmentController.updateStatus,
);
appointmentRoutes.post(
  '/:id/cancel',
  requireRoles(APPOINTMENT_WRITE_ROLES),
  appointmentController.cancel,
);
// Recurring appointment creation
// S1.2: Idempotency-Key support — recurring creation generates many rows;
// double-creation would be especially painful.
appointmentRoutes.post(
  '/recurring',
  requireRoles(APPOINTMENT_WRITE_ROLES),
  idempotencyMiddleware(),
  appointmentController.createRecurring,
);

// Phase 13 PR5 — multi-clinician attendee endpoints. Reads behind
// appointment:read (any team member can see the participant list);
// writes behind the same write tier as the appointment itself.
appointmentRoutes.get(
  '/:id/attendees',
  requireRoles(APPOINTMENT_READ_ROLES),
  appointmentController.listAttendees,
);
appointmentRoutes.post(
  '/:id/attendees',
  requireRoles(APPOINTMENT_WRITE_ROLES),
  appointmentController.addAttendee,
);
appointmentRoutes.patch(
  '/:id/attendees/:staffId',
  requireRoles(APPOINTMENT_WRITE_ROLES),
  appointmentController.patchAttendee,
);
appointmentRoutes.delete(
  '/:id/attendees/:staffId',
  requireRoles(APPOINTMENT_WRITE_ROLES),
  appointmentController.removeAttendee,
);

export default appointmentRoutes;
