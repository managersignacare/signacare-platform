// apps/api/src/features/allergies/allergyController.ts
import type { Request, Response, NextFunction } from 'express';
import { CreateAllergySchema, UpdateAllergySchema } from '@signacare/shared';
import { allergyService } from './allergyService';

export const allergyController = {
  async create(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const clinicId = req.clinicId as string;
      const staffId  = req.user?.id;
      if (!clinicId || !staffId) {
        res.status(401).json({ error: 'Unauthorized', code: 'UNAUTHORIZED' });
        return;
      }
      const parse = CreateAllergySchema.safeParse(req.body);
      if (!parse.success) {
        res.status(400).json({ error: 'Validation error', code: 'VALIDATION_ERROR', details: parse.error.flatten() });
        return;
      }
      const result = await allergyService.create(clinicId, staffId, parse.data);
      res.status(201).json(result);
    } catch (err) {
      next(err);
    }
  },

  async update(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const clinicId = req.clinicId as string;
      const id       = req.params['id'] as string;
      if (!clinicId) {
        res.status(401).json({ error: 'Unauthorized', code: 'UNAUTHORIZED' });
        return;
      }
      const parse = UpdateAllergySchema.safeParse(req.body);
      if (!parse.success) {
        res.status(400).json({ error: 'Validation error', code: 'VALIDATION_ERROR', details: parse.error.flatten() });
        return;
      }
      const result = await allergyService.update(clinicId, id, parse.data);
      res.json(result);
    } catch (err) {
      next(err);
    }
  },

  async listForPatient(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const clinicId  = req.clinicId as string;
      const patientId = req.params['patientId'] as string;
      if (!clinicId) {
        res.status(401).json({ error: 'Unauthorized', code: 'UNAUTHORIZED' });
        return;
      }
      const items = await allergyService.listForPatient(clinicId, patientId);
      res.json(items);
    } catch (err) {
      next(err);
    }
  },

  async checkInteraction(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const clinicId  = req.clinicId as string;
      const patientId = req.params['patientId'] as string;
      const drugName  = req.query['drugName'] as string | undefined;
      if (!clinicId) {
        res.status(401).json({ error: 'Unauthorized', code: 'UNAUTHORIZED' });
        return;
      }
      if (!drugName || drugName.length < 2) {
        res.json([]);
        return;
      }
      const conflicts = await allergyService.checkDrugConflict(clinicId, patientId, drugName);
      res.json(conflicts);
    } catch (err) {
      next(err);
    }
  },

  async softDelete(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const clinicId = req.clinicId as string;
      const id       = req.params['id'] as string;
      if (!clinicId) {
        res.status(401).json({ error: 'Unauthorized', code: 'UNAUTHORIZED' });
        return;
      }
      await allergyService.softDelete(clinicId, id);
      res.status(204).send();
    } catch (err) {
      next(err);
    }
  },
};
