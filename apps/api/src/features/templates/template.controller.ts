import type { Request, Response, NextFunction } from 'express';
import { templateService } from './template.service';
import { CreateTemplateSchema, UpdateTemplateSchema } from '@signacare/shared';
import { logger } from '../../utils/logger';

export const templateController = {
  async list(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { clinicId } = req.user!;
      const status = typeof req.query.status === 'string' ? req.query.status : undefined;
      const q      = typeof req.query.q      === 'string' ? req.query.q      : undefined;
      const templates = await templateService.list(clinicId, { status, q });
      res.json(templates);
    } catch (err) {
      next(err);
    }
  },

  async getById(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { clinicId } = req.user!;
      const tpl = await templateService.getById(clinicId, req.params.id);
      res.json(tpl);
    } catch (err) {
      next(err);
    }
  },

  async create(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const {  clinicId, id: userId } = req.user!;
      const parsed = CreateTemplateSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: 'Validation failed', code: 'VALIDATION_ERROR', details: parsed.error.flatten() });
        return;
      }
      const tpl = await templateService.create(clinicId, userId, parsed.data);
      logger.info({ clinicId, templateId: tpl.id }, 'template created');
      res.status(201).json(tpl);
    } catch (err) {
      next(err);
    }
  },

  async update(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { clinicId } = req.user!;
      const parsed = UpdateTemplateSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: 'Validation failed', code: 'VALIDATION_ERROR', details: parsed.error.flatten() });
        return;
      }
      const tpl = await templateService.update(clinicId, req.params.id, parsed.data);
      res.json(tpl);
    } catch (err) {
      next(err);
    }
  },

  async publish(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const {  clinicId, id: userId } = req.user!;
      const tpl = await templateService.publish(clinicId, req.params.id);
      logger.info({ clinicId, templateId: tpl.id, publishedBy: userId }, 'template published');
      res.json(tpl);
    } catch (err) {
      next(err);
    }
  },

  async retire(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const {  clinicId, id: userId } = req.user!;
      const tpl = await templateService.retire(clinicId, req.params.id);
      logger.info({ clinicId, templateId: tpl.id, retiredBy: userId }, 'template retired');
      res.json(tpl);
    } catch (err) {
      next(err);
    }
  },

  async softDelete(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { clinicId } = req.user!;
      await templateService.softDelete(clinicId, req.params.id);
      res.status(204).send();
    } catch (err) {
      next(err);
    }
  },
};
