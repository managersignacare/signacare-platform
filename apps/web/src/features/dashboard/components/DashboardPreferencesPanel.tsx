import React from 'react';
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  CircularProgress,
  Divider,
  FormControl,
  Grid,
  InputLabel,
  MenuItem,
  Paper,
  Select,
  Switch,
  Typography,
} from '@mui/material';
import LockIcon from '@mui/icons-material/Lock';
import OpenInNewIcon from '@mui/icons-material/OpenInNew';
import SettingsIcon from '@mui/icons-material/Settings';
import { useNavigate } from 'react-router-dom';
import type {
  DashboardDensity,
  DashboardLayoutMode,
  DashboardPreferences,
  DashboardViewId,
} from '@signacare/shared';
import {
  useDashboardPreferences,
  useUpdateDashboardPreferences,
} from '../hooks/useDashboardMetrics';
import {
  getDashboardCatalogForView,
  readDashboardPreferences,
  setDashboardCardHidden,
  setDashboardViewEnabled,
} from '../pages/dashboardPreferenceUtils';
import {
  DASHBOARD_OPTION_PRESENTATION,
  getDashboardOption,
} from '../pages/dashboardOptionCatalog';

const DASHBOARD_VIEW_IDS = Object.keys(DASHBOARD_OPTION_PRESENTATION) as DashboardViewId[];

const LAYOUT_LABELS: Record<DashboardLayoutMode, string> = {
  clinical_cockpit: 'Clinical cockpit',
  focus_today: 'Focus today',
  operations_command: 'Operations command',
};

