// apps/api/src/features/dashboard/dashboardService.ts
import {
  type AuthContext,
  type ClinicianDashboard,
  DASHBOARD_CARD_CATALOG,
  DEFAULT_DASHBOARD_PREFERENCES,
  DashboardPreferencesResponseSchema,
  DashboardPreferencesUpdateSchema,
  type ManagerDashboard,
  type OvernightAlert,
  type StaffActivityMetric,
  TeamDashboardSchema,
  type TeamDashboard,
  TeamDashboardScopesSchema,
  type TeamDashboardScopes,
  type TeamDashboardScopeType,
  normalizeDashboardPreferences,
} from '@signacare/shared';
import * as repo from './dashboardRepository';
import * as preferencesRepo from './dashboardPreferencesRepository';
import { cachedQuery } from '../../utils/queryCache';
import { AppError } from '../../shared/errors';

// ── Clinician ─────────────────────────────────────────────────────────────────

function periodBounds(period: string): { from: Date; to: Date } {
  const now = new Date();
  const to = now;
  let from: Date;
  switch (period) {
    case 'today':
      from = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      break;
    case 'week': {
      const day = now.getDay();
      from = new Date(now.getFullYear(), now.getMonth(), now.getDate() - (day === 0 ? 6 : day - 1));
      break;
    }
    case 'quarter':
      from = new Date(now.getFullYear(), Math.floor(now.getMonth() / 3) * 3, 1);
      break;
    case 'month':
    default:
      from = new Date(now.getFullYear(), now.getMonth(), 1);
      break;
  }
  return { from, to };
}

function periodWindowDays(period: string): number {
  switch (period) {
    case 'today':
      return 1;
    case 'week':
      return 7;
    case 'month':
      return 30;
    case 'quarter':
      return 90;
    default:
      return 14;
  }
}

const TEAM_DASHBOARD_MANAGER_ROLES = new Set([
  'manager',
  'admin',
  'superadmin',
]);

function normalizeRole(role: string | undefined): string {
  return (role ?? '').trim().toLowerCase();
}

function collectDescendants(
  rootId: string,
  childMap: Map<string, string[]>,
): string[] {
  const visited = new Set<string>();
  const queue = [rootId];
  while (queue.length > 0) {
    const current = queue.shift();
    if (!current || visited.has(current)) continue;
    visited.add(current);
    const children = childMap.get(current) ?? [];
    for (const childId of children) {
      if (!visited.has(childId)) queue.push(childId);
    }
  }
  return [...visited];
}

async function loadTeamScopeContext(
  clinicId: string,
  staffId: string,
  role: string,
): Promise<{
  normalizedRole: string;
  isManagerRole: boolean;
  allTeams: Array<{ id: string; name: string; parent_id: string | null }>;
  programTeams: Array<{
    program_id: string;
    program_name: string;
    team_id: string;
  }>;
  accessibleTeamIds: string[];
  teamIdToName: Map<string, string>;
  childMap: Map<string, string[]>;
}> {
  const normalizedRole = normalizeRole(role);
  const hasClinicWideLeadershipAccess = await repo.hasClinicWideLeadershipAccess(
    clinicId,
    staffId,
  );
  const isManagerRole = TEAM_DASHBOARD_MANAGER_ROLES.has(normalizedRole)
    || hasClinicWideLeadershipAccess;

  const allTeams = await repo.getOrgTeams(clinicId);
  const allTeamIds = new Set(allTeams.map((t) => t.id));
  const teamIdToName = new Map(allTeams.map((t) => [t.id, t.name]));

  const childMap = new Map<string, string[]>();
  for (const team of allTeams) {
    if (!team.parent_id) continue;
    const list = childMap.get(team.parent_id) ?? [];
    list.push(team.id);
    childMap.set(team.parent_id, list);
  }

  const programTeams = await repo.getProgramTeams(clinicId);

  const accessibleTeamIds = isManagerRole
    ? allTeams.map((t) => t.id)
    : (await repo.getAssignedTeamIdsForStaff(clinicId, staffId))
      .filter((id) => allTeamIds.has(id));

  return {
    normalizedRole,
    isManagerRole,
    allTeams,
    programTeams,
    accessibleTeamIds,
    teamIdToName,
    childMap,
  };
}

