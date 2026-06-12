import React from 'react';
import {
  Alert,
  Box,
  Button,
  Chip,
  Grid,
  Paper,
  Typography,
} from '@mui/material';
import { useNavigate } from 'react-router-dom';
import { SETTINGS_DASHBOARD_OPTIONS_PATH } from '../../../shared/navigation/settingsNavigation';
import { useDashboardPreferences, useTeamDashboardMetrics, useTeamDashboardScopes } from '../hooks/useDashboardMetrics';
import { getVisibleDashboardCards, isDashboardViewEnabled, readDashboardPreferences } from './dashboardPreferenceUtils';
import { useTaskSummary } from '../../tasks/hooks/useTasks';

function commandRows(totals: {
  overdueLai?: number;
  overdueMha?: number;
  overdueReviews91d?: number;
  urgentAlerts?: number;
  newReferrals?: number;
  openTasks?: number;
}) {
  return [
    {
      id: 'overdue-lai',
      severity: totals.overdueLai ? 'High' : 'Low',
      item: 'LAI overdue',
      count: totals.overdueLai ?? 0,
      consequence: 'Medication relapse-prevention breach',
      nextAction: 'Open LAI list',
      path: '/list/lai',
    },
    {
      id: 'mha-expiry',
      severity: totals.overdueMha ? 'High' : 'Low',
      item: 'MHA/CTO overdue',
      count: totals.overdueMha ?? 0,
      consequence: 'Legal-authority breach',
      nextAction: 'Open legal list',
      path: '/list/mha',
    },
    {
      id: 'review-91d',
      severity: totals.overdueReviews91d ? 'Med' : 'Low',
      item: '91-day review overdue',
      count: totals.overdueReviews91d ?? 0,
      consequence: 'Governance and care-plan drift',
      nextAction: 'Open review list',
      path: '/list/91day',
    },
    {
      id: 'new-referrals',
      severity: totals.newReferrals ? 'Med' : 'Low',
      item: 'New referrals',
      count: totals.newReferrals ?? 0,
      consequence: 'Allocation/SLA pressure',
      nextAction: 'Open referrals',
      path: '/referrals',
    },
    {
      id: 'open-tasks',
      severity: totals.openTasks ? 'Med' : 'Low',
      item: 'Open tasks',
      count: totals.openTasks ?? 0,
      consequence: 'Unowned follow-up risk',
      nextAction: 'Open tasks',
      path: '/tasks',
    },
  ];
}