export function DashboardPreferencesPanel(): React.ReactElement {
  const navigate = useNavigate();
  const { data, isLoading, isError } = useDashboardPreferences();
  const update = useUpdateDashboardPreferences();
  const [draft, setDraft] = React.useState<DashboardPreferences | null>(null);

  React.useEffect(() => {
    if (data?.preferences) {
      setDraft(readDashboardPreferences(data.preferences));
    }
  }, [data?.preferences]);

  const preferences = readDashboardPreferences(draft ?? data?.preferences);
  const catalog = data?.catalog ?? [];
  const isSaving = update.isPending;
  const currentDefaultView = preferences.defaultView ?? preferences.enabledViews[0] ?? 'my_dashboard';

  const save = async (next: DashboardPreferences) => {
    setDraft(next);
    await update.mutateAsync(next);
  };

  if (isLoading) {
    return (
      <Box display="flex" justifyContent="center" py={5}>
        <CircularProgress role="progressbar" aria-label="Loading dashboard options" />
      </Box>
    );
  }

  if (isError) {
    return (
      <Alert severity="warning">
        Dashboard options are temporarily unavailable. The existing dashboard remains unchanged.
      </Alert>
    );
  }

  return (
    <Box>
      <Paper variant="outlined" sx={{ p: 3, mb: 2 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, mb: 1 }}>
          <SettingsIcon sx={{ color: '#327C8D' }} />
          <Box>
            <Typography variant="h6" fontWeight={700}>
              Dashboard Options
            </Typography>
            <Typography variant="body2" color="text.secondary">
              Choose which dashboard replaces the default <code>/dashboard</code> landing view,
              then use the toggle chips on the dashboard itself to switch between enabled options.
            </Typography>
          </Box>
        </Box>
        <Alert severity="info" sx={{ mt: 2 }}>
          Safety-critical widgets are locked and cannot be hidden. Enabled dashboard options remain
          available as toggle chips inside the main dashboard.
        </Alert>
      </Paper>

      <Paper variant="outlined" sx={{ p: 2.5, mb: 2 }}>
        <Grid container spacing={2}>
          <Grid size={{ xs: 12, md: 4 }}>
            <FormControl fullWidth size="small">
              <InputLabel>Default dashboard option</InputLabel>
              <Select
                label="Default dashboard option"
                value={currentDefaultView}
                onChange={(event) => {
                  const next = readDashboardPreferences({
                    ...preferences,
                    defaultView: event.target.value as DashboardViewId,
                  });
                  void save(next);
                }}
              >
                {preferences.enabledViews.map((viewId) => {
                  const option = getDashboardOption(viewId);
                  return (
                    <MenuItem key={viewId} value={viewId}>
                      {option.title}
                    </MenuItem>
                  );
                })}
              </Select>
            </FormControl>
          </Grid>
          <Grid size={{ xs: 12, md: 3 }}>
            <FormControl fullWidth size="small">
              <InputLabel>Density</InputLabel>
              <Select
                label="Density"
                value={preferences.density}
                onChange={(event) => {
                  const next = readDashboardPreferences({
                    ...preferences,
                    density: event.target.value as DashboardDensity,
                  });
                  void save(next);
                }}
              >
                <MenuItem value="comfortable">Comfortable</MenuItem>
                <MenuItem value="compact">Compact</MenuItem>
              </Select>
            </FormControl>
          </Grid>
          <Grid size={{ xs: 12, md: 5 }}>
            <Button
              variant="contained"
              startIcon={<OpenInNewIcon />}
              disabled={preferences.enabledViews.length === 0}
              onClick={() => {
                const viewId = preferences.defaultView ?? preferences.enabledViews[0];
                if (!viewId) return;
                navigate('/dashboard');
              }}
              sx={{ textTransform: 'none', bgcolor: '#327C8D', '&:hover': { bgcolor: '#255F6B' } }}
            >
              Open selected default dashboard
            </Button>
          </Grid>
        </Grid>
      </Paper>

      <Grid container spacing={2}>
        {DASHBOARD_VIEW_IDS.map((viewId) => {
          const option = getDashboardOption(viewId);
          const enabled = preferences.enabledViews.includes(viewId);
          const isDefault = currentDefaultView === viewId;
          const cards = getDashboardCatalogForView(viewId);
          const viewPreference = preferences.viewPreferences[viewId];
          const hidden = new Set(viewPreference?.hiddenCardIds ?? []);
          const activeCount = cards.filter((card) => card.safetyCritical || !hidden.has(card.id)).length;
          const availableCount = catalog.filter((card) => card.viewId === viewId).length || cards.length;
          return (
            <Grid key={viewId} size={{ xs: 12, lg: 6 }}>
              <Card variant="outlined" sx={{ height: '100%' }}>
                <CardContent>
                  <Box sx={{ display: 'flex', justifyContent: 'space-between', gap: 1, mb: 1 }}>
                    <Box>
                      <Typography variant="subtitle1" fontWeight={800}>
                        {option.title}
                      </Typography>
                      <Typography variant="caption" color="text.secondary">
                        {option.persona}
                      </Typography>
                    </Box>
                    <Switch
                      checked={enabled}
                      disabled={preferences.enabledViews.length === 1 && enabled}
                      onChange={(_, checked) => {
                        const next = setDashboardViewEnabled(preferences, viewId, checked);
                        void save(readDashboardPreferences({
                          ...next,
                          defaultView: checked
                            ? viewId
                            : next.defaultView ?? next.enabledViews[0],
                        }));
                      }}
                      inputProps={{ 'aria-label': `Activate ${option.title}` }}
                    />
                  </Box>
                  <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
                    {option.description}
                  </Typography>
                  <Chip
                    size="small"
                    label={option.safetyFocus}
                    sx={{ mb: 1.5, bgcolor: '#FFF4E5', color: '#8A4B00', fontWeight: 700 }}
                  />
                  <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap', mb: 1.5 }}>
                    <Chip size="small" label={`${activeCount}/${availableCount} widgets active`} />
                    <Chip size="small" label={LAYOUT_LABELS[viewPreference?.layoutMode ?? 'clinical_cockpit']} />
                    {isDefault ? (
                      <Chip size="small" color="primary" label="Default landing dashboard" />
                    ) : null}
                  </Box>
                  <Divider sx={{ my: 1.5 }} />
                  {cards.map((card) => {
                    const visible = card.safetyCritical || !hidden.has(card.id);
                    return (
                      <Box
                        key={card.id}
                        sx={{
                          display: 'flex',
                          justifyContent: 'space-between',
                          alignItems: 'center',
                          gap: 1,
                          py: 0.75,
                          borderBottom: '1px solid',
                          borderColor: 'divider',
                        }}
                      >
                        <Box sx={{ minWidth: 0 }}>
                          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
                            <Typography variant="body2" fontWeight={700}>
                              {card.label}
                            </Typography>
                            {card.safetyCritical && (
                              <Chip
                                size="small"
                                icon={<LockIcon sx={{ fontSize: 13 }} />}
                                label="Locked"
                                sx={{ height: 20, fontSize: 10 }}
                              />
                            )}
                          </Box>
                          <Typography variant="caption" color="text.secondary">
                            {card.description}
                          </Typography>
                        </Box>
                        <Switch
                          checked={visible}
                          disabled={card.safetyCritical || !enabled || isSaving}
                          onChange={(_, checked) => {
                            void save(setDashboardCardHidden(preferences, viewId, card.id, !checked));
                          }}
                          inputProps={{ 'aria-label': `Show ${card.label}` }}
                        />
                      </Box>
                    );
                  })}
                  <Box sx={{ mt: 1.5, display: 'flex', gap: 1, flexWrap: 'wrap' }}>
                    <Button
                      size="small"
                      variant="outlined"
                      onClick={() => navigate(option.path)}
                      disabled={!enabled}
                      sx={{ textTransform: 'none' }}
                    >
                      Open
                    </Button>
                    <Button
                      size="small"
                      variant={isDefault ? 'contained' : 'text'}
                      onClick={() => {
                        if (isDefault) return;
                        void save(readDashboardPreferences({
                          ...preferences,
                          defaultView: viewId,
                        }));
                      }}
                      disabled={!enabled}
                      sx={{ textTransform: 'none' }}
                    >
                      {isDefault ? 'Default' : 'Use as default'}
                    </Button>
                  </Box>
                </CardContent>
              </Card>
            </Grid>
          );
        })}
      </Grid>
    </Box>
  );
}

export default DashboardPreferencesPanel;