export async function getClinicianDashboard(
  clinicId: string,
  clinicianId: string,
  period: string = 'week',
  team?: string,
): Promise<ClinicianDashboard> {
  // period and team are accepted for cache-busting on the frontend query key
  // The repo functions already use appropriate date logic internally
  // (today's appointments, 12h escalations, 24h pathology, etc.)
  void period; void team;

  // BUG-722: request-scoped RLS uses one transaction connection; run
  // query flow sequentially to avoid pg concurrent-query deprecation.
  const apptRows = await repo.getTodaysAppointments(clinicId, clinicianId);
  const escalationRows = await repo.getOvernightEscalations(clinicId);
  const riskRows = await repo.getOvernightHighRiskAssessments(clinicId);
  const newPathology = await repo.countNewPathologyResults(clinicId, clinicianId);
  const overduePathology = await repo.countOverduePathologyResults(clinicId, clinicianId);
  const newReferrals = await repo.countNewReferrals(clinicId, clinicianId);
  const openTasks = await repo.countOpenTasks(clinicId, clinicianId);
  const unreadMessages = await repo.countUnreadMessages(clinicId, clinicianId);

  const todaysAppointments = apptRows.map((r) => ({
    id: r.id,
    patientId: r.patient_id,
    patientDisplayName: `${r.given_name} ${r.family_name.charAt(0)}.`,
    startTime: new Date(r.start_time).toISOString(),
    endTime: new Date(r.end_time).toISOString(),
    status: r.status,
    type: r.type,
    telehealthLink: r.telehealth_link,
  }));

  const overnightAlerts: OvernightAlert[] = [
    ...escalationRows.map((r) => ({
      id: r.id,
      type: 'escalation' as const,
      patientId: r.patient_id,
      patientDisplayName: `${r.given_name} ${r.family_name.charAt(0)}.`,
      summary: `${r.type} escalation – status: ${r.status}`,
      severity: 'high' as const,
      occurredAt: new Date(r.created_at).toISOString(),
      referenceId: r.id,
    })),
    ...riskRows.map((r) => ({
      id: r.id,
      type: 'risk_assessment' as const,
      patientId: r.patient_id,
      patientDisplayName: `${r.given_name} ${r.family_name.charAt(0)}.`,
      summary: `Risk level: ${r.overall_risk_level}`,
      severity:
        r.overall_risk_level === 'very_high'
          ? ('critical' as const)
          : ('high' as const),
      occurredAt: new Date(r.created_at).toISOString(),
      referenceId: r.id,
    })),
  ].sort((a, b) => (a.occurredAt < b.occurredAt ? 1 : -1));

  return {
    todaysAppointments,
    overnightAlerts,
    newPathologyResults: newPathology,
    overduePathologyResults: overduePathology,
    newReferrals,
    openTasks,
    unreadMessages,
    generatedAt: new Date().toISOString(),
  };
}

// ── Manager ───────────────────────────────────────────────────────────────────

