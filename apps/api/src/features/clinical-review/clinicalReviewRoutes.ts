// apps/api/src/features/clinical-review/clinicalReview.routes.ts
import { Router } from 'express';
import { clinicalReviewController } from './clinicalReviewController';
import { authMiddleware } from '../../middleware/authMiddleware';
import { tenantMiddleware } from '../../middleware/tenantMiddleware';

const router = Router();

router.use(authMiddleware, tenantMiddleware);

// Patient-level aggregation
// GET /api/v1/clinical-review/patients/:patientId/summary
router.get(
  '/patients/:patientId/summary',
  (req, res, next) => clinicalReviewController.getSummary(req, res, next),
);

// GET /api/v1/clinical-review/patients/:patientId/timeline
router.get(
  '/patients/:patientId/timeline',
  (req, res, next) => clinicalReviewController.getTimeline(req, res, next),
);

// Encounter-level
// GET /api/v1/clinical-review/encounters/:encounterId
router.get(
  '/encounters/:encounterId',
  (req, res, next) => clinicalReviewController.getConsultation(req, res, next),
);

// POST /api/v1/clinical-review/encounters/:encounterId/engagement
router.post(
  '/encounters/:encounterId/engagement',
  (req, res, next) => clinicalReviewController.saveEngagement(req, res, next),
);

// PUT /api/v1/clinical-review/encounters/:encounterId/key-issues
router.put(
  '/encounters/:encounterId/key-issues',
  (req, res, next) => clinicalReviewController.saveKeyIssues(req, res, next),
);

// POST /api/v1/clinical-review/encounters/:encounterId/plan
router.post(
  '/encounters/:encounterId/plan',
  (req, res, next) => clinicalReviewController.saveReviewPlan(req, res, next),
);

export { router as clinicalReviewRoutes };

