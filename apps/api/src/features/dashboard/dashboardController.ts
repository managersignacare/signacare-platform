// apps/api/src/features/dashboard/dashboardController.ts
import type { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import {
  DashboardMetricsResponseSchema,
  DashboardPreferencesResponseSchema,
  TeamDashboardScopesSchema,
  type DashboardPreferencesUpdate,
} from '@signacare/shared';
import * as service from './dashboardService';
import { buildAuthContext } from '../../shared/buildAuthContext';
import { buildDashboardDiscoveryPayload, resolveDashboardSurfaceForRole } from './dashboardRouteAliases';

const TeamDashboardScopesResponseSchema = z.object({
  data: TeamDashboardScopesSchema,
});

const DashboardDiscoveryResponseSchema = z.object({
  role: z.enum(['clinician', 'manager']),
  defaultRoute: z.string().min(1),
  routes: z.array(z.string().min(1)),
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

export async function getDashboardPreferences(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const auth = buildAuthContext(req);
    const data = await service.getDashboardPreferences(auth);
    res.json(DashboardPreferencesResponseSchema.parse(data));
  } catch (err) {
    next(err);
  }
}

export async function getResolvedDashboard(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  const resolvedSurface = resolveDashboardSurfaceForRole(req.user?.role);
  if (resolvedSurface === 'manager') {
    await getManagerDashboard(req, res, next);
    return;
  }
  await getClinicianDashboard(req, res, next);
}

export async function getDashboardRouteDiscovery(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    res.json(
      DashboardDiscoveryResponseSchema.parse(
        buildDashboardDiscoveryPayload(req.user?.role),
      ),
    );
  } catch (err) {
    next(err);
  }
}

export async function updateDashboardPreferences(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const auth = buildAuthContext(req);
    const data = await service.updateDashboardPreferences(
      auth,
      req.body as DashboardPreferencesUpdate,
    );
    res.json(DashboardPreferencesResponseSchema.parse(data));
  } catch (err) {
    next(err);
  }
}
