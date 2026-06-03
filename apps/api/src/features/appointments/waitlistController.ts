// apps/api/src/features/appointments/waitlistController.ts
import type { NextFunction, Request, Response } from 'express';
import { z } from 'zod';
import { WaitlistCreateDTO, WaitlistUpdateDTO } from '@signacare/shared';
import { waitlistService } from './waitlistService';

// Promote a waitlist entry → appointment. Local Zod schema per CLAUDE.md
// §12 (no cross-file abstraction). Type list matches appointments.type
// enum declared by the shared appointment schema.
const PromoteToAppointmentSchema = z.object({
  clinicianId: z.string().uuid(),
  episodeId: z.string().uuid().optional(),
  startTime: z.string().datetime().or(z.string().regex(/^\d{4}-\d{2}-\d{2}T/)),
  endTime: z.string().datetime().or(z.string().regex(/^\d{4}-\d{2}-\d{2}T/)),
  type: z.enum(['initial', 'follow_up', 'assessment', 'telehealth', 'group', 'clinical_review']),
  notes: z.string().optional(),
});

export const waitlistController = {
  async create(req: Request, res: Response, next: NextFunction) {
    try {
      const clinicId = req.clinicId as string;
      const staffId = req.user?.id as string;
      const dto = WaitlistCreateDTO.parse(req.body);
      const entry = await waitlistService.create(clinicId, staffId, dto);
      res.status(201).json(entry);
    } catch (err) {
      next(err);
    }
  },

  async update(req: Request, res: Response, next: NextFunction) {
    try {
      const clinicId = req.clinicId as string;
      const { id } = req.params;
      const dto = WaitlistUpdateDTO.parse(req.body);
      const entry = await waitlistService.update(clinicId, id, dto);
      res.json(entry);
    } catch (err) {
      next(err);
    }
  },

  async list(req: Request, res: Response, next: NextFunction) {
    try {
      const clinicId = req.clinicId as string;
      const patientId = req.query['patientId'] ? String(req.query['patientId']) : undefined;
      const status = req.query['status'] ? String(req.query['status']) : undefined;
      const priority = req.query['priority'] ? String(req.query['priority']) : undefined;
      const limit = req.query['limit'] ? Number(req.query['limit']) : 50;
      const offset = req.query['offset'] ? Number(req.query['offset']) : 0;
      const entries = await waitlistService.list(clinicId, { patientId, status, priority, limit, offset });
      res.json(entries);
    } catch (err) {
      next(err);
    }
  },

  async promoteToAppointment(req: Request, res: Response, next: NextFunction) {
    try {
      const clinicId = req.clinicId as string;
      const staffId = req.user?.id as string;
      const { id } = req.params;
      const dto = PromoteToAppointmentSchema.parse(req.body);
      const result = await waitlistService.promoteToAppointment(clinicId, staffId, id, dto);
      res.status(201).json(result);
    } catch (err) {
      next(err);
    }
  },
};