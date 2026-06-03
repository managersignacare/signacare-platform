/**
 * Role-Based Feature Routes — Aggregator
 *
 * Phase 0.7.2: Decomposed from a 2,469-line god file into 6
 * role-specific sub-routers. Each file is independently reviewable
 * and testable. This aggregator mounts them all under the same
 * path prefix so server.ts doesn't need to change.
 */
import { Router } from 'express';
import { authMiddleware } from '../../middleware/authMiddleware';

import receptionistRoutes from './receptionistFeatureRoutes';
import managerRoutes from './managerFeatureRoutes';
import nurseRoutes from './nurseFeatureRoutes';
import caseManagerRoutes from './caseManagerFeatureRoutes';
import psychiatristRoutes from './psychiatristFeatureRoutes';
import psychologistRoutes from './psychologistFeatureRoutes';
import crossRoleRoutes from './crossRoleFeatureRoutes';

const router = Router();
router.use(authMiddleware);

router.use(receptionistRoutes);
router.use(managerRoutes);
router.use(nurseRoutes);
router.use(caseManagerRoutes);
router.use(psychiatristRoutes);
router.use(psychologistRoutes);
router.use(crossRoleRoutes);

export default router;
