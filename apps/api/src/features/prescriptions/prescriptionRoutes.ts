import { Router } from 'express';
import { requireAuth } from '../../middleware/authMiddleware';
import { requireModuleRead } from '../../middleware/moduleAccessMiddleware';
import { MODULE_KEYS } from '../../shared/moduleKeys';
import { requireRoles } from '../../middleware/rbacMiddleware';
import { idempotencyMiddleware } from '../../middleware/idempotencyMiddleware';
import {
  listPrescriptions,
  getPrescription,
  createPrescription,
  runSafeScriptCheck,
  submitErx,
  cancelPrescription,
  getMySLStatus,
  postMySLConsentRequest,
  getMySLScripts,
  getMySLConfigStatus,
  postDeliverToken,
  postVerifyIhi,
  postSearchIhi,
  postUpdateIhiDetails,
  postCreateNewbornIhi,
  getHiServiceStatus,
  getErxStatus,
  pollDispenseNotifications,
} from './prescriptionController';

const router = Router();

router.use(requireAuth);
router.use(requireModuleRead(MODULE_KEYS.PRESCRIPTIONS));

const clinician = requireRoles(['clinician', 'admin', 'manager', 'superadmin']);
const prescriber = requireRoles(['clinician', 'superadmin']);
const adminOnly = requireRoles(['admin', 'superadmin']);

// ── Named routes FIRST (before /:id catch-all) ──────────────────────────────

// GET  /api/v1/prescriptions/patients/:patientId/prescriptions
router.get('/patients/:patientId/prescriptions', clinician, listPrescriptions);

// POST /api/v1/prescriptions  (create)
// S1.2: Idempotency-Key support — prescriptions are clinical writes;
// double-creation = duplicate scripts.
router.post('/', prescriber, idempotencyMiddleware(), createPrescription);

// ── eRx Status & ETP1 ──
router.get('/erx/status', clinician, getErxStatus);
router.post('/erx/poll-dispense', adminOnly, pollDispenseNotifications);

// ── MySL (My Script List) ──
router.get('/mysl/status', clinician, getMySLConfigStatus);
router.get('/mysl/patient/:ihi', clinician, getMySLStatus);
router.post('/mysl/consent', prescriber, postMySLConsentRequest);
router.get('/mysl/scripts/:patientFhirId', clinician, getMySLScripts);

// ── HI Service (IHI) ──
router.get('/hi/status', clinician, getHiServiceStatus);
router.post('/hi/verify-ihi', prescriber, postVerifyIhi);
router.post('/hi/search-ihi', prescriber, postSearchIhi);
router.post('/hi/update-ihi-details', prescriber, postUpdateIhiDetails);
router.post('/hi/create-newborn-ihi', prescriber, postCreateNewbornIhi);

// ── /:id routes LAST ────────────────────────────────────────────────────────

router.get('/:id', clinician, getPrescription);
router.post('/:id/safescript-check', prescriber, runSafeScriptCheck);
router.post('/:id/submit-erx', prescriber, submitErx);
router.post('/:id/cancel', prescriber, cancelPrescription);
router.post('/:id/deliver-token', prescriber, postDeliverToken);

export default router;
