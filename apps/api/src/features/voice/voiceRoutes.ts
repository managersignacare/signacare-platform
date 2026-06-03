// apps/api/src/features/voice/voiceRoutes.ts
import { Router } from 'express';
import { authMiddleware } from '../../middleware/authMiddleware';
import { requireModuleRead } from '../../middleware/moduleAccessMiddleware';
import { MODULE_KEYS } from '../../shared/moduleKeys';
import { requireRoles } from '../../middleware/rbacMiddleware';
import {
  createCall,
  patchCall,
  getCallsByPatient,
  getCallDetail,
  createScript,
  getScripts,
  updateScript,
  setPreferences,
  getPreferences,
} from './voiceController';

const router = Router();
router.use(authMiddleware);
router.use(requireModuleRead(MODULE_KEYS.VOICE));

// ── Call logs ──────────────────────────────────────────────────────────────────
// POST   /api/v1/voice/calls
// GET    /api/v1/voice/calls/:callId
// PATCH  /api/v1/voice/calls/:callId
// GET    /api/v1/voice/calls/patient/:patientId

router.post(
  '/calls',
  requireRoles(['clinician', 'admin', 'superadmin']),
  createCall,
);

router.get(
  '/calls/patient/:patientId',
  requireRoles([
    'clinician',
    'admin',
    'manager',
    'superadmin',
  ]),
  getCallsByPatient,
);

router.get(
  '/calls/:callId',
  requireRoles([
    'clinician',
    'admin',
    'manager',
    'superadmin',
  ]),
  getCallDetail,
);

router.patch(
  '/calls/:callId',
  requireRoles(['clinician', 'admin', 'superadmin']),
  patchCall,
);

// ── Scripts ────────────────────────────────────────────────────────────────────
// GET   /api/v1/voice/scripts
// POST  /api/v1/voice/scripts
// PATCH /api/v1/voice/scripts/:scriptId

router.get(
  '/scripts',
  requireRoles([
    'clinician',
    'admin',
    'manager',
    'superadmin',
  ]),
  getScripts,
);

router.post(
  '/scripts',
  requireRoles(['admin', 'manager', 'superadmin']),
  createScript,
);

router.patch(
  '/scripts/:scriptId',
  requireRoles(['admin', 'manager', 'superadmin']),
  updateScript,
);

// ── Patient preferences ────────────────────────────────────────────────────────
// GET /api/v1/voice/preferences/:patientId
// PUT /api/v1/voice/preferences/:patientId

router.get(
  '/preferences/:patientId',
  requireRoles([
    'clinician',
    'admin',
    'manager',
    'superadmin',
  ]),
  getPreferences,
);

router.put(
  '/preferences/:patientId',
  requireRoles(['clinician', 'admin', 'superadmin']),
  setPreferences,
);

export default router;
