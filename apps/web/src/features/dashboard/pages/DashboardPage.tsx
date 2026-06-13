import AssignmentIcon from '@mui/icons-material/Assignment';
import CalendarTodayIcon from '@mui/icons-material/CalendarToday';
import CloseFullscreenIcon from '@mui/icons-material/CloseFullscreen';
import CloseIcon from '@mui/icons-material/Close';
import EventBusyIcon from '@mui/icons-material/EventBusy';
import LocalHospitalIcon from '@mui/icons-material/LocalHospital';
import MedicationIcon from '@mui/icons-material/Medication';
import MonitorHeartIcon from '@mui/icons-material/MonitorHeart';
import OpenInFullIcon from '@mui/icons-material/OpenInFull';
import PeopleIcon from '@mui/icons-material/People';
import PersonAddIcon from '@mui/icons-material/PersonAdd';
import RefreshIcon from '@mui/icons-material/Refresh';
import SwapHorizIcon from '@mui/icons-material/SwapHoriz';
import TrendingUpIcon from '@mui/icons-material/TrendingUp';
import WarningAmberIcon from '@mui/icons-material/WarningAmber';
import {
    Alert, Box, Button, Chip, FormControl, FormControlLabel,
    Grid, IconButton, InputLabel, LinearProgress, MenuItem,
    Paper, Select, Switch, Tooltip, Typography
} from '@mui/material';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { OPEN_TASK_STATUSES } from '@signacare/shared';
import { apiClient, SignacareApiError } from '../../../shared/services/apiClient';
import { useAuthStore } from '../../../shared/store/authStore';
import { useOrgTree } from '../../org-settings/hooks/useOrgSettings';
import type { OrgUnit } from '../../org-settings/services/orgSettingsApi';
import {
  useClinicianMetrics,
  useManagerMetrics,
  useTeamDashboardMetrics,
  useTeamDashboardScopes,
} from '../hooks/useDashboardMetrics';
import { dashboardKeys } from '../queryKeys';
import {
  BillingCard,
  EmptyState,
  HandoverSummaryCard,
  MiniList,
  RagChip,
  ServiceStats,
  StatRow,
} from './DashboardViewBits';
import {
  type CaseloadRow,
  type ClinicalAlertsResponse,
  type ContactsKpiRow,
  type DashboardAppointmentRow,
  type DnaRateRow,
  type PhoneTriageRow,
  type StaffCaseloadRow,
  type TeamDashboardDataRow,
  type TeamDashboardScopesRow,
  type WorkloadData,
  resolveOpenTaskTileCount,
  readArray,
} from './dashboardPageSupport';
import { getDashboardViewsForRole } from './dashboardRoleViews';

// Shape B trio helper (BUG-447 child 11/15): local keyboard-accessible click target factory.
function trio(label: string, action: () => void) {
  return {
    role: 'button' as const,
    tabIndex: 0,
    'aria-label': label,
    onClick: action,
    onKeyDown: (e: React.KeyboardEvent) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); action(); } },
  };
}

function flattenUnits(nodes: OrgUnit[]): { id: string; name: string }[] {
  const r: { id: string; name: string }[] = [];
  function w(l: OrgUnit[]) { for (const n of l) { r.push({ id: n.id, name: n.name }); if (n.children?.length) w(n.children); } }
  w(nodes); return r;
}

// Role definitions for the dashboard role switcher
const ROLE_LABELS: Record<string, { label: string; icon: React.ReactElement; color: string }> = {
  my_dashboard: { label: 'My Dashboard', icon: <PeopleIcon sx={{ fontSize: 16 }} />,        color: '#327C8D' },
  team_dashboard: { label: 'Team Dashboard', icon: <SwapHorizIcon sx={{ fontSize: 16 }} />, color: '#00695C' },
  clinician:    { label: 'Clinician',    icon: <LocalHospitalIcon sx={{ fontSize: 16 }} />,  color: '#327C8D' },
  nurse:        { label: 'Nursing',      icon: <MedicationIcon sx={{ fontSize: 16 }} />,     color: '#7B1FA2' },
  case_manager: { label: 'Case Mgmt',   icon: <AssignmentIcon sx={{ fontSize: 16 }} />,     color: '#2E7D32' },
  receptionist: { label: 'Reception',    icon: <PersonAddIcon sx={{ fontSize: 16 }} />,      color: '#b8621a' },
  manager:      { label: 'Manager',      icon: <TrendingUpIcon sx={{ fontSize: 16 }} />,     color: '#D32F2F' },
};

interface DashboardTaskRow {
  id: string;
  title: string;
  status: string;
  dueDate: string | null;
  patientId: string | null;
  patientName?: string | null;
  priority: string;
}

const OPEN_TASK_STATUS_SET: ReadonlySet<string> = new Set<string>(OPEN_TASK_STATUSES);

function isExpectedAccessError(error: unknown): boolean {
  if (!(error instanceof SignacareApiError)) return false;
  if (error.status !== 403) return false;
  return error.code === 'MODULE_READ_DENIED' || error.code === 'FORBIDDEN';
}

