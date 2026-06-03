import { Router } from 'express';
import type { AuthContext } from '@signacare/shared';
import { z } from 'zod';
import {
  AdminReportDetailsQuerySchema,
  AdminReportDetailsResponseSchema,
  AdminReportExportQuerySchema,
  AdminReportFiltersSchema,
  AdminReportMetadataResponseSchema,
  AdminReportOverviewResponseSchema,
  AdminReportTrendsQuerySchema,
  AdminReportTrendsResponseSchema,
} from '@signacare/shared';
import { requireRoles } from '../../middleware/rbacMiddleware';
import { CASE_MANAGER_ROLES, CLINICAL_ROLES } from '../../shared/roleGroups';
import { buildAuthContext } from '../../shared/buildAuthContext';
import { AppError } from '../../shared/errors';
import { db } from '../../db/db';
import {
  getAssignedTeamIdsForStaff,
  hasClinicWideLeadershipAccess,
} from '../dashboard/dashboardRepository';
import {
  buildCsv,
  buildPdfText,
  getAdminReportDetails,
  getAdminReportOverview,
  getAdminReportTrends,
  metricsMetadata,
  parseMetricsCsv,
  resolveAdminReportContext,
} from './adminReportsDomain';
import { reportsService } from './reportsService';

const router = Router();

const ADMIN_REPORT_ROLES = Array.from(
  new Set([
    ...CLINICAL_ROLES,
    ...CASE_MANAGER_ROLES,
    'manager',
    'admin',
    'superadmin',
  ]),
);

const MANAGER_REPORT_ROLES = new Set(['manager', 'admin', 'superadmin']);

router.use(requireRoles(ADMIN_REPORT_ROLES));

function normalizeRole(role: string | undefined): string {
  return (role ?? '').trim().toLowerCase();
}

async function ensureClinicianInClinic(
  clinicId: string,
  clinicianId: string,
): Promise<void> {
  const clinicians = await reportsService.getCliniciansForFilter(clinicId);
  const clinician = clinicians.find((entry) => entry.id === clinicianId);
  if (!clinician) {
    throw new AppError('Selected clinician not found in this clinic', 404, 'NOT_FOUND');
  }
}

async function applyScopePolicy(
  auth: AuthContext,
  filters: z.infer<typeof AdminReportFiltersSchema>,
): Promise<z.infer<typeof AdminReportFiltersSchema>> {
  const scoped = { ...filters };
  const isManager = MANAGER_REPORT_ROLES.has(normalizeRole(auth.role))
    || await hasClinicWideLeadershipAccess(auth.clinicId, auth.staffId);

  if (scoped.clinicianId) {
    await ensureClinicianInClinic(auth.clinicId, scoped.clinicianId);
  }

  if (isManager) return scoped;

  if (scoped.clinicianId && scoped.clinicianId !== auth.staffId) {
    throw new AppError(
      'Clinicians may only run reports for their own clinician profile',
      403,
      'TEAM_SCOPE_FORBIDDEN',
    );
  }

  const assignedTeamIds = await getAssignedTeamIdsForStaff(auth.clinicId, auth.staffId);
  if (scoped.teamId && !assignedTeamIds.includes(scoped.teamId)) {
    throw new AppError(
      'You are not assigned to the selected team',
      403,
      'TEAM_SCOPE_FORBIDDEN',
    );
  }

  if (!scoped.teamId && !scoped.clinicianId) {
    scoped.clinicianId = auth.staffId;
  }

  return scoped;
}

function parseFiltersFromQuery(
  query: Record<string, unknown>,
): z.infer<typeof AdminReportFiltersSchema> {
  const parsed = AdminReportFiltersSchema.safeParse(query);
  if (!parsed.success) {
    throw new AppError('Invalid admin report filters', 400, 'VALIDATION_ERROR', parsed.error.flatten());
  }
  return parsed.data;
}

router.get('/metadata', async (req, res, next) => {
  try {
    const auth = buildAuthContext(req);
    const teams = await db('org_units')
      .where({ clinic_id: auth.clinicId, is_active: true })
      .select('id', 'name')
      .orderBy('name', 'asc');

    const clinicians = await reportsService.getCliniciansForFilter(auth.clinicId);

    res.json(AdminReportMetadataResponseSchema.parse({
      metrics: metricsMetadata(),
      teams: teams.map((team) => ({ id: team.id as string, name: team.name as string })),
      clinicians: clinicians.map((clinician) => ({
        id: clinician.id,
        fullName: clinician.fullName || 'Unnamed clinician',
      })),
    }));
  } catch (err) {
    next(err);
  }
});