export async function getManagerDashboard(
  clinicId: string,
  period: string = 'month',
  _team?: string,
): Promise<ManagerDashboard> {
  const { from, to } = periodBounds(period);

  const cacheKey = `manager:${clinicId}:${period}:${_team ?? 'all'}`;
  const [slaRow, missedRow, staffRows, billingRow] = await cachedQuery(
    cacheKey, 30, // 30 second cache — fresh enough for dashboards
    async () => {
      const referralSla = await repo.getReferralSlaSummary(clinicId, from, to);
      const missedAppointments = await repo.getMissedAppointmentCounts(clinicId, from, to);
      const staffActivity = await repo.getStaffActivityMetrics(clinicId, from, to);
      const billing = await repo.getBillingKpis(clinicId, from, to);
      return [referralSla, missedAppointments, staffActivity, billing] as const;
    },
  );

  const total = parseInt(slaRow.total ?? '0', 10);
  const withinSla = parseInt(slaRow.within_sla ?? '0', 10);
  const referralSla = {
    total,
    withinSla,
    breached: total - withinSla,
    slaBreachRate: total > 0 ? (total - withinSla) / total : 0,
    avgDaysToFirstContact: slaRow.avg_days
      ? parseFloat(slaRow.avg_days)
      : null,
  };

  const apptTotal = parseInt(missedRow.total ?? '0', 10);
  const apptMissed = parseInt(missedRow.missed ?? '0', 10);

  const mapStaff = (r: (typeof staffRows)[0]): StaffActivityMetric => ({
    userId: r.user_id,
    displayName: `${r.first_name} ${r.last_name}`,
    completedAppointments: parseInt(r.completed_appointments, 10),
    signedNotes: parseInt(r.signed_notes, 10),
    overdueTasks: parseInt(r.overdue_tasks, 10),
    lastActiveAt: r.last_active_at
      ? new Date(r.last_active_at).toISOString()
      : null,
  });

  const totalInvoiced = parseFloat(billingRow.total_invoiced ?? '0');
  const totalCollected = parseFloat(billingRow.total_collected ?? '0');
  const invoiceCount = parseInt(billingRow.invoice_count ?? '0', 10);
  const bulkBillCount = parseInt(billingRow.bulk_bill_count ?? '0', 10);

  return {
    referralSla,
    missedAppointmentRate: apptTotal > 0 ? apptMissed / apptTotal : 0,
    totalAppointmentsThisMonth: apptTotal,
    overdueTasksByStaff: staffRows
      .filter((r) => parseInt(r.overdue_tasks, 10) > 0)
      .map(mapStaff),
    staffActivity: staffRows.map(mapStaff),
    billingKpis: {
      totalInvoiced,
      totalCollected,
      outstandingAmount: Math.max(0, totalInvoiced - totalCollected),
      collectionRate:
        totalInvoiced > 0 ? totalCollected / totalInvoiced : 0,
      bulkBillRate: invoiceCount > 0 ? bulkBillCount / invoiceCount : 0,
      invoiceCount,
    },
    generatedAt: new Date().toISOString(),
  };
}

export async function getDashboardPreferences(
  auth: AuthContext,
) {
  const saved = await preferencesRepo.getDashboardPreferencesSetting(
    auth.staffId,
    auth.clinicId,
  );

  return DashboardPreferencesResponseSchema.parse({
    preferences: normalizeDashboardPreferences(
      saved ?? DEFAULT_DASHBOARD_PREFERENCES,
    ),
    catalog: DASHBOARD_CARD_CATALOG,
  });
}

export async function updateDashboardPreferences(
  auth: AuthContext,
  patch: unknown,
) {
  const current = normalizeDashboardPreferences(
    (await preferencesRepo.getDashboardPreferencesSetting(
      auth.staffId,
      auth.clinicId,
    )) ?? DEFAULT_DASHBOARD_PREFERENCES,
  );
  const nextPatch = DashboardPreferencesUpdateSchema.parse(patch);
  const merged = normalizeDashboardPreferences({
    ...current,
    ...nextPatch,
    viewPreferences: nextPatch.viewPreferences
      ? { ...current.viewPreferences, ...nextPatch.viewPreferences }
      : current.viewPreferences,
  });

  await preferencesRepo.setDashboardPreferencesSetting(
    auth.staffId,
    auth.clinicId,
    merged,
  );

  return DashboardPreferencesResponseSchema.parse({
    preferences: merged,
    catalog: DASHBOARD_CARD_CATALOG,
  });
}

