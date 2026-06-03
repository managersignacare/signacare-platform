// apps/api/src/features/risk/risk.routes.ts
//
// Two routers live in this file because the risk-assessment API
// surface splits across two mount points at /api/v1/ — some endpoints
// are keyed on risk_assessments directly (`POST /risk-assessments`)
// while others are nested under a patient (`GET /patients/:patientId
// /risk-assessments`). Exposing both as relative-path routers that
// server.ts mounts at the right prefix keeps us consistent with every
// other feature (no hardcoded `/api/v1/...` path literals inside the
// router file) and eliminates the Phase 0.7 PR2 "bare mount" latent
// trap flagged by audit L3.
//
// Every route gets auth + tenant middleware inline because we need
// tenant scoping to apply before the controller reads req.clinicId.
// The module-access gate is applied via router.use at the top so
// it fires for every handler whether future routes are added at the
// root or under the patient prefix.
import { Router } from 'express';
import { riskController } from './riskController';
import { authMiddleware } from '../../middleware/authMiddleware';
import { tenantMiddleware } from '../../middleware/tenantMiddleware';
import { requireModuleRead } from '../../middleware/moduleAccessMiddleware';
import { MODULE_KEYS } from '../../shared/moduleKeys';

// ── Root-level router: POST /risk-assessments + templates ──────
//
// Mounted by server.ts as `app.use('/api/v1/risk-assessments',
// riskRoutes)` so `router.post('/')` resolves to
// `/api/v1/risk-assessments`.
//
// Also owns the template catalog endpoints that the frontend
// RiskAssessmentForm uses (audit 2026-04-16 L3 follow-up — these
// were previously un-registered and 404'd). Templates are static
// clinical reference data shared across tenants; no tenant scoping
// required but we still gate on the same module + auth middleware
// so only authenticated staff can see them.
export const riskRoutes = Router();
riskRoutes.use(authMiddleware, requireModuleRead(MODULE_KEYS.RISK_ASSESSMENTS));
riskRoutes.post('/', tenantMiddleware, riskController.create);

// More specific routes first: /templates before /:id so the param
// route doesn't greedy-match the literal.
riskRoutes.get('/templates', riskController.listTemplates);
riskRoutes.get('/templates/:templateId', riskController.getTemplateById);

// ── Patient-nested router: /patients/:patientId/risk-assessments ─
//
// Mounted by server.ts as `app.use('/api/v1/patients',
// riskPatientRoutes)` so the nested paths below resolve to
// `/api/v1/patients/:patientId/risk-assessments[/*]`. Keeping this
// as a second router lets us stay relative-path-only while the
// two surfaces share middleware and controllers.
export const riskPatientRoutes = Router();
riskPatientRoutes.use(
  authMiddleware,
  requireModuleRead(MODULE_KEYS.RISK_ASSESSMENTS),
);
riskPatientRoutes.get(
  '/:patientId/risk-assessments',
  tenantMiddleware,
  riskController.listForPatient,
);
riskPatientRoutes.get(
  '/:patientId/risk-assessments/:id',
  tenantMiddleware,
  riskController.getById,
);
riskPatientRoutes.delete(
  '/:patientId/risk-assessments/:id',
  tenantMiddleware,
  riskController.softDelete,
);

// Default export preserved for any callers still importing the
// legacy bare-mount form — alias to the root router so importing
// default and calling `app.use(riskRoutes)` would still work in a
// pinch. server.ts should use the named exports with explicit
// prefixes.
export default riskRoutes;