router.get('/overview', async (req, res, next) => {
  try {
    const auth = buildAuthContext(req);
    const filters = await applyScopePolicy(auth, parseFiltersFromQuery(req.query as Record<string, unknown>));
    const context = await resolveAdminReportContext(auth.clinicId, filters);
    const cards = await getAdminReportOverview(context);

    res.json(AdminReportOverviewResponseSchema.parse({
      filters,
      resolvedFrom: context.from.toISOString().slice(0, 10),
      resolvedTo: context.to.toISOString().slice(0, 10),
      generatedAt: new Date().toISOString(),
      cards,
    }));
  } catch (err) {
    next(err);
  }
});

router.get('/details', async (req, res, next) => {
  try {
    const parsed = AdminReportDetailsQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      throw new AppError('Invalid admin report details query', 400, 'VALIDATION_ERROR', parsed.error.flatten());
    }

    const auth = buildAuthContext(req);
    const filters = await applyScopePolicy(auth, parsed.data);
    const context = await resolveAdminReportContext(auth.clinicId, filters);
    const details = await getAdminReportDetails(context, parsed.data.metricKey, parsed.data.limit);

    res.json(AdminReportDetailsResponseSchema.parse({
      metricKey: parsed.data.metricKey,
      metricLabel: details.metricLabel,
      total: details.total,
      rows: details.rows,
    }));
  } catch (err) {
    next(err);
  }
});

router.get('/trends', async (req, res, next) => {
  try {
    const parsed = AdminReportTrendsQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      throw new AppError('Invalid admin report trends query', 400, 'VALIDATION_ERROR', parsed.error.flatten());
    }

    const auth = buildAuthContext(req);
    const filters = await applyScopePolicy(auth, parsed.data);
    const context = await resolveAdminReportContext(auth.clinicId, filters);
    const metrics = parseMetricsCsv(parsed.data.metrics);
    const series = await getAdminReportTrends(context, metrics, parsed.data.granularity);

    res.json(AdminReportTrendsResponseSchema.parse({
      filters,
      granularity: parsed.data.granularity,
      generatedAt: new Date().toISOString(),
      series,
    }));
  } catch (err) {
    next(err);
  }
});

router.get('/export', async (req, res, next) => {
  try {
    const parsed = AdminReportExportQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      throw new AppError('Invalid admin report export query', 400, 'VALIDATION_ERROR', parsed.error.flatten());
    }

    const auth = buildAuthContext(req);
    const filters = await applyScopePolicy(auth, parsed.data);
    const context = await resolveAdminReportContext(auth.clinicId, filters);

    let rows: Array<Record<string, unknown>> = [];
    let title = 'Admin report';

    if (parsed.data.view === 'overview') {
      const cards = await getAdminReportOverview(context);
      title = 'Admin report overview';
      rows = cards.map((card) => ({
        metric_key: card.key,
        metric_label: card.label,
        group: card.group,
        count: card.count,
      }));
    } else if (parsed.data.view === 'details') {
      if (!parsed.data.metricKey) {
        throw new AppError('metricKey is required for details export', 400, 'VALIDATION_ERROR');
      }
      const details = await getAdminReportDetails(context, parsed.data.metricKey, parsed.data.limit);
      title = `Admin report details: ${details.metricLabel}`;
      rows = details.rows.map((row) => ({
        ur_number: row.urNumber,
        patient_name: row.patientName,
        date_of_birth: row.dateOfBirth,
        team: row.team,
        clinician: row.clinician,
        ref_source: row.refSource,
        ref_date: row.refDate,
        urgency: row.urgency,
        status: row.status,
        due_date: row.dueDate,
        note: row.note,
      }));
    } else {
      const metrics = parseMetricsCsv(parsed.data.metrics);
      const trends = await getAdminReportTrends(context, metrics, parsed.data.granularity);
      title = 'Admin report trends';
      rows = trends.flatMap((trend) =>
        trend.points.map((point) => ({
          metric_key: trend.metricKey,
          metric_label: trend.metricLabel,
          bucket_start: point.bucketStart,
          bucket_end: point.bucketEnd,
          count: point.count,
        })),
      );
    }

    if (parsed.data.format === 'pdf') {
      const content = buildPdfText(title, rows);
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `attachment; filename="admin-report-${parsed.data.view}.pdf"`);
      res.send(Buffer.from(content, 'utf-8'));
      return;
    }

    const content = buildCsv(rows);
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="admin-report-${parsed.data.view}.csv"`);
    res.send(content);
  } catch (err) {
    next(err);
  }
});

export default router;
