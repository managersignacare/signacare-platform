// apps/api/src/features/dashboard/dashboardController.ts
import type { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import {
  DashboardMetricsResponseSchema,
  TeamDashboardScopesSchema,
} from '@signacare/shared';
import * as service from './dashboardService';
import { buildAuthContext } from '../../shared/buildAuthContext';

const TeamDashboardScopesResponseSchema = z.object({
  data: TeamDashboardScopesSchema,
});

export async function getClinicianDashboard(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const clinicId = req.clinicId;
    const userId = req.user!.id;
    const period = (req.query.period as string) || 'week';
    const team = (req.query.team as string) || undefined;
    const data = await service.getClinicianDashboard(clinicId, userId, period, team);
    res.json({ role: 'clinician', data });
  } catch (err) {
    next(err);
  }
}

export async function getManagerDashboard(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const clinicId = req.clinicId;
    const period = (req.query.period as string) || 'month';
    const team = (req.query.team as string) || undefined;
    const data = await service.getManagerDashboard(clinicId, period, team);
    res.json({ role: 'manager', data });
  } catch (err) {
    next(err);
  }
}

export async function getTeamDashboard(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const auth = buildAuthContext(req);
    const period = (req.query.period as string) || 'week';
    const scopeType = (req.query.scopeType as string) || undefined;
    const scopeId = (req.query.scopeId as string) || undefined;

    const data = await service.getTeamDashboard(
      auth,
      period,
      scopeType,
      scopeId,
    );
    res.json(
      DashboardMetricsResponseSchema.parse({ role: 'team', data }),
    );
  } catch (err) {
    next(err);
  }
}

export async function getTeamDashboardScopes(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const auth = buildAuthContext(req);
    const data = await service.getTeamDashboardScopes(auth);
    res.json(TeamDashboardScopesResponseSchema.parse({ data }));
  } catch (err) {
    next(err);
  }
}
