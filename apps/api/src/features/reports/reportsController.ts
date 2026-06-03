// apps/api/src/features/reports/reports.controller.ts
import type { Request, Response, NextFunction } from 'express';
import { ReportFiltersSchema, GenerateReportSchema } from '@signacare/shared';
import { reportsService } from './reportsService';

export const reportsController = {
  async getEncounterReport(
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> {
    try {
      const clinicId = req.clinicId as string;
      const actorId = req.user!.id;
      const parsed = ReportFiltersSchema.safeParse(req.query);
      if (!parsed.success) {
        res.status(400).json({
          error: 'Invalid report filters',
          code: 'VALIDATION_ERROR',
          details: parsed.error.flatten(),
        });
        return;
      }
      const rows = await reportsService.getEncounterReport(
        clinicId,
        actorId,
        parsed.data,
      );
      res.json(rows);
    } catch (err) {
      next(err);
    }
  },

  async getOutcomeDashboard(
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> {
    try {
      const clinicId = req.clinicId as string;
      const actorId = req.user!.id;
      const parsed = ReportFiltersSchema.safeParse(req.query);
      if (!parsed.success) {
        res.status(400).json({
          error: 'Invalid report filters',
          code: 'VALIDATION_ERROR',
          details: parsed.error.flatten(),
        });
        return;
      }
      const data = await reportsService.getOutcomeDashboard(
        clinicId,
        actorId,
        parsed.data,
      );
      res.json(data);
    } catch (err) {
      next(err);
    }
  },

  async generateReport(
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> {
    try {
      const clinicId = req.clinicId as string;
      const actorId = req.user!.id;
      const parsed = GenerateReportSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({
          error: 'Invalid report generation payload',
          code: 'VALIDATION_ERROR',
          details: parsed.error.flatten(),
        });
        return;
      }
      const summary = await reportsService.generateReport(
        clinicId,
        actorId,
        parsed.data,
      );
      res.status(201).json(summary);
    } catch (err) {
      next(err);
    }
  },

  async downloadReport(
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> {
    try {
      const clinicId = req.clinicId as string;
      const { id } = req.params;
      const format = req.query.format === 'pdf' ? 'pdf' : 'csv';
      const result = await reportsService.downloadReport(clinicId, id, format);
      res.set('Content-Type', result.mimeType);
      res.set(
        'Content-Disposition',
        `attachment; filename="${result.filename}"`,
      );
      res.send(result.data);
    } catch (err) {
      const code = (err as { code?: string })?.code;
      if (code === 'NOT_FOUND') {
        res
          .status(404)
          .json({ error: 'Report not found', code: 'NOT_FOUND' });
        return;
      }
      next(err);
    }
  },

  async getCliniciansForFilter(
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> {
    try {
      const clinicId = req.clinicId as string;
      const clinicians =
        await reportsService.getCliniciansForFilter(clinicId);
      res.json(clinicians);
    } catch (err) {
      next(err);
    }
  },
};