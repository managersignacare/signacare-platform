import React from 'react';
import {
  Alert,
  Box,
  Button,
  Chip,
  Grid,
  LinearProgress,
  Paper,
  Typography,
} from '@mui/material';
import { useNavigate } from 'react-router-dom';
import { SETTINGS_DASHBOARD_OPTIONS_PATH } from '../../../shared/navigation/settingsNavigation';
import { useDashboardPreferences, useManagerMetrics } from '../hooks/useDashboardMetrics';
import { getVisibleDashboardCards, isDashboardViewEnabled, readDashboardPreferences } from './dashboardPreferenceUtils';
import { useTaskSummary } from '../../tasks/hooks/useTasks';

export default function ManagerCommandBoardPage(): React.ReactElement {
  const navigate = useNavigate();
  const { data: prefs } = useDashboardPreferences();
  const preferences = readDashboardPreferences(prefs?.preferences);
  const viewId = 'manager' as const;
  const enabled = isDashboardViewEnabled(preferences, viewId);
  const visible = new Set(getVisibleDashboardCards(preferences, viewId).map((card) => card.id));
  const { data } = useManagerMetrics({ period: 'month' });
  const { data: taskSummary } = useTaskSummary({});
  const sla = data?.referralSla;
  const overdueStaff = data?.overdueTasksByStaff ?? [];

  return (
    <Box sx={{ p: { xs: 2, md: 3 }, bgcolor: '#F5F3F0', minHeight: '100vh' }}>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', gap: 2, flexWrap: 'wrap', mb: 2.5 }}>
        <Box>
          <Typography variant="h4" fontWeight={800} fontFamily="Albert Sans, sans-serif">
            Manager Command Board
          </Typography>
          <Typography variant="body2" color="text.secondary">
            Service-level safety, governance, capacity, and next-action ownership.
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
        {visible.has('manager-command-queue') && (
          <Grid size={{ xs: 12 }}>
            <Paper variant="outlined" sx={{ p: 2.25, borderRadius: 3 }}>
              <Typography variant="h6" fontWeight={800} sx={{ mb: 1 }}>Escalation Inspector</Typography>
              <Box sx={{ display: 'grid', gridTemplateColumns: '90px 1.4fr 1fr 1.8fr 150px', gap: 1.5, py: 1, borderBottom: '1px solid', borderColor: 'divider' }}>
                <Chip label={(sla?.breached ?? 0) > 0 ? 'High' : 'Low'} color={(sla?.breached ?? 0) > 0 ? 'error' : 'success'} size="small" />
                <Typography variant="body2" fontWeight={800}>Referral SLA breaches</Typography>
                <Typography variant="body2">{sla?.breached ?? 0} breached</Typography>
                <Typography variant="caption" color="text.secondary">Consequence: delayed access and intake drift.</Typography>
                <Button size="small" variant="outlined" onClick={() => navigate('/referrals')} sx={{ textTransform: 'none' }}>Open referrals</Button>
              </Box>
              <Box sx={{ display: 'grid', gridTemplateColumns: '90px 1.4fr 1fr 1.8fr 150px', gap: 1.5, py: 1, borderBottom: '1px solid', borderColor: 'divider' }}>
                <Chip label={overdueStaff.length > 0 ? 'Med' : 'Low'} color={overdueStaff.length > 0 ? 'warning' : 'success'} size="small" />
                <Typography variant="body2" fontWeight={800}>Staff overdue tasks</Typography>
                <Typography variant="body2">{overdueStaff.length} staff</Typography>
                <Typography variant="caption" color="text.secondary">Consequence: unowned follow-up and governance drift.</Typography>
                <Button size="small" variant="outlined" onClick={() => navigate('/tasks')} sx={{ textTransform: 'none' }}>Open tasks</Button>
              </Box>
              <Box sx={{ display: 'grid', gridTemplateColumns: '90px 1.4fr 1fr 1.8fr 150px', gap: 1.5, py: 1, alignItems: 'center' }}>
                <Chip label={(taskSummary?.totals.unassigned ?? 0) > 0 ? 'Med' : 'Low'} color={(taskSummary?.totals.unassigned ?? 0) > 0 ? 'warning' : 'success'} size="small" />
                <Typography variant="body2" fontWeight={800}>Unassigned tasks</Typography>
                <Typography variant="body2">{taskSummary?.totals.unassigned ?? 0}</Typography>
                <Typography variant="caption" color="text.secondary">Consequence: next-step drift and invisible ownership gaps.</Typography>
                <Button size="small" variant="outlined" onClick={() => navigate('/tasks')} sx={{ textTransform: 'none' }}>Open workbench</Button>
              </Box>
            </Paper>
          </Grid>
        )}

        {visible.has('manager-service-signals') && (
          <Grid size={{ xs: 12, md: 6 }}>
            <Paper variant="outlined" sx={{ p: 2.25, borderRadius: 3 }}>
              <Typography variant="subtitle1" fontWeight={800}>Service Signals</Typography>
              <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap', mt: 1 }}>
                <Chip label={`${sla?.total ?? 0} referrals`} />
                <Chip label={`${sla?.withinSla ?? 0} within SLA`} color="success" />
                <Chip label={`${sla?.breached ?? 0} breached`} color={(sla?.breached ?? 0) > 0 ? 'error' : 'default'} />
              </Box>
            </Paper>
          </Grid>
        )}

        {visible.has('contacts-kpi') && (
          <Grid size={{ xs: 12, md: 6 }}>
            <Paper variant="outlined" sx={{ p: 2.25, borderRadius: 3 }}>
              <Typography variant="subtitle1" fontWeight={800}>Referral SLA Performance</Typography>
              <LinearProgress
                variant="determinate"
                value={sla?.total ? Math.round((sla.withinSla / sla.total) * 100) : 0}
                sx={{ mt: 1.5, height: 10, borderRadius: 3 }}
              />
              <Typography variant="caption" color="text.secondary">
                Within SLA: {sla?.withinSla ?? 0}/{sla?.total ?? 0}
              </Typography>
            </Paper>
          </Grid>
        )}
      </Grid>
    </Box>
  );
}
