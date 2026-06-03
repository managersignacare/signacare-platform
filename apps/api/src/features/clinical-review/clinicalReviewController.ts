// apps/api/src/features/clinical-review/clinicalReview.controller.ts
import type { Request, Response, NextFunction } from 'express';
import {
  SaveEngagementScoreSchema,
  SaveKeyIssuesSchema,
  SaveReviewPlanSchema,
} from '@signacare/shared';
import { clinicalReviewService } from './clinicalReviewService';
import { buildAuthContext } from '../../shared/buildAuthContext';

export const clinicalReviewController = {
  // GET /clinical-review/patients/:patientId/summary
  async getSummary(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { patientId } = req.params;
      const episodeId = typeof req.query.episodeId === 'string' ? req.query.episodeId : undefined;
      const auth = buildAuthContext(req, patientId);
      const summary = await clinicalReviewService.getClinicalReviewSummary(
        auth,
        patientId,
        episodeId,
      );
      res.status(200).json(summary);
    } catch (err) {
      next(err);
    }
  },

  // GET /clinical-review/patients/:patientId/timeline
  async getTimeline(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const clinicId = req.clinicId;
      const actorId = req.user!.id;
      const { patientId } = req.params;
      const limit = Number(req.query.limit) || 50;
      const offset = Number(req.query.offset) || 0;

      const timeline = await clinicalReviewService.getEncounterTimeline(
        clinicId,
        patientId,
        actorId,
        limit,
        offset,
      );
      res.status(200).json(timeline);
    } catch (err) {
      next(err);
    }
  },

  // GET /clinical-review/encounters/:encounterId
  async getConsultation(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const clinicId = req.clinicId;
      const actorId = req.user!.id;
      const { encounterId } = req.params;

      const consultation = await clinicalReviewService.getConsultation(
        clinicId,
        encounterId,
        actorId,
      );
      res.status(200).json(consultation);
    } catch (err) {
      next(err);
    }
  },

  // POST /clinical-review/encounters/:encounterId/engagement
  async saveEngagement(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const clinicId = req.clinicId;
      const actorId = req.user!.id;
      const { encounterId } = req.params;

      const parseResult = SaveEngagementScoreSchema.safeParse(req.body);
      if (!parseResult.success) {
        res.status(400).json({
          error: 'Invalid engagement score payload',
          code: 'VALIDATION_ERROR',
          details: parseResult.error.flatten(),
        });
        return;
      }

      const score = await clinicalReviewService.saveEngagementScore(
        clinicId,
        encounterId,
        actorId,
        parseResult.data,
      );
      res.status(200).json(score);
    } catch (err) {
      next(err);
    }
  },

  // PUT /clinical-review/encounters/:encounterId/key-issues
  async saveKeyIssues(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const clinicId = req.clinicId;
      const actorId = req.user!.id;
      const { encounterId } = req.params;

      const parseResult = SaveKeyIssuesSchema.safeParse(req.body);
      if (!parseResult.success) {
        res.status(400).json({
          error: 'Invalid key issues payload',
          code: 'VALIDATION_ERROR',
          details: parseResult.error.flatten(),
        });
        return;
      }

      const issues = await clinicalReviewService.saveKeyIssues(
        clinicId,
        encounterId,
        actorId,
        parseResult.data,
      );
      res.status(200).json(issues);
    } catch (err) {
      next(err);
    }
  },

  // POST /clinical-review/encounters/:encounterId/plan
  async saveReviewPlan(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const clinicId = req.clinicId;
      const actorId = req.user!.id;
      const { encounterId } = req.params;

      const parseResult = SaveReviewPlanSchema.safeParse(req.body);
      if (!parseResult.success) {
        res.status(400).json({
          error: 'Invalid review plan payload',
          code: 'VALIDATION_ERROR',
          details: parseResult.error.flatten(),
        });
        return;
      }

      const result = await clinicalReviewService.saveReviewPlan(
        clinicId,
        encounterId,
        actorId,
        parseResult.data,
      );
      res.status(201).json(result);
    } catch (err) {
      next(err);
    }
  },
};