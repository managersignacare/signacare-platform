// apps/api/src/features/pathology/pathologyRoutes.ts
import { Router } from 'express';
import { authMiddleware } from '../../middleware/authMiddleware';
import { requireModuleRead } from '../../middleware/moduleAccessMiddleware';
import { MODULE_KEYS } from '../../shared/moduleKeys';
import { requireRole } from '../../middleware/rbacMiddleware';
import * as ctrl from './pathologyController';
import type { PathologyOrdersRow } from '../../db/types/pathology_orders';
import type { PathologyResultsRow } from '../../db/types/pathology_results';

const router = Router();
router.use(authMiddleware);
router.use(requireModuleRead(MODULE_KEYS.PATHOLOGY));

// GET /pathology/patient/:patientId — shorthand for patient's pathology
router.get('/patient/:patientId', async (req, res, next) => {
  try {
    const { db } = await import('../../db/db');
    const orders = await db<PathologyOrdersRow>('pathology_orders')
      .where({ patient_id: req.params.patientId, clinic_id: req.clinicId })
      .whereNull('deleted_at')
      .orderBy('created_at', 'desc');
    const orderIds = orders.map((order) => order.id);
    const results = orderIds.length === 0
      ? []
      : await db<PathologyResultsRow>('pathology_results').whereIn('pathology_order_id', orderIds);
    res.json({ orders, results });
  } catch (err) { next(err); }
});

// Orders
router.post('/orders', requireRole('clinician', 'admin', 'superadmin'), ctrl.placeOrder);
router.get('/patients/:patientId/orders', ctrl.listOrders);
router.get('/orders/:id', ctrl.getOrder);

// Results (typically ingested by HL7 worker, but also exposes manual ingestion for integration)
router.post('/results', requireRole('clinician', 'superadmin'), ctrl.ingestResult);

// Critical result workflow
router.get('/results/critical', ctrl.listCriticalUnacknowledged);
router.post('/results/:resultId/acknowledge', ctrl.acknowledgeCritical);

export default router;