export async function getTeamDashboardScopes(
  auth: AuthContext,
): Promise<TeamDashboardScopes> {
  const {
    isManagerRole,
    allTeams,
    programTeams,
    accessibleTeamIds,
    childMap,
  } = await loadTeamScopeContext(auth.clinicId, auth.staffId, auth.role);

  const accessibleSet = new Set(accessibleTeamIds);
  const teams = allTeams
    .filter((t) => accessibleSet.has(t.id))
    .map((t) => ({
      scopeType: 'team' as const,
      scopeId: t.id,
      label: t.name,
      memberTeams: [t.id],
    }));

  const parentTeams = isManagerRole
    ? allTeams
      .filter((t) => (childMap.get(t.id) ?? []).length > 0)
      .map((t) => ({
        scopeType: 'parent_team' as const,
        scopeId: t.id,
        label: t.name,
        memberTeams: collectDescendants(t.id, childMap),
      }))
    : [];

  const programsById = new Map<string, { label: string; teamIds: Set<string> }>();
  for (const row of programTeams) {
    if (!accessibleSet.has(row.team_id)) continue;
    const existing = programsById.get(row.program_id);
    if (existing) {
      existing.teamIds.add(row.team_id);
      continue;
    }
    programsById.set(row.program_id, {
      label: row.program_name,
      teamIds: new Set([row.team_id]),
    });
  }

  const programs = [...programsById.entries()].map(([programId, entry]) => ({
    scopeType: 'program' as const,
    scopeId: programId,
    label: entry.label,
    memberTeams: [...entry.teamIds],
  }));

  return TeamDashboardScopesSchema.parse({
    teams,
    parentTeams,
    programs,
    canViewClinic: isManagerRole,
  });
}