export default function DashboardPage(): React.ReactElement {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const user = useAuthStore((s) => s.user);
  const clinicScope = user?.clinicId ?? '';
  const role = user?.role ?? 'clinician';
  const normalizedRole = role.trim().toLowerCase();
  const name = user ? `${user.givenName} ${user.familyName}` : 'User';
  const availableRoles = useMemo(() => getDashboardViewsForRole(role), [role]);
  const clinicianViews = useMemo(() => new Set(['my_dashboard', 'clinician', 'nurse', 'case_manager']), []);
  const canReadMyClinic = useMemo(() => new Set(['clinician', 'psychiatrist', 'psychologist', 'nurse', 'case_manager', 'readonly', 'referral_coordinator', 'admin', 'superadmin']), []);
  const canReadTriage = useMemo(() => new Set(['receptionist', 'admin', 'superadmin']), []);

  const { data: tree } = useOrgTree();
  const flatUnits = useMemo(() => tree ? flattenUnits(tree) : [], [tree]);

  const [activeView, setActiveView] = useState(availableRoles[0]);
  const [period, setPeriod] = useState('week');
  const [teamFilter, setTeamFilter] = useState('');
  const [teamScopeType, setTeamScopeType] = useState<'team' | 'parent_team' | 'program' | 'clinic'>('team');
  const [teamScopeId, setTeamScopeId] = useState('');
  const [expandedCard, setExpandedCard] = useState<string | null>(null);
  const [hiddenCards, setHiddenCards] = useState<Set<string>>(new Set());
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [lastRefresh, setLastRefresh] = useState(new Date());
  const [_cardOrder, _setCardOrder] = useState<string[]>([]);
  const showClinicianMetrics = clinicianViews.has(activeView);
  const showTeamDashboard = activeView === 'team_dashboard';

  useEffect(() => {
    if (!availableRoles.includes(activeView)) {
      setActiveView(availableRoles[0]);
    }
  }, [activeView, availableRoles]);

  // Auto-refresh every 2 minutes
  useEffect(() => {
    if (!autoRefresh) return;
    const interval = setInterval(() => {
      qc.invalidateQueries({ queryKey: dashboardKeys.all(clinicScope) });
      qc.invalidateQueries({ queryKey: dashboardKeys.dashAll(clinicScope) });
      setLastRefresh(new Date());
    }, 120_000);
    return () => clearInterval(interval);
  }, [autoRefresh, clinicScope, qc]);

  const manualRefresh = () => {
    qc.invalidateQueries({ queryKey: dashboardKeys.all(clinicScope) });
    qc.invalidateQueries({ queryKey: dashboardKeys.dashAll(clinicScope) });
    setLastRefresh(new Date());
  };

  const renderSignalTiles = (
    tiles: Array<{ label: string; value: number; color: string; link?: string }>,
  ) => (
    <Box sx={{ display: 'flex', gap: 1.25, flexWrap: 'wrap' }}>
      {tiles.map((tile) => {
        const link = tile.link;
        const content = (
          <>
            <Typography variant="h5" fontWeight={800} sx={{ color: tile.color, lineHeight: 1 }}>
              {tile.value}
            </Typography>
            <Typography variant="caption" sx={{ display: 'block', mt: 0.25, color: 'text.secondary', fontSize: 10 }}>
              {tile.label}
            </Typography>
          </>
        );

        const baseSx = {
          flex: '1 1 120px',
          minWidth: 120,
          p: 1.25,
          textAlign: 'center',
          borderColor: `${tile.color}33`,
          bgcolor: `${tile.color}0d`,
        } as const;

        if (!link) {
          return (
            <Paper key={tile.label} variant="outlined" sx={baseSx}>
              {content}
            </Paper>
          );
        }

        return (
          <Paper
            key={tile.label}
            variant="outlined"
            component="button"
            type="button"
            onClick={() => navigate(link)}
            sx={{
              ...baseSx,
              cursor: 'pointer',
              border: '1px solid',
              transition: 'transform 120ms ease, box-shadow 120ms ease',
              '&:hover': { transform: 'translateY(-1px)', boxShadow: 1 },
              '&:focus-visible': { outline: '2px solid #327C8D', outlineOffset: 2 },
            }}
          >
            {content}
          </Paper>
        );
      })}
    </Box>
  );

  const filters = { period, team: teamFilter || undefined };
  const {
    data: clinicianData,
    isError: clinicianMetricsError,
    error: clinicianMetricsErrorObj,
  } = useClinicianMetrics(filters, showClinicianMetrics);
  const { data: managerData } = useManagerMetrics(filters);

  const {
    data: teamScopesRaw,
    isError: teamScopesError,
  } = useTeamDashboardScopes(showTeamDashboard);
  const teamScopes = teamScopesRaw as TeamDashboardScopesRow | undefined;

  const selectedTeamScope = useMemo(() => {
    if (!teamScopes) return null;
    if (teamScopeType === 'clinic') {
      return {
        scopeType: 'clinic' as const,
        scopeId: null,
        label: 'Clinic-wide',
        memberTeams: [],
      };
    }
    const pool = teamScopeType === 'team'
      ? teamScopes.teams
      : teamScopeType === 'parent_team'
        ? teamScopes.parentTeams
        : teamScopes.programs;
    return pool.find((s) => (s.scopeId ?? '') === teamScopeId) ?? null;
  }, [teamScopeId, teamScopeType, teamScopes]);

  const teamDashboardFilters = useMemo(() => ({
    period,
    scopeType: teamScopeType,
    scopeId: teamScopeType === 'clinic' ? undefined : (teamScopeId || undefined),
  }), [period, teamScopeId, teamScopeType]);

  const {
    data: teamDashboardRaw,
    isError: teamDashboardError,
  } = useTeamDashboardMetrics(
    teamDashboardFilters,
    showTeamDashboard && (teamScopeType === 'clinic' || !!teamScopeId),
  );
  const teamDashboard = teamDashboardRaw as TeamDashboardDataRow | undefined;

  useEffect(() => {
    if (!showTeamDashboard || !teamScopes) return;

    if (teamScopeType === 'clinic') {
      if (!teamScopes.canViewClinic) {
        setTeamScopeType('team');
      }
      return;
    }

    const options = teamScopeType === 'team'
      ? teamScopes.teams
      : teamScopeType === 'parent_team'
        ? teamScopes.parentTeams
        : teamScopes.programs;
    if (options.length === 0) {
      if (teamScopeType !== 'team') setTeamScopeType('team');
      return;
    }

    const hasSelected = options.some((option) => (option.scopeId ?? '') === teamScopeId);
    if (!hasSelected) {
      setTeamScopeId(options[0]?.scopeId ?? '');
    }
  }, [showTeamDashboard, teamScopes, teamScopeType, teamScopeId]);

  // Role-specific data
  const {
    data: caseloadData,
    isError: caseloadDataError,
    error: caseloadDataErrorObj,
  } = useQuery({
    queryKey: dashboardKeys.caseload(clinicScope),
    queryFn: () => apiClient.get<{ data?: CaseloadRow[] }>('dashboard/caseload'),
    enabled: (activeView === 'case_manager' || activeView === 'my_dashboard' || activeView === 'clinician') && canReadMyClinic.has(normalizedRole),
  });
  const { data: kpiData, isError: kpiDataError, error: kpiDataErrorObj } = useQuery({
    queryKey: dashboardKeys.contactsKpi(clinicScope, period),
    queryFn: () => apiClient.get<{ data?: ContactsKpiRow[] }>('reports/contacts-kpi', { period }),
    enabled: activeView === 'manager',
  });
  const { data: caseloadReport, isError: caseloadReportError, error: caseloadReportErrorObj } = useQuery({
    queryKey: dashboardKeys.staffCaseload(clinicScope),
    queryFn: () => apiClient.get<{ data?: StaffCaseloadRow[] }>('reports/staff-caseload'),
    enabled: activeView === 'manager',
  });
  const { data: dnaData, isError: dnaDataError, error: dnaDataErrorObj } = useQuery({
    queryKey: dashboardKeys.dnaRates(clinicScope),
    queryFn: () => apiClient.get<{ data?: DnaRateRow[] }>('reports/dna-rates'),
    enabled: activeView === 'manager',
  });
  const { data: workloadData, isError: workloadDataError, error: workloadDataErrorObj } = useQuery({
    queryKey: dashboardKeys.workloadAlerts(clinicScope),
    queryFn: () => apiClient.get<{ data?: WorkloadData }>('reports/workload-alerts'),
    enabled: activeView === 'manager',
  });
  const { data: triageData } = useQuery({
    queryKey: dashboardKeys.phoneTriage(clinicScope),
    queryFn: () => apiClient.get<{ data?: PhoneTriageRow[] }>('phone-triage', { status: 'open' }),
    enabled: activeView === 'receptionist' && canReadTriage.has(normalizedRole),
  });
  // Clinical alerts — overdue/upcoming
  const { data: alertsData, isError: alertsDataError, error: alertsDataErrorObj } = useQuery({
    queryKey: dashboardKeys.clinicalAlerts(clinicScope, teamFilter, period),
    queryFn: () => apiClient.get<ClinicalAlertsResponse>('reports/clinical-alerts', {
      teamId: teamFilter || undefined,
      daysAhead: period === 'week' ? 7 : period === 'month' ? 30 : 14,
      daysBack: period === 'week' ? 7 : period === 'month' ? 30 : 14,
    }),
    enabled: activeView !== 'receptionist',
  });
  const { data: todayAppts, isError: todayApptsError, error: todayApptsErrorObj } = useQuery({
    queryKey: dashboardKeys.todayAppts(clinicScope),
    queryFn: () => apiClient.get<DashboardAppointmentRow[] | { data?: DashboardAppointmentRow[]; appointments?: DashboardAppointmentRow[] }>('appointments', { date: new Date().toISOString().slice(0, 10) }),
    enabled: activeView === 'receptionist',
  });
  // My contacts (for personal dashboard)
  const { data: myAppointments, isError: myAppointmentsError, error: myAppointmentsErrorObj } = useQuery({
    queryKey: dashboardKeys.myAppts(clinicScope, period),
    queryFn: () =>
      apiClient
        .get<DashboardAppointmentRow[] | { data?: DashboardAppointmentRow[] }>('appointments', { clinicianId: user?.id })
        .then((r) => readArray<DashboardAppointmentRow>(r, ['data'])),
    enabled: activeView !== 'receptionist' && activeView !== 'manager',
    staleTime: 60_000,
  });
  const { data: myTasks, isError: myTasksError, error: myTasksErrorObj } = useQuery({
    queryKey: dashboardKeys.myTasks(clinicScope, user?.id),
    queryFn: () =>
      apiClient
        .get<DashboardTaskRow[] | { data?: DashboardTaskRow[]; tasks?: DashboardTaskRow[] }>(
          'tasks',
          { assignedToId: user?.id },
        )
        .then((payload) =>
          readArray<DashboardTaskRow>(payload, ['data', 'tasks']).filter((task) =>
            OPEN_TASK_STATUS_SET.has((task.status ?? '').toLowerCase()),
          ),
        ),
    enabled: activeView === 'my_dashboard' && !!user?.id,
    staleTime: 60_000,
  });

  // ── Build cards based on active role view ──
  const cards: { id: string; title: string; size: 'sm' | 'md' | 'lg'; icon: React.ReactNode; content: React.ReactNode }[] = [];

  if (activeView === 'my_dashboard') {
    const alertCounts: NonNullable<ClinicalAlertsResponse['counts']> = alertsData?.counts ?? {};
    const myPatientCount = caseloadData?.data?.length ?? 0;
    const unreadMessages = clinicianData?.unreadMessages ?? alertCounts.unreadMessages ?? 0;
    const upcomingAppointments = (myAppointments ?? [])
      .filter((a) => {
        const status = (a.status ?? '').toLowerCase();
        const isUpcoming = a.startTime ? new Date(a.startTime).getTime() >= Date.now() : false;
        return isUpcoming && (status === 'scheduled' || status === 'confirmed');
      })
      .sort((a, b) => (a.startTime ?? '').localeCompare(b.startTime ?? ''));
    const openTaskRows = (myTasks ?? [])
      .slice()
      .sort((a, b) => (a.dueDate ?? '9999-12-31').localeCompare(b.dueDate ?? '9999-12-31'));
    const openTaskCount = resolveOpenTaskTileCount({
      openTaskRowsCount: openTaskRows.length,
      clinicianOpenTasksCount: clinicianData?.openTasks,
      tasksQueryFailed: myTasksError,
    });

    cards.push({
      id: 'my-snapshot',
      title: `My Snapshot — ${user?.givenName ?? name}`,
      size: 'lg',
      icon: <LocalHospitalIcon sx={{ fontSize: 18, color: '#327C8D' }} />,
      content: renderSignalTiles([
        { label: 'My Patients', value: myPatientCount, color: '#327C8D', link: '/patients' },
        { label: 'Upcoming Appointments', value: upcomingAppointments.length, color: '#2E7D32', link: '/calendar' },
        { label: 'Open Tasks', value: openTaskCount, color: '#D32F2F', link: '/tasks' },
        { label: 'New Messages', value: unreadMessages, color: '#1565C0', link: '/messages' },
      ]),
    });

    cards.push({
      id: 'my-clinical-signals',
      title: 'Clinical Signals',
      size: 'lg',
      icon: <WarningAmberIcon sx={{ fontSize: 18, color: '#b8621a' }} />,
      content: renderSignalTiles([
        { label: 'Did Not Attend', value: alertCounts.missedAppointments ?? 0, color: '#D32F2F', link: '/calendar' },
        { label: 'Overdue LAI', value: alertCounts.laiOverdue ?? 0, color: '#D32F2F', link: '/list/lai' },
        { label: 'Upcoming LAI', value: alertCounts.laiUpcoming ?? 0, color: '#b8621a', link: '/list/lai' },
        { label: 'Overdue MHA', value: alertCounts.legalExpired ?? 0, color: '#D32F2F', link: '/list/mha' },
        { label: 'Upcoming MHA', value: alertCounts.legalExpiring ?? 0, color: '#b8621a', link: '/list/mha' },
        { label: 'Overdue 91d Review', value: alertCounts.review91dOverdue ?? 0, color: '#D32F2F', link: '/list/91day' },
        { label: 'Upcoming 91d Review', value: alertCounts.review91dUpcoming ?? 0, color: '#b8621a', link: '/list/91day' },
        { label: 'New Pathology', value: clinicianData?.newPathologyResults ?? 0, color: '#327C8D', link: '/pathology' },
        { label: 'Overdue Pathology', value: clinicianData?.overduePathologyResults ?? 0, color: '#D32F2F', link: '/pathology' },
      ]),
    });

    cards.push({
      id: 'my-upcoming-appointments',
      title: `Upcoming Appointments (${upcomingAppointments.length})`,
      size: 'md',
      icon: <CalendarTodayIcon sx={{ fontSize: 18, color: '#327C8D' }} />,
      content: upcomingAppointments.length > 0
        ? (
          <MiniList
            items={upcomingAppointments.slice(0, 10).map((appt) => ({
              primary: appt.patientDisplayName ?? appt.patientName ?? 'Patient',
              secondary: `${appt.startTime ? new Date(appt.startTime).toLocaleString('en-AU', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : ''} · ${appt.appointmentType ?? appt.type ?? 'Appointment'}`,
              chip: (appt.status ?? '').toLowerCase() === 'confirmed' ? 'Confirmed' : 'Scheduled',
              chipColor: '#2E7D32',
              link: appt.patientId ? `/patients/${appt.patientId}` : undefined,
            }))}
          />
        )
        : <EmptyState text="No upcoming appointments in selected period" />,
    });

    cards.push({
      id: 'my-task-list',
      title: `Task List (${openTaskRows.length})`,
      size: 'md',
      icon: <AssignmentIcon sx={{ fontSize: 18, color: '#D32F2F' }} />,
      content: openTaskRows.length > 0
        ? (
          <MiniList
            items={openTaskRows.slice(0, 10).map((task) => ({
              primary: task.title,
              secondary: `${task.dueDate ? `Due ${new Date(task.dueDate).toLocaleDateString('en-AU')}` : 'No due date'} · ${task.patientName ?? 'General task'}`,
              chip: task.priority,
              chipColor: task.priority === 'urgent' ? '#D32F2F' : task.priority === 'high' ? '#b8621a' : '#327C8D',
              link: '/tasks',
            }))}
          />
        )
        : <EmptyState text="No open tasks assigned to you" color="#2E7D32" />,
    });
  }

  if (activeView === 'clinician') {
    const alertCounts: NonNullable<ClinicalAlertsResponse['counts']> = alertsData?.counts ?? {};
    const unreadMessages = clinicianData?.unreadMessages ?? alertCounts.unreadMessages ?? 0;
    const overdueItems = alertsData?.overdue ?? [];
    const upcomingItems = alertsData?.upcoming ?? [];

    cards.push({
      id: 'clinician-signals', title: 'Clinician Signals', size: 'lg',
      icon: <TrendingUpIcon sx={{ fontSize: 18, color: '#327C8D' }} />,
      content: renderSignalTiles([
        { label: 'Did Not Attend', value: alertCounts.missedAppointments ?? 0, color: '#D32F2F', link: '/calendar' },
        { label: 'New Messages', value: unreadMessages, color: '#1565C0', link: '/messages' },
        { label: 'Overdue LAI', value: alertCounts.laiOverdue ?? 0, color: '#D32F2F', link: '/list/lai' },
        { label: 'Upcoming LAI', value: alertCounts.laiUpcoming ?? 0, color: '#b8621a', link: '/list/lai' },
        { label: 'Overdue MHA', value: alertCounts.legalExpired ?? 0, color: '#D32F2F', link: '/list/mha' },
        { label: 'Upcoming MHA', value: alertCounts.legalExpiring ?? 0, color: '#b8621a', link: '/list/mha' },
        { label: 'Overdue 91d Review', value: alertCounts.review91dOverdue ?? 0, color: '#D32F2F', link: '/list/91day' },
        { label: 'Upcoming 91d Review', value: alertCounts.review91dUpcoming ?? 0, color: '#b8621a', link: '/list/91day' },
        { label: 'New Pathology', value: clinicianData?.newPathologyResults ?? 0, color: '#327C8D', link: '/pathology' },
        { label: 'Overdue Pathology', value: clinicianData?.overduePathologyResults ?? 0, color: '#D32F2F', link: '/pathology' },
      ]),
    });

    cards.push({
      id: 'clinician-alert-feed', title: `Clinical Alert Feed (${overdueItems.length + upcomingItems.length})`, size: 'md',
      icon: <WarningAmberIcon sx={{ fontSize: 18, color: '#b8621a' }} />,
      content: overdueItems.length + upcomingItems.length > 0
        ? <MiniList items={[...overdueItems, ...upcomingItems].slice(0, 10).map((a) => ({
            primary: `${a.givenName ?? ''} ${a.familyName ?? ''}`.trim() || 'Patient',
            secondary: `${a.alertType?.replace(/_/g, ' ') ?? a.detail ?? ''}${a.dueDate ? ` · ${new Date(a.dueDate).toLocaleDateString('en-AU')}` : ''}`,
            chip: a.alertType?.includes('overdue') || a.alertType?.includes('expired') ? 'Overdue' : 'Upcoming',
            chipColor: a.alertType?.includes('overdue') || a.alertType?.includes('expired') ? '#D32F2F' : '#b8621a',
            link: a.patientId ? `/patients/${a.patientId}` : undefined,
          }))} />
        : <EmptyState text="No active clinical alerts" />,
    });
  }

  if (activeView === 'nurse' || activeView === 'case_manager') {
    const alertCounts: NonNullable<ClinicalAlertsResponse['counts']> = alertsData?.counts ?? {};
    const unreadMessages = clinicianData?.unreadMessages ?? alertCounts.unreadMessages ?? 0;
    cards.push({
      id: `${activeView}-signals`, title: 'Clinical Signals', size: 'lg',
      icon: <TrendingUpIcon sx={{ fontSize: 18, color: '#327C8D' }} />,
      content: renderSignalTiles([
        { label: 'Did Not Attend', value: alertCounts.missedAppointments ?? 0, color: '#D32F2F', link: '/calendar' },
        { label: 'New Messages', value: unreadMessages, color: '#1565C0', link: '/messages' },
        { label: 'Overdue LAI', value: alertCounts.laiOverdue ?? 0, color: '#D32F2F', link: '/list/lai' },
        { label: 'Upcoming LAI', value: alertCounts.laiUpcoming ?? 0, color: '#b8621a', link: '/list/lai' },
        { label: 'Overdue MHA', value: alertCounts.legalExpired ?? 0, color: '#D32F2F', link: '/list/mha' },
        { label: 'Upcoming MHA', value: alertCounts.legalExpiring ?? 0, color: '#b8621a', link: '/list/mha' },
        { label: 'Overdue 91d Review', value: alertCounts.review91dOverdue ?? 0, color: '#D32F2F', link: '/list/91day' },
        { label: 'Upcoming 91d Review', value: alertCounts.review91dUpcoming ?? 0, color: '#b8621a', link: '/list/91day' },
        { label: 'New Pathology', value: clinicianData?.newPathologyResults ?? 0, color: '#327C8D', link: '/pathology' },
        { label: 'Overdue Pathology', value: clinicianData?.overduePathologyResults ?? 0, color: '#D32F2F', link: '/pathology' },
      ]),
    });
  }

  if (activeView === 'nurse') {
    cards.push({
      id: 'nurse-tasks', title: 'Nursing Tasks', size: 'md',
      icon: <MedicationIcon sx={{ fontSize: 18, color: '#7B1FA2' }} />,
      content: <Box>
        <StatRow label="Open Tasks" value={String(clinicianData?.openTasks ?? 0)} color="#D32F2F" />
        <StatRow label="Observations Pending" value="—" color="#b8621a" />
        <StatRow label="Assessments Due" value="—" color="#327C8D" />
        <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 1, textAlign: 'center' }}>
          View details in patient Medications and Physical Health tabs
        </Typography>
      </Box>,
    });
    cards.push({
      id: 'handover', title: 'Shift Handover Summary', size: 'md',
      icon: <MonitorHeartIcon sx={{ fontSize: 18, color: '#7B1FA2' }} />,
      content: <HandoverSummaryCard />,
    });
  }

  if (activeView === 'case_manager') {
    const caseRows = caseloadData?.data ?? [];
    const red = caseRows.filter((r) => r.ragStatus === 'red').length;
    const amber = caseRows.filter((r) => r.ragStatus === 'amber').length;
    const green = caseRows.filter((r) => r.ragStatus === 'green').length;
    cards.push({
      id: 'caseload', title: `My Caseload (${caseRows.length})`, size: 'md',
      icon: <PeopleIcon sx={{ fontSize: 18, color: '#2E7D32' }} />,
      content: <Box>
        <Box sx={{ display: 'flex', gap: 2, mb: 2 }}>
          <RagChip label="Overdue" count={red} color="#D32F2F" />
          <RagChip label="At Risk" count={amber} color="#b8621a" />
          <RagChip label="On Track" count={green} color="#2E7D32" />
        </Box>
        {caseRows.slice(0, 8).map((r, i: number) => (
          <Box key={r.patientId ?? i}
            {...(r.patientId ? trio(`Open patient ${r.patientName ?? 'patient'}, RAG status ${r.ragStatus ?? 'unknown'}`, () => navigate(`/patients/${r.patientId}`)) : {})}
            sx={{ display: 'flex', justifyContent: 'space-between', py: 0.5, borderBottom: '1px solid #eee', cursor: r.patientId ? 'pointer' : 'default', '&:hover': r.patientId ? { bgcolor: '#f5f5f5' } : {}, '&:focus-visible': r.patientId ? { outline: '2px solid #b8621a', outlineOffset: -2 } : {} }}>
            <Typography variant="body2" fontWeight={500} sx={{ fontSize: 12 }}>{r.patientName ?? 'Patient'}</Typography>
            <Chip label={r.ragStatus ?? 'unknown'} size="small" sx={{
              bgcolor: r.ragStatus === 'red' ? '#FDECEA' : r.ragStatus === 'amber' ? '#FFF3E0' : '#E8F5E9',
              color: r.ragStatus === 'red' ? '#D32F2F' : r.ragStatus === 'amber' ? '#b8621a' : '#2E7D32',
              fontSize: 9, height: 18, fontWeight: 600, textTransform: 'capitalize',
            }} />
          </Box>
        ))}
        {caseRows.length > 8 && <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 1, textAlign: 'center' }}>+{caseRows.length - 8} more — view in Patients</Typography>}
      </Box>,
    });
  }

  if (activeView === 'team_dashboard') {
    const totals = teamDashboard?.totals;
    const teamRows = teamDashboard?.teamBreakdown ?? [];
    const clinicianRows = teamDashboard?.clinicianBreakdown ?? [];
    const scopeLabel = teamDashboard?.scope.scopeLabel ?? selectedTeamScope?.label ?? 'Team scope';
    const signals = [
      { label: 'Did Not Attend', value: totals?.didNotAttendAppointments ?? 0, color: '#D32F2F', link: '/calendar' },
      { label: 'New Messages', value: totals?.unreadMessages ?? 0, color: '#1565C0', link: '/messages' },
      { label: 'Overdue LAI', value: totals?.overdueLai ?? 0, color: '#D32F2F', link: '/list/lai' },
      { label: 'Upcoming LAI', value: totals?.upcomingLai ?? 0, color: '#b8621a', link: '/list/lai' },
      { label: 'Overdue MHA', value: totals?.overdueMha ?? 0, color: '#D32F2F', link: '/list/mha' },
      { label: 'Upcoming MHA', value: totals?.upcomingMha ?? 0, color: '#b8621a', link: '/list/mha' },
      { label: 'Overdue 91d Review', value: totals?.overdueReviews91d ?? 0, color: '#D32F2F', link: '/list/91day' },
      { label: 'Upcoming 91d Review', value: totals?.upcomingReviews91d ?? 0, color: '#b8621a', link: '/list/91day' },
    ];

    cards.push({
      id: 'team-summary',
      title: `Team Dashboard — ${scopeLabel}`,
      size: 'lg',
      icon: <SwapHorizIcon sx={{ fontSize: 18, color: '#00695C' }} />,
      content: renderSignalTiles(signals),
    });

    cards.push({
      id: 'team-caseload-operational',
      title: 'Caseload & Throughput',
      size: 'md',
      icon: <PeopleIcon sx={{ fontSize: 18, color: '#00695C' }} />,
      content: renderSignalTiles([
        { label: 'Active Patients', value: totals?.activePatients ?? 0, color: '#00695C' },
        { label: 'Open Episodes', value: totals?.openEpisodes ?? 0, color: '#327C8D' },
        { label: 'Today Appointments', value: totals?.todaysAppointments ?? 0, color: '#2E7D32' },
        { label: 'Open Tasks', value: totals?.openTasks ?? 0, color: '#b8621a' },
      ]),
    });

    cards.push({
      id: 'team-breakdown',
      title: `Team Breakdown (${teamRows.length})`,
      size: 'md',
      icon: <PeopleIcon sx={{ fontSize: 18, color: '#00695C' }} />,
      content: teamRows.length > 0
        ? <MiniList items={teamRows.map((row) => ({
          primary: row.teamName,
          secondary: `${row.activePatients} active patients · ${row.openEpisodes} open episodes`,
        }))} />
        : <EmptyState text="No active team caseload in selected scope" />,
    });

    cards.push({
      id: 'team-clinician-breakdown',
      title: `Clinician Workload (${clinicianRows.length})`,
      size: 'md',
      icon: <LocalHospitalIcon sx={{ fontSize: 18, color: '#327C8D' }} />,
      content: clinicianRows.length > 0
        ? <MiniList items={clinicianRows.slice(0, 20).map((row) => ({
          primary: row.displayName,
          secondary: `${row.teamName} · ${row.activePatients} active patients · ${row.openEpisodes} open episodes`,
        }))} />
        : <EmptyState text="No clinician allocations in selected scope" />,
    });
  }

  if (activeView === 'receptionist') {
    const appts = readArray<DashboardAppointmentRow>(todayAppts, ['data', 'appointments']);
    const triages = triageData?.data ?? [];
    const arrived = appts.filter((a) => a.status === 'arrived').length;
    const waiting = appts.filter((a) => a.status === 'scheduled' || a.status === 'confirmed').length;
    cards.push({
      id: 'reception-today', title: "Today's Schedule", size: 'md',
      icon: <CalendarTodayIcon sx={{ fontSize: 18, color: '#b8621a' }} />,
      content: <Box>
        <Box sx={{ display: 'flex', gap: 2, mb: 2 }}>
          <StatRow label="Total" value={String(appts.length)} color="#3D484B" />
          <StatRow label="Arrived" value={String(arrived)} color="#2E7D32" />
          <StatRow label="Waiting" value={String(waiting)} color="#b8621a" />
        </Box>
      </Box>,
    });
    cards.push({
      id: 'phone-triage', title: `Open Triage (${triages.length})`, size: 'md',
      icon: <PersonAddIcon sx={{ fontSize: 18, color: '#b8621a' }} />,
      content: triages.length > 0
        ? <MiniList items={triages.slice(0, 8).map((t) => ({
            primary: t.caller_name ?? 'Unknown',
            secondary: `${t.urgency ?? 'routine'} — ${t.reason_for_call ?? ''}`,
            chip: t.urgency, chipColor: t.urgency === 'urgent' ? '#D32F2F' : t.urgency === 'semi-urgent' ? '#b8621a' : '#327C8D',
          }))} />
        : <EmptyState text="No open triage items" />,
    });
  }

  if (activeView === 'manager') {
    const alertCounts: NonNullable<ClinicalAlertsResponse['counts']> = alertsData?.counts ?? {};
    cards.push({
      id: 'manager-service-signals',
      title: 'Clinic Service Signals',
      size: 'lg',
      icon: <WarningAmberIcon sx={{ fontSize: 18, color: '#327C8D' }} />,
      content: renderSignalTiles([
        { label: 'Did Not Attend', value: alertCounts.missedAppointments ?? 0, color: '#D32F2F', link: '/calendar' },
        { label: 'New Messages', value: alertCounts.unreadMessages ?? 0, color: '#1565C0', link: '/messages' },
        { label: 'Overdue LAI', value: alertCounts.laiOverdue ?? 0, color: '#D32F2F', link: '/list/lai' },
        { label: 'Upcoming LAI', value: alertCounts.laiUpcoming ?? 0, color: '#b8621a', link: '/list/lai' },
        { label: 'Overdue MHA', value: alertCounts.legalExpired ?? 0, color: '#D32F2F', link: '/list/mha' },
        { label: 'Upcoming MHA', value: alertCounts.legalExpiring ?? 0, color: '#b8621a', link: '/list/mha' },
        { label: 'Overdue 91d Review', value: alertCounts.review91dOverdue ?? 0, color: '#D32F2F', link: '/list/91day' },
        { label: 'Upcoming 91d Review', value: alertCounts.review91dUpcoming ?? 0, color: '#b8621a', link: '/list/91day' },
      ]),
    });

    // Contacts KPI
    const kpiRows = kpiData?.data ?? [];
    cards.push({
      id: 'contacts-kpi', title: 'Contacts KPI', size: 'md',
      icon: <TrendingUpIcon sx={{ fontSize: 18, color: '#327C8D' }} />,
      content: kpiRows.length > 0
        ? <Box>{kpiRows.slice(0, 6).map((c, i: number) => {
            const contacts = c.contacts_this_period ?? 0;
            const tgt = c.target ?? 80;
            const pct = tgt > 0 ? Math.round((contacts / tgt) * 100) : 0;
            const color = c.ragStatus === 'green' ? '#2E7D32' : c.ragStatus === 'amber' ? '#b8621a' : '#D32F2F';
            return (
              <Box key={i} sx={{ mb: 1 }}>
                <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 0.25 }}>
                  <Typography variant="caption" fontWeight={600} sx={{ fontSize: 11 }}>{c.clinicianName}</Typography>
                  <Typography variant="caption" fontWeight={700} color={color} sx={{ fontSize: 11 }}>{pct}%</Typography>
                </Box>
                <LinearProgress variant="determinate" value={Math.min(pct, 100)} sx={{ height: 6, borderRadius: 1, bgcolor: '#F0F0F0', '& .MuiLinearProgress-bar': { bgcolor: color } }} />
              </Box>
            );
          })}</Box>
        : <EmptyState text="No contact data" />,
    });

    // Staff Caseload
    const caseRows = caseloadReport?.data ?? [];
    cards.push({
      id: 'staff-caseload', title: 'Staff Caseload', size: 'md',
      icon: <PeopleIcon sx={{ fontSize: 18, color: '#327C8D' }} />,
      content: caseRows.length > 0
        ? <Box>{caseRows.slice(0, 6).map((c, i: number) => {
            const patients = c.patient_count ?? 0;
            const max = c.max_caseload ?? 35;
            const color = c.caseload_status === 'over' ? '#D32F2F' : c.caseload_status === 'near' ? '#b8621a' : '#2E7D32';
            return (
              <Box key={i} sx={{ display: 'flex', justifyContent: 'space-between', py: 0.5, borderBottom: '1px solid #eee' }}>
                <Typography variant="body2" sx={{ fontSize: 12 }}>{c.clinicianName}</Typography>
                <Chip label={`${patients}/${max}`} size="small" sx={{ bgcolor: color, color: '#fff', fontSize: 9, height: 18 }} />
              </Box>
            );
          })}</Box>
        : <EmptyState text="No caseload data" />,
    });

    // DNA Rates
    const dnaRows = dnaData?.data ?? [];
    cards.push({
      id: 'dna-rates', title: 'DNA Rates', size: 'sm',
      icon: <EventBusyIcon sx={{ fontSize: 18, color: '#b8621a' }} />,
      content: dnaRows.length > 0
        ? <Box>{dnaRows.slice(0, 5).map((r, i: number) => {
            const rate = Number(r.dna_rate_pct ?? 0);
            return (
              <Box key={i} sx={{ display: 'flex', justifyContent: 'space-between', py: 0.5, borderBottom: '1px solid #eee' }}>
                <Typography variant="caption" sx={{ fontSize: 11 }}>{r.clinicianName}</Typography>
                <Typography variant="caption" fontWeight={700} color={rate > 15 ? '#D32F2F' : rate > 8 ? '#b8621a' : '#2E7D32'}>{rate}%</Typography>
              </Box>
            );
          })}</Box>
        : <EmptyState text="No DNA data" />,
    });

    // Workload Alerts
    const raw = workloadData?.data ?? {};
    const wlAlerts = [
      ...((raw as WorkloadData).caseloadExceeded ?? []).map((a) => ({ ...a, type: 'caseload' as const, msg: `${a.patient_count ?? 0} patients (max ${a.max_caseload ?? 0})` })),
      ...((raw as WorkloadData).overdueContacts ?? []).map((a) => ({ ...a, type: 'overdue' as const, msg: `${a.overdue_patients ?? 0} overdue contacts` })),
    ];
    cards.push({
      id: 'workload', title: `Workload Alerts (${wlAlerts.length})`, size: 'sm',
      icon: <WarningAmberIcon sx={{ fontSize: 18, color: '#D32F2F' }} />,
      content: wlAlerts.length > 0
        ? <Box>{wlAlerts.map((a, i: number) => (
            <Box key={i} sx={{ py: 0.5, borderBottom: '1px solid #eee' }}>
              <Typography variant="body2" fontWeight={600} sx={{ fontSize: 11 }}>{a.name}</Typography>
              <Typography variant="caption" color="text.secondary" sx={{ fontSize: 10 }}>{a.msg}</Typography>
            </Box>
          ))}</Box>
        : <EmptyState text="All staff within normal parameters" color="#2E7D32" />,
    });

    // Service stats + billing from existing manager data
    cards.push({
      id: 'stats', title: 'Service Statistics', size: 'md',
      icon: <TrendingUpIcon sx={{ fontSize: 18, color: '#3D484B' }} />,
      content: <ServiceStats referralSla={managerData?.referralSla} missedRate={managerData?.missedAppointmentRate} totalAppts={managerData?.totalAppointmentsThisMonth} />,
    });
    cards.push({
      id: 'billing', title: 'Billing', size: 'sm',
      icon: <TrendingUpIcon sx={{ fontSize: 18, color: '#3D484B' }} />,
      content: <BillingCard billing={managerData?.billingKpis} />,
    });
  }

  // Staff Activity — ONLY in manager dashboard
  if (activeView === 'manager') {
    cards.push({
      id: 'staff', title: 'Staff Activity', size: 'md',
      icon: <PeopleIcon sx={{ fontSize: 18, color: '#3D484B' }} />,
      content: (managerData?.staffActivity ?? []).length > 0
        ? <MiniList items={(managerData?.staffActivity ?? []).map((s) => ({
            primary: s.displayName,
            secondary: `${s.completedAppointments} appts, ${s.signedNotes} notes${s.overdueTasks > 0 ? `, ${s.overdueTasks} overdue` : ''}`,
            chip: s.overdueTasks > 0 ? `${s.overdueTasks}` : undefined,
            chipColor: s.overdueTasks > 0 ? '#D32F2F' : undefined,
          }))} />
        : <EmptyState text="No staff data" />,
    });
  }

  // Clinical signal counts are now surfaced via dedicated, non-overlapping
  // KPI tiles per dashboard persona (my/team/manager/role views).

  const sizeMap = { sm: { xs: 12, md: 4 }, md: { xs: 12, md: 6 }, lg: { xs: 12 } };
  const hasRoleDashboardError = (activeView === 'my_dashboard' || activeView === 'clinician')
    && (
      (clinicianMetricsError && !isExpectedAccessError(clinicianMetricsErrorObj))
      || (caseloadDataError && !isExpectedAccessError(caseloadDataErrorObj))
      || (myAppointmentsError && !isExpectedAccessError(myAppointmentsErrorObj))
      || (myTasksError && !isExpectedAccessError(myTasksErrorObj))
      || (alertsDataError && !isExpectedAccessError(alertsDataErrorObj))
    );
  const hasManagerDashboardError = activeView === 'manager'
    && (
      (kpiDataError && !isExpectedAccessError(kpiDataErrorObj))
      || (caseloadReportError && !isExpectedAccessError(caseloadReportErrorObj))
      || (dnaDataError && !isExpectedAccessError(dnaDataErrorObj))
      || (workloadDataError && !isExpectedAccessError(workloadDataErrorObj))
      || (alertsDataError && !isExpectedAccessError(alertsDataErrorObj))
    );
  const hasReceptionDashboardError = activeView === 'receptionist'
    && (
      (todayApptsError && !isExpectedAccessError(todayApptsErrorObj))
      || (alertsDataError && !isExpectedAccessError(alertsDataErrorObj))
    );
  const hasTeamDashboardError = activeView === 'team_dashboard'
    && (teamScopesError || teamDashboardError);
  const hasDashboardDataError =
    hasRoleDashboardError || hasManagerDashboardError || hasReceptionDashboardError || hasTeamDashboardError;

  return (
    <Box sx={{ minHeight: '100vh', bgcolor: '#F5F3F0' }}>
      {/* Header */}
      <Box sx={{ px: { xs: 2, md: 3 }, py: 2, borderBottom: '1px solid', borderColor: 'divider', bgcolor: 'background.paper' }}>
        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 1 }}>
          <Box>
            <Typography variant="h5" fontWeight={700} fontFamily="Albert Sans, sans-serif" sx={{ color: 'text.primary' }}>
              Welcome back, {name}
            </Typography>
            <Typography variant="body2" sx={{ color: 'text.secondary' }}>
              {new Date().toLocaleDateString('en-AU', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}
            </Typography>
          </Box>
          <Box sx={{ display: 'flex', gap: 1, alignItems: 'center', flexWrap: 'wrap' }}>
            <FormControl size="small" sx={{ minWidth: 110 }}>
              <InputLabel>Period</InputLabel>
              <Select value={period} onChange={e => setPeriod(e.target.value)} label="Period">
                <MenuItem value="today">Today</MenuItem>
                <MenuItem value="week">This Week</MenuItem>
                <MenuItem value="month">This Month</MenuItem>
                <MenuItem value="quarter">Quarter</MenuItem>
              </Select>
            </FormControl>
            {showTeamDashboard ? (
              <>
                <FormControl size="small" sx={{ minWidth: 160 }}>
                  <InputLabel>Scope</InputLabel>
                  <Select
                    value={teamScopeType}
                    onChange={(e) => {
                      const value = e.target.value as 'team' | 'parent_team' | 'program' | 'clinic';
                      setTeamScopeType(value);
                      if (value !== 'clinic') setTeamScopeId('');
                    }}
                    label="Scope"
                  >
                    <MenuItem value="team">My Team</MenuItem>
                    {(teamScopes?.parentTeams.length ?? 0) > 0 && (
                      <MenuItem value="parent_team">Parent Team</MenuItem>
                    )}
                    {(teamScopes?.programs.length ?? 0) > 0 && (
                      <MenuItem value="program">Program</MenuItem>
                    )}
                    {teamScopes?.canViewClinic && (
                      <MenuItem value="clinic">Clinic</MenuItem>
                    )}
                  </Select>
                </FormControl>
                {teamScopeType !== 'clinic' && (
                  <FormControl size="small" sx={{ minWidth: 190 }}>
                    <InputLabel>
                      {teamScopeType === 'team'
                        ? 'Team'
                        : teamScopeType === 'parent_team'
                          ? 'Parent Team'
                          : 'Program'}
                    </InputLabel>
                    <Select
                      value={teamScopeId}
                      onChange={(e) => setTeamScopeId(e.target.value)}
                      label={teamScopeType === 'team'
                        ? 'Team'
                        : teamScopeType === 'parent_team'
                          ? 'Parent Team'
                          : 'Program'}
                    >
                      {(teamScopeType === 'team'
                        ? (teamScopes?.teams ?? [])
                        : teamScopeType === 'parent_team'
                          ? (teamScopes?.parentTeams ?? [])
                          : (teamScopes?.programs ?? [])
                      ).map((option) => (
                        <MenuItem key={`${option.scopeType}:${option.scopeId}`} value={option.scopeId ?? ''}>
                          {option.label}
                        </MenuItem>
                      ))}
                    </Select>
                  </FormControl>
                )}
              </>
            ) : (
              <FormControl size="small" sx={{ minWidth: 140 }}>
                <InputLabel>Team</InputLabel>
                <Select value={teamFilter} onChange={e => setTeamFilter(e.target.value)} label="Team">
                  <MenuItem value="">All Teams</MenuItem>
                  {flatUnits.map(u => <MenuItem key={u.id} value={u.id}>{u.name}</MenuItem>)}
                </Select>
              </FormControl>
            )}
            <Tooltip title="Refresh now">
              <IconButton size="small" onClick={manualRefresh} sx={{ color: '#327C8D' }}>
                <RefreshIcon sx={{ fontSize: 20 }} />
              </IconButton>
            </Tooltip>
            <Tooltip title={autoRefresh ? 'Auto-refresh ON (every 2 min)' : 'Auto-refresh OFF'}>
              <FormControlLabel
                control={<Switch size="small" checked={autoRefresh} onChange={(_, v) => setAutoRefresh(v)} />}
                label={<Typography variant="caption" sx={{ fontSize: 9 }}>Auto</Typography>}
                sx={{ ml: 0, mr: 0 }}
              />
            </Tooltip>
            <Typography variant="caption" color="text.disabled" sx={{ fontSize: 9 }}>
              {lastRefresh.toLocaleTimeString('en-AU', { hour: '2-digit', minute: '2-digit' })}
            </Typography>
          </Box>
        </Box>

        {/* Role Switcher */}
        {availableRoles.length > 1 && (
          <Box sx={{ display: 'flex', gap: 1, mt: 1.5, flexWrap: 'wrap' }}>
            {availableRoles.map(r => {
              const def = ROLE_LABELS[r];
              if (!def) return null;
              const isActive = activeView === r;
              return (
                <Chip
                  key={r}
                  icon={def.icon}
                  label={def.label}
                  onClick={() => setActiveView(r)}
                  variant={isActive ? 'filled' : 'outlined'}
                  sx={{
                    fontWeight: isActive ? 700 : 500,
                    fontSize: 12,
                    bgcolor: isActive ? def.color + '15' : undefined,
                    borderColor: def.color,
                    color: isActive ? def.color : 'text.secondary',
                    '& .MuiChip-icon': { color: isActive ? def.color : 'text.disabled' },
                    cursor: 'pointer',
                  }}
                />
              );
            })}
          </Box>
        )}
      </Box>

      {/* Restore hidden cards */}
      {hiddenCards.size > 0 && (
        <Box sx={{ px: { xs: 2, md: 3 }, mt: 1 }}>
          <Button size="small" variant="text" onClick={() => setHiddenCards(new Set())}
            sx={{ fontSize: 11, textTransform: 'none', color: '#999' }}>
            Show {hiddenCards.size} hidden card{hiddenCards.size > 1 ? 's' : ''}
          </Button>
        </Box>
      )}

      {/* Cards Grid */}
      <Grid container spacing={2} sx={{ px: { xs: 2, md: 3 }, mt: 1, pb: 4 }}>
        {hasDashboardDataError && (
          <Grid size={{ xs: 12 }}>
            <Alert severity="warning" sx={{ borderRadius: 2 }}>
              Some dashboard metrics are temporarily unavailable. Counts shown as zero may be incomplete until data reload succeeds.
            </Alert>
          </Grid>
        )}
        {cards.filter(card => !hiddenCards.has(card.id)).map(card => {
          const isExpanded = expandedCard === card.id;
          const gridSize = isExpanded ? { xs: 12 } : sizeMap[card.size];
          return (
            <Grid key={card.id} size={gridSize}>
              <Paper elevation={0} sx={{
                border: '1px solid', borderColor: 'divider', borderRadius: 3, p: 2, height: '100%',
                transition: 'all 0.2s', boxShadow: '0 2px 12px rgba(61,72,75,0.08)',
                '&:hover': { boxShadow: '0 4px 20px rgba(61,72,75,0.14)' },
              }}>
                <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 1.5 }}>
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
                    {card.icon}
                    <Typography variant="subtitle2" fontWeight={700} fontFamily="Albert Sans, sans-serif">{card.title}</Typography>
                  </Box>
                  <Box sx={{ display: 'flex', gap: 0.25 }}>
                    <Tooltip title={isExpanded ? 'Collapse' : 'Expand'}>
                      <IconButton size="small" onClick={() => setExpandedCard(isExpanded ? null : card.id)}>
                        {isExpanded ? <CloseFullscreenIcon sx={{ fontSize: 14 }} /> : <OpenInFullIcon sx={{ fontSize: 14 }} />}
                      </IconButton>
                    </Tooltip>
                    <Tooltip title="Hide card">
                      <IconButton size="small" onClick={() => setHiddenCards(prev => new Set([...prev, card.id]))}>
                        <CloseIcon sx={{ fontSize: 14, color: '#ccc', '&:hover': { color: '#999' } }} />
                      </IconButton>
                    </Tooltip>
                  </Box>
                </Box>
                {card.content}
              </Paper>
            </Grid>
          );
        })}
      </Grid>
    </Box>
  );
}
