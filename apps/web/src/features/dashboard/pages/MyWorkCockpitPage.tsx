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
import AssignmentIcon from '@mui/icons-material/Assignment';
import CalendarTodayIcon from '@mui/icons-material/CalendarToday';
import MedicalInformationIcon from '@mui/icons-material/MedicalInformation';
import WarningAmberIcon from '@mui/icons-material/WarningAmber';
import { useNavigate } from 'react-router-dom';
import { SETTINGS_DASHBOARD_OPTIONS_PATH } from '../../../shared/navigation/settingsNavigation';
import { useClinicianMetrics, useDashboardPreferences } from '../hooks/useDashboardMetrics';
import { getVisibleDashboardCards, isDashboardViewEnabled, readDashboardPreferences } from './dashboardPreferenceUtils';
import { useAuthStore } from '../../../shared/store/authStore';
import { useTaskSummary } from '../../tasks/hooks/useTasks';

function CockpitCard(props: {
  title: string;
  subtitle?: string;
  tone?: 'danger' | 'warning' | 'calm' | 'info';
  children: React.ReactNode;
}) {
  const color = props.tone === 'danger' ? '#D32F2F' : props.tone === 'warning' ? '#b8621a' : props.tone === 'calm' ? '#2E7D32' : '#327C8D';
  return (
    <Paper variant="outlined" sx={{ p: 2.25, height: '100%', borderRadius: 3, borderColor: `${color}40` }}>
      <Typography variant="subtitle1" fontWeight={800} sx={{ color }}>
        {props.title}
      </Typography>
      {props.subtitle && (
        <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 1 }}>
          {props.subtitle}
        </Typography>
      )}
      {props.children}
    </Paper>
  );
}

export default function MyWorkCockpitPage(): React.ReactElement {
  const navigate = useNavigate();
  const staffId = useAuthStore((s) => s.user?.id);
  const { data: prefs } = useDashboardPreferences();
  const preferences = readDashboardPreferences(prefs?.preferences);
  const viewId = 'my_dashboard' as const;
  const enabled = isDashboardViewEnabled(preferences, viewId);
  const visible = new Set(getVisibleDashboardCards(preferences, viewId).map((card) => card.id));
  const { data } = useClinicianMetrics({ period: 'today' }, enabled);
  const { data: taskSummary } = useTaskSummary({ assignedToId: staffId });
  const urgentAlert = data?.overnightAlerts?.find((alert) => alert.severity === 'critical' || alert.severity === 'high');
  const compact = preferences.density === 'compact';

  return (
    <Box sx={{ p: { xs: 2, md: compact ? 2 : 3 }, bgcolor: '#F5F3F0', minHeight: '100vh' }}>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', gap: 2, flexWrap: 'wrap', mb: 2.5 }}>
        <Box>
          <Typography variant="h4" fontWeight={800} fontFamily="Albert Sans, sans-serif">
            My Work Cockpit
          </Typography>
          <Typography variant="body2" color="text.secondary">
            Today’s appointments, urgent clinical work, AI/notes follow-up, and safety tasks.
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

      <Grid container spacing={compact ? 1.5 : 2}>
        {visible.has('my-next-unsafe-thing') && (
          <Grid size={{ xs: 12 }}>
            <CockpitCard title="Next Unsafe Thing" tone={urgentAlert ? 'danger' : 'calm'} subtitle="Highest consequence first, not newest first.">
              {urgentAlert ? (
                <Box sx={{ display: 'flex', justifyContent: 'space-between', gap: 2, alignItems: 'center', flexWrap: 'wrap' }}>
                  <Box>
                    <Typography variant="h6" fontWeight={800}>
                      {urgentAlert.patientDisplayName}
                    </Typography>
                    <Typography variant="body2">{urgentAlert.summary}</Typography>
                    <Typography variant="caption" color="text.secondary">
                      Consequence: unresolved safety signal · Next action: open patient and review risk/safety plan.
                    </Typography>
                  </Box>
                  <Button variant="contained" color="error" onClick={() => navigate(`/patients/${urgentAlert.patientId}`)}>
                    Open patient
                  </Button>
                </Box>
              ) : (
                <Typography variant="body2" color="text.secondary">
                  No critical overnight risk signal is currently visible in your dashboard feed.
                </Typography>
              )}
            </CockpitCard>
          </Grid>
        )}

        {visible.has('my-snapshot') && (
          <Grid size={{ xs: 12, md: 6 }}>
            <CockpitCard title="Today" tone="info" subtitle="Your immediate clinical flow.">
              <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
                <Chip icon={<CalendarTodayIcon />} label={`${data?.todaysAppointments.length ?? 0} appointments`} />
                <Chip icon={<AssignmentIcon />} label={`${data?.openTasks ?? 0} open tasks`} />
                <Chip label={`${taskSummary?.totals.overdue ?? 0} overdue`} color={(taskSummary?.totals.overdue ?? 0) > 0 ? 'error' : 'default'} />
                <Chip label={`${data?.unreadMessages ?? 0} unread messages`} />
              </Box>
            </CockpitCard>
          </Grid>
        )}

        {visible.has('my-clinical-signals') && (
          <Grid size={{ xs: 12, md: 6 }}>
            <CockpitCard title="Clinical Signals" tone={(data?.overduePathologyResults ?? 0) > 0 ? 'danger' : 'warning'} subtitle="Safety work before routine work.">
              <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
                <Chip icon={<MedicalInformationIcon />} label={`${data?.overduePathologyResults ?? 0} overdue pathology`} color={(data?.overduePathologyResults ?? 0) > 0 ? 'error' : 'default'} />
                <Chip label={`${data?.newPathologyResults ?? 0} new results`} />
                <Chip label={`${data?.newReferrals ?? 0} new referrals`} />
              </Box>
            </CockpitCard>
          </Grid>
        )}

        {visible.has('my-upcoming-appointments') && (
          <Grid size={{ xs: 12, md: 6 }}>
            <CockpitCard title="Upcoming Appointments" subtitle="Click through to patient context before opening notes.">
              {(data?.todaysAppointments ?? []).length > 0 ? (
                (data?.todaysAppointments ?? []).slice(0, 8).map((appt) => (
                  <Box key={appt.id} sx={{ py: 0.75, borderBottom: '1px solid', borderColor: 'divider' }}>
                    <Typography variant="body2" fontWeight={700}>{appt.patientDisplayName}</Typography>
                    <Typography variant="caption" color="text.secondary">
                      {new Date(appt.startTime).toLocaleTimeString('en-AU', { hour: '2-digit', minute: '2-digit' })} · {appt.type}
                    </Typography>
                  </Box>
                ))
              ) : (
                <Typography variant="body2" color="text.secondary">No appointments loaded for today.</Typography>
              )}
            </CockpitCard>
          </Grid>
        )}

        {visible.has('my-task-list') && (
          <Grid size={{ xs: 12, md: 6 }}>
            <CockpitCard title="Action Queue" tone="warning" subtitle="Own the next step; avoid passive lists.">
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                <WarningAmberIcon sx={{ color: '#b8621a' }} />
                <Typography variant="body2">
                  {data?.openTasks ?? 0} open tasks, {taskSummary?.totals.dueToday ?? 0} due today, {taskSummary?.totals.waitingExternal ?? 0} waiting external.
                </Typography>
              </Box>
              <Button sx={{ mt: 1.5, textTransform: 'none' }} variant="outlined" onClick={() => navigate('/tasks')}>
                Open Tasks
              </Button>
            </CockpitCard>
          </Grid>
        )}
      </Grid>
    </Box>
  );
}