export async function getTeamDashboard(
  auth: AuthContext,
  period: string,
  scopeTypeInput?: string,
  scopeId?: string,
): Promise<TeamDashboard> {
  const {
    isManagerRole,
    allTeams,
    programTeams,
    accessibleTeamIds,
    teamIdToName,
    childMap,
  } = await loadTeamScopeContext(auth.clinicId, auth.staffId, auth.role);

  const accessibleSet = new Set(accessibleTeamIds);
  const allTeamSet = new Set(allTeams.map((t) => t.id));

  if (!isManagerRole && accessibleTeamIds.length === 0) {
    throw new AppError(
      'No active team assignment found for your account.',
      403,
      'TEAM_SCOPE_FORBIDDEN',
    );
  }

  const requestedScopeType = (scopeTypeInput ?? '').trim().toLowerCase();
  const scopeType: TeamDashboardScopeType = (
    requestedScopeType === 'team'
    || requestedScopeType === 'parent_team'
    || requestedScopeType === 'program'
    || requestedScopeType === 'clinic'
      ? requestedScopeType
      : isManagerRole ? 'clinic' : 'team'
  );

  if (!isManagerRole && scopeType !== 'team') {
    throw new AppError(
      'Clinicians can only view dashboards for assigned teams.',
      403,
      'TEAM_SCOPE_FORBIDDEN',
    );
  }

  let resolvedTeamIds: string[] = [];
  let scopeLabel = '';
  let resolvedScopeId: string | null = null;

  if (scopeType === 'clinic') {
    if (!isManagerRole) {
      throw new AppError('Clinic-wide view requires manager access.', 403, 'TEAM_SCOPE_FORBIDDEN');
    }
    resolvedTeamIds = allTeams.map((t) => t.id);
    scopeLabel = 'Clinic-wide';
    resolvedScopeId = null;
  }

  if (scopeType === 'team') {
    const selectedTeamId = scopeId ?? accessibleTeamIds[0];
    if (!selectedTeamId || !allTeamSet.has(selectedTeamId)) {
      throw new AppError('Team not found in this clinic.', 404, 'NOT_FOUND');
    }
    if (!isManagerRole && !accessibleSet.has(selectedTeamId)) {
      throw new AppError(
        'You are not assigned to this team.',
        403,
        'TEAM_SCOPE_FORBIDDEN',
      );
    }
    resolvedTeamIds = [selectedTeamId];
    scopeLabel = teamIdToName.get(selectedTeamId) ?? 'Team';
    resolvedScopeId = selectedTeamId;
  }

  if (scopeType === 'parent_team') {
    if (!isManagerRole) {
      throw new AppError('Parent team view requires manager access.', 403, 'TEAM_SCOPE_FORBIDDEN');
    }
    if (!scopeId || !allTeamSet.has(scopeId)) {
      throw new AppError('Parent team not found in this clinic.', 404, 'NOT_FOUND');
    }
    resolvedTeamIds = collectDescendants(scopeId, childMap);
    scopeLabel = `${teamIdToName.get(scopeId) ?? 'Team'} (Consolidated)`;
    resolvedScopeId = scopeId;
  }

  if (scopeType === 'program') {
    if (!isManagerRole) {
      throw new AppError('Program view requires manager access.', 403, 'TEAM_SCOPE_FORBIDDEN');
    }
    if (!scopeId) {
      throw new AppError('Program id is required.', 400, 'VALIDATION_ERROR');
    }
    const programRows = programTeams.filter((row) => row.program_id === scopeId);
    if (programRows.length === 0) {
      throw new AppError('Program not found for this clinic.', 404, 'NOT_FOUND');
    }
    const teamSet = new Set<string>();
    for (const row of programRows) {
      for (const teamId of collectDescendants(row.team_id, childMap)) {
        if (allTeamSet.has(teamId)) teamSet.add(teamId);
      }
    }
    resolvedTeamIds = [...teamSet];
    scopeLabel = `${programRows[0]?.program_name ?? 'Program'} (Consolidated)`;
    resolvedScopeId = scopeId;
  }

  const uniqueTeamIds = [...new Set(resolvedTeamIds)].filter((id) => allTeamSet.has(id));
  const teamStaffIds = await repo.getTeamStaffIds(auth.clinicId, uniqueTeamIds);
  const windowDays = periodWindowDays(period);

  const activePatients = await repo.countTeamActivePatients(auth.clinicId, uniqueTeamIds);
  const openEpisodes = await repo.countTeamOpenEpisodes(auth.clinicId, uniqueTeamIds);
  const todaysAppointments = await repo.countTeamTodaysAppointments(auth.clinicId, uniqueTeamIds);
  const didNotAttendAppointments = await repo.countTeamDidNotAttendAppointments(
    auth.clinicId,
    uniqueTeamIds,
    windowDays,
  );
  const overdueLai = await repo.countTeamLaiOverdue(auth.clinicId, uniqueTeamIds);
  const upcomingLai = await repo.countTeamLaiUpcoming(auth.clinicId, uniqueTeamIds, windowDays);
  const overdueMha = await repo.countTeamMhaOverdue(auth.clinicId, uniqueTeamIds);
  const upcomingMha = await repo.countTeamMhaUpcoming(auth.clinicId, uniqueTeamIds, windowDays);
  const overdueReviews91d = await repo.countTeamOverdueReviews(auth.clinicId, uniqueTeamIds);
  const upcomingReviews91d = await repo.countTeamUpcomingReviews(auth.clinicId, uniqueTeamIds, windowDays);
  const urgentAlerts = await repo.countTeamUrgentAlerts(auth.clinicId, uniqueTeamIds);
  const openTasks = await repo.countTeamOpenTasks(auth.clinicId, uniqueTeamIds, teamStaffIds);
  const unreadMessages = await repo.countTeamUnreadMessages(auth.clinicId, teamStaffIds);
  const newReferrals = await repo.countTeamNewReferrals(auth.clinicId, teamStaffIds);

  const teamBreakdownRows = await repo.getTeamBreakdown(auth.clinicId, uniqueTeamIds);
  const clinicianBreakdownRows = await repo.getTeamClinicianBreakdown(auth.clinicId, uniqueTeamIds);

  return TeamDashboardSchema.parse({
    scope: {
      scopeType,
      scopeId: resolvedScopeId,
      scopeLabel,
    },
    totals: {
      activePatients,
      openEpisodes,
      todaysAppointments,
      didNotAttendAppointments,
      overdueLai,
      upcomingLai,
      overdueMha,
      upcomingMha,
      overdueReviews91d,
      upcomingReviews91d,
      openTasks,
      unreadMessages,
      newReferrals,
      urgentAlerts,
    },
    teamBreakdown: teamBreakdownRows.map((row) => ({
      teamId: row.team_id,
      teamName: row.team_name,
      openEpisodes: Number.parseInt(row.open_episodes, 10) || 0,
      activePatients: Number.parseInt(row.active_patients, 10) || 0,
    })),
    clinicianBreakdown: clinicianBreakdownRows.map((row) => ({
      staffId: row.staff_id,
      displayName: row.display_name,
      teamId: row.team_id,
      teamName: row.team_name,
      openEpisodes: Number.parseInt(row.open_episodes, 10) || 0,
      activePatients: Number.parseInt(row.active_patients, 10) || 0,
    })),
    generatedAt: new Date().toISOString(),
  });
}
