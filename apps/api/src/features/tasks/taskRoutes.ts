import { Router } from 'express';
import { authMiddleware } from '../../middleware/authMiddleware';
import { requireModuleRead } from '../../middleware/moduleAccessMiddleware';
import { MODULE_KEYS } from '../../shared/moduleKeys';
import { idempotencyMiddleware } from '../../middleware/idempotencyMiddleware';
import * as ctrl from './taskController';

const router = Router();
router.use(authMiddleware);
router.use(requireModuleRead(MODULE_KEYS.TASKS));

// S1.2: Idempotency-Key on task create.
router.post('/', idempotencyMiddleware(), ctrl.createTask);
router.get('/summary', ctrl.getTaskMonitoringSummary);
router.get('/', ctrl.listTasks);          // ?patientId=&status=&assignedToId=&dueBefore=
router.get('/:taskId', ctrl.getTask);
router.patch('/:taskId', ctrl.updateTask);
router.delete('/:taskId', ctrl.deleteTask);

export default router;
