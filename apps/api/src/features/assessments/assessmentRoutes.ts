/**
 * Phase 8 — assessment taxonomy routes.
 *
 *   GET /api/v1/assessments/rating-scales
 *     Optional: ?diagnosis=<DiagnosisCategory>
 *     Optional: ?raterType=self_rated|clinician_rated  (default: clinician_rated)
 *
 *     Returns templates in the `rating_scale` family. Outcome measures
 *     are EXCLUDED structurally (the SCALE_REGISTRY family enforces
 *     this; the filter cannot return them). Clinician-rated default is
 *     deliberate: the operator brief specifies "rating scales page must
 *     contain ONLY clinician-rated scales", and the dashboard surface
 *     consumes this endpoint with no `raterType` query.
 *
 *   GET /api/v1/assessments/outcome-measures/definitions
 *     Read-only catalogue of outcome measures from the SSoT. Used by
 *     the dedicated OutcomeMeasuresTab to render the picker UI without
 *     a templates-table dependency.
 *
 * Permission posture mirrors the existing outcomes routes: authenticated
 * + clinician role-gated + module-read on OUTCOMES (the closest module
 * key today; a future ASSESSMENTS module key may split this).
 */
import { Router, type NextFunction, type Request, type Response } from 'express';
import { z } from 'zod';
import {
  DIAGNOSIS_CATEGORY_LABEL,
  DiagnosisCategorySchema,
  MeasurementDashboardSummarySchema,
  MeasurementFamilySchema,
  RaterTypeSchema,
  groupClinicianRatedByDiagnosis,
  listOutcomeMeasures,
} from '@signacare/shared';
import { authMiddleware } from '../../middleware/authMiddleware';
import { requireModuleRead } from '../../middleware/moduleAccessMiddleware';
import { requireRoles } from '../../middleware/rbacMiddleware';
import { MODULE_KEYS } from '../../shared/moduleKeys';
import { dbAdmin, db } from '../../db/db';
import { logger } from '../../utils/logger';
import { requirePatientRelationship } from '../../shared/authGuards';
import { buildAuthContext } from '../../shared/buildAuthContext';
import { AppError } from '../../shared/errors';
import type { TemplateRowLike } from './assessmentRegistry';
import { listAvailableRatingScaleDefinitions } from './builtinAssessmentDefinitions';
import { buildMeasurementSummaryForPatient } from './measurementSummaryService';

const router = Router();
router.use(authMiddleware);
router.use(requireModuleRead(MODULE_KEYS.OUTCOMES));

const CLINICIAN_ROLES = ['clinician', 'admin', 'superadmin'];
const RatingScaleItemResponseSchema = z.object({
  id: z.string(),
  templateId: z.string().uuid().nullable(),
  slug: z.string(),
  name: z.string(),
  raterType: RaterTypeSchema,
  diagnosisCategory: DiagnosisCategorySchema.optional(),
  content: z.unknown(),
});
const RatingScaleGroupResponseSchema = z.object({
  diagnosis: DiagnosisCategorySchema,
  label: z.string(),
  scales: z.array(RatingScaleItemResponseSchema),
});
const RatingScalesGroupedResponseSchema = z.object({
  raterType: z.literal('clinician_rated'),
  groupedByDiagnosis: z.literal(true),
  groups: z.array(RatingScaleGroupResponseSchema),
  unknownCount: z.number().int().nonnegative(),
});
const RatingScalesFlatResponseSchema = z.object({
  raterType: RaterTypeSchema,
  groupedByDiagnosis: z.literal(false),
  items: z.array(RatingScaleItemResponseSchema),
  diagnosisCategory: DiagnosisCategorySchema.nullable(),
  unknownCount: z.number().int().nonnegative(),
});
const OutcomeMeasureDefinitionsResponseSchema = z.object({
  definitions: z.array(z.object({
    slug: z.string(),
    displayName: z.string(),
    ageGroup: z.string(),
    description: z.string().nullable(),
  })),
});
const DiagnosisCategoriesResponseSchema = z.object({
  categories: z.array(z.object({
    diagnosis: DiagnosisCategorySchema,
    label: z.string(),
  })),
});

// ── /rating-scales ────────────────────────────────────────────────────────