export default function TeamCommandBoardPage(): React.ReactElement {
  const navigate = useNavigate();
  const { data: prefs } = useDashboardPreferences();
  const preferences = readDashboardPreferences(prefs?.preferences);
  const viewId = 'team_dashboard' as const;
  const enabled = isDashboardViewEnabled(preferences, viewId);
  const visible = new Set(getVisibleDashboardCards(preferences, viewId).map((card) => card.id));
  const { data: scopes } = useTeamDashboardScopes(enabled);
  const firstScope = scopes?.canViewClinic
    ? { scopeType: 'clinic' as const, scopeId: undefined }
    : scopes?.teams[0]
      ? { scopeType: 'team' as const, scopeId: scopes.teams[0].scopeId ?? undefined }
      : { scopeType: undefined, scopeId: undefined };
  const { data } = useTeamDashboardMetrics(
    { period: 'week', scopeType: firstScope.scopeType, scopeId: firstScope.scopeId },
    enabled && !!firstScope.scopeType,
  );
  const taskScopeQuery = firstScope.scopeType === 'team' && firstScope.scopeId
    ? { teamId: firstScope.scopeId }
    : firstScope.scopeType
      ? { teamScope: 'mine' as const }
      : { teamScope: 'mine' as const };
  const { data: taskSummary } = useTaskSummary(taskScopeQuery);
  const totals = data?.totals;
  const rows = commandRows(totals ?? {});

  return (
    <Box sx={{ p: { xs: 2, md: 3 }, bgcolor: '#F5F3F0', minHeight: '100vh' }}>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', gap: 2, flexWrap: 'wrap', mb: 2.5 }}>
        <Box>
          <Typography variant="h4" fontWeight={800} fontFamily="Albert Sans, sans-serif">
            Team Command Board
          </Typography>
          <Typography variant="body2" color="text.secondary">
            Acuity, owner, consequence, SLA and next action. Raw counts are not enough.
          </Typography>
        </Box>
        <Button variant="outlined" onClick={() => navigate(SETTINGS_DASHBOARD_OPTIONS_PATH)} sx={{ textTransform: 'none' }}>
          Dashboard options
        </Button>
      </Box>

      {!enabled && (
        <Alert severity="info" sx={{ mb: 2 }}>
          This dashboard option is disabled in Settings. You can still preview it here.
        </Alert>
      )}

      <Grid container spacing={2}>
        {visible.has('team-command-queue') && (
          <Grid size={{ xs: 12 }}>
            <Paper variant="outlined" sx={{ p: 2.25, borderRadius: 3 }}>
              <Typography variant="h6" fontWeight={800} sx={{ mb: 1 }}>
                Priority Work Queue
              </Typography>
              {rows.map((row) => (
                <Box
                  key={row.id}
                  sx={{ display: 'grid', gridTemplateColumns: '90px 1fr 80px 1.6fr 140px', gap: 1.5, py: 1, borderBottom: '1px solid', borderColor: 'divider', alignItems: 'center' }}
                >
                  <Chip
                    label={row.severity}
                    color={row.severity === 'High' ? 'error' : row.severity === 'Med' ? 'warning' : 'success'}
                    size="small"
                  />
                  <Typography variant="body2" fontWeight={800}>{row.item}</Typography>
                  <Typography variant="body2">{row.count}</Typography>
                  <Typography variant="caption" color="text.secondary">{row.consequence}</Typography>
                  <Button size="small" variant="outlined" onClick={() => navigate(row.path)} sx={{ textTransform: 'none' }}>
                    {row.nextAction}
                  </Button>
                </Box>
              ))}
            </Paper>
          </Grid>
        )}

        {visible.has('team-summary') && (
          <Grid size={{ xs: 12, md: 6 }}>
            <Paper variant="outlined" sx={{ p: 2.25, borderRadius: 3 }}>
              <Typography variant="subtitle1" fontWeight={800}>Safety Summary</Typography>
              <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap', mt: 1 }}>
                <Chip label={`${totals?.urgentAlerts ?? 0} urgent alerts`} color={(totals?.urgentAlerts ?? 0) > 0 ? 'error' : 'default'} />
                <Chip label={`${totals?.upcomingMha ?? 0} MHA expiring`} />
                <Chip label={`${totals?.upcomingLai ?? 0} LAI upcoming`} />
                <Chip label={`${taskSummary?.totals.overdue ?? 0} overdue tasks`} color={(taskSummary?.totals.overdue ?? 0) > 0 ? 'error' : 'default'} />
                <Chip label={`${taskSummary?.totals.unassigned ?? 0} unassigned`} color={(taskSummary?.totals.unassigned ?? 0) > 0 ? 'warning' : 'default'} />
              </Box>
            </Paper>
          </Grid>
        )}

        {visible.has('team-caseload-operational') && (
          <Grid size={{ xs: 12, md: 6 }}>
            <Paper variant="outlined" sx={{ p: 2.25, borderRadius: 3 }}>
              <Typography variant="subtitle1" fontWeight={800}>Caseload & Flow</Typography>
              <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap', mt: 1 }}>
                <Chip label={`${totals?.activePatients ?? 0} active patients`} />
                <Chip label={`${totals?.openEpisodes ?? 0} open episodes`} />
                <Chip label={`${totals?.todaysAppointments ?? 0} today appointments`} />
              </Box>
            </Paper>
          </Grid>
        )}
      </Grid>
    </Box>
  );
}
