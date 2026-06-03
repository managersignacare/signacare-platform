// apps/api/src/features/dashboard/dashboardRoutes.ts
import { Router } from 'express';
import { authMiddleware } from '../../middleware/authMiddleware';
import { requireRoles } from '../../middleware/rbacMiddleware';
import { CASE_MANAGER_ROLES, CLINICAL_ROLES } from '../../shared/roleGroups';
import {
  getClinicianDashboard,
  getManagerDashboard,
  getTeamDashboard,
  getTeamDashboardScopes,
} from './dashboardController';

const router = Router();
router.use(authMiddleware);

const DASHBOARD_CLINICIAN_ROLES = Array.from(
  new Set([
    ...CLINICAL_ROLES,
    ...CASE_MANAGER_ROLES,
    'readonly',
    'referral_coordinator',
  ]),
);

const TEAM_DASHBOARD_ROLES = Array.from(
  new Set([
    ...CLINICAL_ROLES,
    ...CASE_MANAGER_ROLES,
    'manager',
    'admin',
    'superadmin',
  ]),
);

// GET /api/v1/dashboard/clinician
router.get(
  '/clinician',
  requireRoles(DASHBOARD_CLINICIAN_ROLES),
  getClinicianDashboard,
);

// GET /api/v1/dashboard/manager
router.get(
  '/manager',
  requireRoles(['manager', 'admin', 'superadmin']),
  getManagerDashboard,
);

// GET /api/v1/dashboard/team/scopes
router.get(
  '/team/scopes',
  requireRoles(TEAM_DASHBOARD_ROLES),
  getTeamDashboardScopes,
);

// GET /api/v1/dashboard/team
router.get(
  '/team',
  requireRoles(TEAM_DASHBOARD_ROLES),
  getTeamDashboard,
);

export default router;
