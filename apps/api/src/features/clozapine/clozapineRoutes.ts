import { Router } from 'express';
import { requireAuth } from '../../middleware/authMiddleware';
import { requireModuleRead } from '../../middleware/moduleAccessMiddleware';
import { MODULE_KEYS } from '../../shared/moduleKeys';
import { requireRoles } from '../../middleware/rbacMiddleware';
import { idempotencyMiddleware } from '../../middleware/idempotencyMiddleware';
import {
  listActiveClozapineRegistrations,
  listClozapineRegistrations,
  getClozapineRegistration,
  createClozapineRegistration,
  updateClozapineRegistration,
  listBloodResults,
  recordBloodResult,
  listTitrationDays,
  upsertTitrationDay,
  listAdministrations,
  createAdministration,
  listObservations,
  createObservation,
  listMonitoringChecks,
  upsertMonitoringCheck,
} from './clozapineController';

const router = Router();
const CLINICAL = ['clinician', 'admin', 'manager', 'superadmin'];
const PRESCRIBER = ['clinician', 'superadmin'];

router.use(requireAuth);
router.use(requireModuleRead(MODULE_KEYS.CLOZAPINE));

// ── Registrations ────────────────────────────────────────────────────────────
router.get('/', requireRoles(CLINICAL), listActiveClozapineRegistrations);
router.get('/patients/:patientId/clozapine', requireRoles(CLINICAL), listClozapineRegistrations);
router.get('/:id', requireRoles(CLINICAL), getClozapineRegistration);
// S1.2: Idempotency-Key on clozapine registration create.
router.post('/', requireRoles(PRESCRIBER), idempotencyMiddleware(), createClozapineRegistration);
router.patch('/:id', requireRoles(PRESCRIBER), updateClozapineRegistration);

// ── Blood Results ────────────────────────────────────────────────────────────
router.get('/:registrationId/blood-results', requireRoles(CLINICAL), listBloodResults);
// S1.2: Idempotency-Key on blood result recording — duplicate FBC entries
// would corrupt the clozapine monitoring trend.
router.post('/blood-results', requireRoles(PRESCRIBER), idempotencyMiddleware(), recordBloodResult);

// ── Titration Days ───────────────────────────────────────────────────────────
router.get('/:registrationId/titration-days', requireRoles(CLINICAL), listTitrationDays);
router.post('/titration-days', requireRoles(PRESCRIBER), upsertTitrationDay);

// ── Administrations ──────────────────────────────────────────────────────────
router.get('/:registrationId/administrations', requireRoles(CLINICAL), listAdministrations);
// S1.2: Idempotency-Key on administration recording — double-recording
// a dose would be a clinical safety event.
router.post('/administrations', requireRoles(CLINICAL), idempotencyMiddleware(), createAdministration);

// ── Observations ─────────────────────────────────────────────────────────────
router.get('/:registrationId/observations', requireRoles(CLINICAL), listObservations);
router.post('/observations', requireRoles(CLINICAL), createObservation);

// ── Monitoring Checks ────────────────────────────────────────────────────────
router.get('/:registrationId/monitoring-checks', requireRoles(CLINICAL), listMonitoringChecks);
router.post('/monitoring-checks', requireRoles(CLINICAL), upsertMonitoringCheck);

export default router;
