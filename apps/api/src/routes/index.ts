// apps/api/src/routes/index.ts
import { Router } from 'express';
import referralRoutes from '../features/referrals/referralRoutes';
import { appointmentRoutes } from '../features/appointments/appointmentRoutes';
import { waitlistRoutes } from '../features/appointments/waitlistRoutes';
import { outlookRoutes } from '../integrations/outlook/outlookRoutes';
// ... other imports

const router = Router();

router.use('/api/v1/referrals', referralRoutes);
router.use('/v1/appointments', appointmentRoutes);
router.use('/v1/waitlist', waitlistRoutes);
router.use('/v1/integrations/outlook', outlookRoutes);
// ... other feature routes

export default router;
