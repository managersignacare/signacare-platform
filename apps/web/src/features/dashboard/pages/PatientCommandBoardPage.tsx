import React from 'react';
import { Alert, Box, Button, Chip, Grid, Paper, Typography } from '@mui/material';
import { useNavigate } from 'react-router-dom';
import { useDashboardPreferences } from '../hooks/useDashboardMetrics';
import { isDashboardViewEnabled, readDashboardPreferences } from './dashboardPreferenceUtils';

export default function PatientCommandBoardPage(): React.ReactElement {
  const navigate = useNavigate();
  const { data: prefs } = useDashboardPreferences();
  const preferences = readDashboardPreferences(prefs?.preferences);
  const enabled = isDashboardViewEnabled(preferences, 'clinician');

  return (
    <Box sx={{ p: { xs: 2, md: 3 }, bgcolor: '#F5F3F0', minHeight: '100vh' }}>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', gap: 2, flexWrap: 'wrap', mb: 2.5 }}>
        <Box>
          <Typography variant="h4" fontWeight={800} fontFamily="Albert Sans, sans-serif">
            Patient Command Board
          </Typography>
          <Typography variant="body2" color="text.secondary">
            Patient-scoped cockpit model: safety spine, MDT owner, current episode, what changed, and next unsafe thing.
          </Typography>
        </Box>
        <Button variant="outlined" onClick={() => navigate('/patients')} sx={{ textTransform: 'none' }}>
          Open patient directory
        </Button>
      </Box>

      {!enabled && (
        <Alert severity="info" sx={{ mb: 2 }}>
          Patient command workflows remain available from patient records even if clinician signal dashboards are disabled.
        </Alert>
      )}

      <Grid container spacing={2}>
        {[
          ['Safety spine', 'Identity, allergies, current risk, MHA/CTO/legal status, active safety plan, meds monitoring, MDT owner.'],
          ['Next unsafe thing', 'The highest-consequence unresolved item, such as MHA expiry, clozapine ANC overdue, LAI overdue, or risk review due.'],
          ['What changed since last contact', 'New meds, risk changes, admissions, notes, letters, measures, tasks, or MDT decisions.'],
          ['Three-click actions', 'Start note/scribe, view meds/allergies, open risk plan, add task, book appointment, complete rating scale.'],
        ].map(([title, description]) => (
          <Grid key={title} size={{ xs: 12, md: 6 }}>
            <Paper variant="outlined" sx={{ p: 2.25, borderRadius: 3, height: '100%' }}>
              <Chip size="small" label="Patient cockpit" sx={{ mb: 1, bgcolor: '#E8F5F7', color: '#327C8D', fontWeight: 700 }} />
              <Typography variant="subtitle1" fontWeight={800}>{title}</Typography>
              <Typography variant="body2" color="text.secondary">{description}</Typography>
            </Paper>
          </Grid>
        ))}
      </Grid>
    </Box>
  );
}
