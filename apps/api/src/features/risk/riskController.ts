// apps/api/src/features/risk/riskController.ts
import type { Request, Response, NextFunction } from 'express';
import { RiskAssessmentCreateSchema } from '@signacare/shared';
import { riskService } from './riskService';
import { listRiskTemplates, getRiskTemplate } from './riskTemplates';
import { buildAuthContext } from '../../shared/buildAuthContext';

export const riskController = {
  async create(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const parse = RiskAssessmentCreateSchema.safeParse(req.body);
      if (!parse.success) {
        res.status(400).json({ error: 'Validation error', code: 'VALIDATION_ERROR', details: parse.error.flatten() });
        return;
      }
      const auth = buildAuthContext(req, parse.data.patientId);
      const result = await riskService.create(auth, parse.data);
      res.status(201).json(result);
    } catch (err) {
      next(err);
    }
  },

  async listForPatient(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const patientId = req.params['patientId'] as string;
      const auth = buildAuthContext(req, patientId);
      const items = await riskService.listForPatient(auth, patientId);
      res.json(items);
    } catch (err) {
      next(err);
    }
  },

  async getById(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const id = req.params['id'] as string;
      const auth = buildAuthContext(req);
      const result = await riskService.getById(auth, id);
      res.json(result);
    } catch (err) {
      next(err);
    }
  },

  async softDelete(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const id = req.params['id'] as string;
      const auth = buildAuthContext(req);
      await riskService.softDelete(auth, id);
      res.status(204).send();
    } catch (err) {
      next(err);
    }
  },

  // ── Template catalog (audit 2026-04-16 L3 follow-up) ───────────
  // The frontend RiskAssessmentForm renders a structured form
  // driven by a template catalog. Previously these endpoints 404'd
  // because no backend handler was registered. The catalog itself
  // lives in `./riskTemplates.ts` as a static module — risk
  // templates are clinical reference data, not tenant config, so
  // the same three templates ship to every clinic.

  async listTemplates(_req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      res.json(listRiskTemplates());
    } catch (err) {
      next(err);
    }
  },

  async getTemplateById(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const templateId = req.params['templateId'] as string;
      const template = getRiskTemplate(templateId);
      if (!template) {
        res.status(404).json({
          error: `Risk template not found: ${templateId}`,
          code: 'NOT_FOUND',
        });
        return;
      }
      res.json(template);
    } catch (err) {
      next(err);
    }
  },
};