router.get(
  '/rating-scales',
  requireRoles(CLINICIAN_ROLES),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      // Default raterType: clinician_rated (operator brief: "rating scales
      // page must contain ONLY clinician-rated scales"). The query param
      // is accepted so the same endpoint can serve a future dev tool /
      // admin surface; the patient-app self-rating endpoint has its own
      // dedicated route (see patientAppRoutes.internal.ts).
      const rawRater = typeof req.query.raterType === 'string' ? req.query.raterType : undefined;
      const raterType = rawRater
        ? RaterTypeSchema.parse(rawRater)
        : 'clinician_rated';

      const rawDiagnosis = typeof req.query.diagnosis === 'string' ? req.query.diagnosis : undefined;
      const diagnosisCategory = rawDiagnosis
        ? DiagnosisCategorySchema.parse(rawDiagnosis)
        : undefined;

      const templates = (await dbAdmin('templates')
        .where({ clinic_id: req.clinicId, category: 'Rating Scales', is_active: true })
        .whereIn('type', ['assessment', 'rating_scale'])
        .whereNull('deleted_at')
        .orderBy('name')) as TemplateRowLike[];

      const { matched, unknownCount } = listAvailableRatingScaleDefinitions(templates, {
        family: 'rating_scale',
        raterType,
        diagnosisCategory,
      });

      if (unknownCount > 0) {
        // Fail-loud, not fail-silent: surface classification drift so the
        // operator can either extend the registry or remove the stale
        // template row.
        logger.warn(
          { unknownCount, clinicId: req.clinicId, raterType, diagnosisCategory },
          '[assessments/rating-scales] templates with no registry classification skipped — extend SCALE_REGISTRY or retire the rows',
        );
      }

      const items = matched.map((m) => ({
        id: m.id,
        templateId: m.templateId,
        slug: m.slug,
        name: m.name,
        raterType: m.raterType,
        diagnosisCategory: m.diagnosisCategory,
        content: m.content,
      }));

      // Group by diagnosis when the caller is the clinician-rating-scales
      // dashboard (no diagnosis filter = group). When the caller asked
      // for a specific diagnosis the response is the flat matched list
      // for that bucket only.
      if (!diagnosisCategory && raterType === 'clinician_rated') {
        const groups = groupClinicianRatedByDiagnosis().map((group) => {
          const scales = items
            .filter((item) => item.diagnosisCategory === group.diagnosis)
            // Preserve the registry's declared order within the group.
            .sort(
              (a, b) =>
                group.scales.findIndex((s) => s.slug === a.slug)
                - group.scales.findIndex((s) => s.slug === b.slug),
            );
          return { diagnosis: group.diagnosis, label: group.label, scales };
        });
        res.json(RatingScalesGroupedResponseSchema.parse({
          raterType,
          groupedByDiagnosis: true,
          groups,
          unknownCount,
        }));
        return;
      }

      res.json(RatingScalesFlatResponseSchema.parse({
        raterType,
        groupedByDiagnosis: false,
        items,
        diagnosisCategory: diagnosisCategory ?? null,
        unknownCount,
      }));
    } catch (err) {
      next(err);
    }
  },
);

// ── /outcome-measures/definitions ─────────────────────────────────────────

router.get(
  '/outcome-measures/definitions',
  requireRoles(CLINICIAN_ROLES),
  (_req: Request, res: Response) => {
    const definitions = listOutcomeMeasures().map((entry) => ({
      slug: entry.slug,
      displayName: entry.displayName,
      ageGroup: entry.ageGroup,
      description: entry.description ?? null,
    }));
    res.json(OutcomeMeasureDefinitionsResponseSchema.parse({ definitions }));
  },
);

// ── /diagnosis-categories ─────────────────────────────────────────────────

router.get(
  '/diagnosis-categories',
  requireRoles(CLINICIAN_ROLES),
  (_req: Request, res: Response) => {
    const categories = DiagnosisCategorySchema.options.map((diagnosis) => ({
      diagnosis,
      label: DIAGNOSIS_CATEGORY_LABEL[diagnosis],
    }));
    res.json(DiagnosisCategoriesResponseSchema.parse({ categories }));
  },
);

// ── /patient/:patientId/measurement-summary ──────────────────────────────
//
// Phase 8 visualisation: aggregates outcome measures + clinician-rated
// rating-scale notes + Viva self-rated submissions into a single typed
// summary the three tabs render from. Each source is read with the SAME
// filter the per-tab endpoint uses; no source is merged or compared by
// raw score (operator brief).

const MeasurementSummaryQuerySchema = z.object({
  episodeId: z.string().uuid().optional(),
  family: MeasurementFamilySchema.optional(),
  since: z.string().datetime().optional(),
});

router.get(
  '/patient/:patientId/measurement-summary',
  requireRoles(CLINICIAN_ROLES),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const auth = buildAuthContext(req);
      await requirePatientRelationship(auth, req.params.patientId);

      const queryParse = MeasurementSummaryQuerySchema.safeParse(req.query);
      if (!queryParse.success) {
        return next(
          new AppError(
            'Invalid measurement-summary query parameters',
            400,
            'VALIDATION_ERROR',
            queryParse.error.flatten(),
          ),
        );
      }
      const opts = queryParse.data;

      const summary = await buildMeasurementSummaryForPatient(db, {
        clinicId: req.clinicId!,
        patientId: req.params.patientId,
        episodeId: opts.episodeId ?? null,
        family: opts.family ?? null,
        since: opts.since ?? null,
      });

      if (summary.warnings.length > 0) {
        logger.warn(
          {
            clinicId: req.clinicId,
            patientId: req.params.patientId,
            warnings: summary.warnings.map((w) => `${w.code}/${w.source}/${w.instrumentSlug ?? '*'}(${w.count})`),
          },
          '[assessments/measurement-summary] surfaced warnings — see typed warnings array in response',
        );
      }

      // The shared measurement-summary contract deliberately keeps the
      // nested latestByFamily keys snake_case. Opt this one response out
      // of the global snake_case→camelCase middleware so the live wire
      // shape matches the shared schema exactly.
      res.locals.skipCamelCase = true;
      res.json(MeasurementDashboardSummarySchema.parse(summary));
    } catch (err) {
      next(err);
    }
  },
);

export default router;
