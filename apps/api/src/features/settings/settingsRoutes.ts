// apps/api/src/features/settings/settingsRoutes.ts
import { Router } from 'express'
import { authMiddleware } from '../../middleware/authMiddleware'
import { tenantMiddleware } from '../../middleware/tenantMiddleware'
import { requireRole } from '../../middleware/rbacMiddleware'
import { requireModuleRead } from '../../middleware/moduleAccessMiddleware'
import { MODULE_KEYS } from '../../shared/moduleKeys'
import { getThresholds, setThreshold, bulkSetThresholds } from './settingsController'

export const settingsRoutes = Router()

settingsRoutes.use(authMiddleware, tenantMiddleware)
settingsRoutes.use(requireModuleRead(MODULE_KEYS.SETTINGS))

// GET /api/v1/settings/thresholds
settingsRoutes.get(
  '/thresholds',
  requireRole('admin', 'manager', 'superadmin'),
  getThresholds,
)

// PUT /api/v1/settings/thresholds
settingsRoutes.put(
  '/thresholds',
  requireRole('admin', 'superadmin'),
  setThreshold,
)

// PUT /api/v1/settings/thresholds/bulk
settingsRoutes.put(
  '/thresholds/bulk',
  requireRole('admin', 'superadmin'),
  bulkSetThresholds,
)

export default settingsRoutes;
