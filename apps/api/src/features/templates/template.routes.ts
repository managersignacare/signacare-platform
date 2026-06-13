import { Router } from 'express';
import { requireAuth } from '../../middleware/authMiddleware';
import { requireModuleRead } from '../../middleware/moduleAccessMiddleware';
import { requireRole } from '../../middleware/rbacMiddleware';
import { MODULE_KEYS } from '../../shared/moduleKeys';
import { templateController as ctrl } from './template.controller';

const router = Router();
const admin = requireRole('admin', 'superadmin');

router.use(requireAuth);
router.use(requireModuleRead(MODULE_KEYS.TEMPLATES));

router.get('/categories',           ctrl.listCategories);
router.post('/categories',          admin, ctrl.createCategory);
router.patch('/categories/:id',     admin, ctrl.updateCategory);
router.delete('/categories/:id',    admin, ctrl.deleteCategory);
router.get('/',                   ctrl.list);
router.get('/:id',                ctrl.getById);
router.post('/',                  ctrl.create);
router.patch('/:id',              ctrl.update);
// REST convention: publish/retire are status transitions on an existing
// resource → PATCH, not POST. POST is for creating new resources.
router.patch('/:id/publish',      ctrl.publish);
router.patch('/:id/retire',       ctrl.retire);
router.delete('/:id',             ctrl.softDelete);

export default router;
