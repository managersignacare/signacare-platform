import { Router } from 'express'
import { authMiddleware } from '../../middleware/authMiddleware'
import { tenantMiddleware } from '../../middleware/tenantMiddleware'
import { requireRole } from '../../middleware/rbacMiddleware'
import {
  getLevelLabels,
  bulkSetLevelLabels,
  getOrgTree,
  getFlatOrgUnits,
  createOrgUnit,
  updateOrgUnit,
  deleteOrgUnit,
  getPrograms,
  createProgram,
  updateProgram,
  deleteProgram,
  assignProgramToUnit,
  unassignProgramFromUnit,
} from './orgSettingsController'

export const orgSettingsRoutes = Router()

orgSettingsRoutes.use(authMiddleware, tenantMiddleware)

// Level labels
orgSettingsRoutes.get('/level-labels', getLevelLabels)
orgSettingsRoutes.put('/level-labels', requireRole('admin', 'superadmin'), bulkSetLevelLabels)

// Org units
orgSettingsRoutes.get('/units/tree', getOrgTree)
orgSettingsRoutes.get('/units', getFlatOrgUnits)
orgSettingsRoutes.post('/units', requireRole('admin', 'superadmin'), createOrgUnit)
orgSettingsRoutes.patch('/units/:id', requireRole('admin', 'superadmin'), updateOrgUnit)
orgSettingsRoutes.delete('/units/:id', requireRole('admin', 'superadmin'), deleteOrgUnit)

// Programs
orgSettingsRoutes.get('/programs', getPrograms)
orgSettingsRoutes.post('/programs', requireRole('admin', 'superadmin'), createProgram)
orgSettingsRoutes.patch('/programs/:id', requireRole('admin', 'superadmin'), updateProgram)
orgSettingsRoutes.delete('/programs/:id', requireRole('admin', 'superadmin'), deleteProgram)

// Program assignments
orgSettingsRoutes.post('/assignments', requireRole('admin', 'superadmin'), assignProgramToUnit)
orgSettingsRoutes.delete('/assignments', requireRole('admin', 'superadmin'), unassignProgramFromUnit)

export default orgSettingsRoutes
