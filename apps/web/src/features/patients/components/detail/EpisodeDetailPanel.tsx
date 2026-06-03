// apps/web/src/features/patients/components/detail/EpisodeDetailPanel.tsx
import {
  Box,
  Chip,
  Divider,
  Grid,
  Paper,
  Typography,
} from '@mui/material';

export interface EpisodeSummary {
  id: string;
  episodeNumber: string;
  episodeType: string;
  status: string;
  startDate: string;
  endDate?: string | null;
  primaryDiagnosis?: string | null;
  keyClinician?: string | null;
}

interface EpisodeDetailPanelProps {
  episode: EpisodeSummary;
}

const STATUS_COLOUR: Record<string, 'success' | 'warning' | 'error' | 'default'> = {
  active:      'success',
  onhold:      'warning',
  closed:      'default',
  transferred: 'error',
};

export const EpisodeDetailPanel: React.FC<EpisodeDetailPanelProps> = ({ episode }) => {
  const formatDate = (d?: string | null) =>
    d ? new Date(d).toLocaleDateString('en-AU') : '—';

  return (
    <Paper
      elevation={0}
      sx={{
        border: '1px solid',
        borderColor: 'divider',
        borderRadius: 2,
        p: 2.5,
      }}
    >
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', mb: 2 }}>
        <Box>
          <Typography variant="subtitle1" fontWeight={600} fontFamily="Albert Sans, sans-serif">
            Episode {episode.episodeNumber}
          </Typography>
          <Typography variant="caption" color="text.secondary" fontFamily="Albert Sans, sans-serif">
            {episode.episodeType}
          </Typography>
        </Box>
        <Chip
          label={episode.status}
          size="small"
          color={STATUS_COLOUR[episode.status] ?? 'default'}
          sx={{ textTransform: 'capitalize', fontFamily: 'Albert Sans, sans-serif' }}
        />
      </Box>
      <Divider sx={{ mb: 2 }} />
      <Grid container spacing={2}>
        <Grid>
          <Typography variant="caption" color="text.secondary" fontFamily="Albert Sans, sans-serif" display="block">
            Start Date
          </Typography>
          <Typography variant="body2" fontFamily="Albert Sans, sans-serif">
            {formatDate(episode.startDate)}
          </Typography>
        </Grid>
        <Grid>
          <Typography variant="caption" color="text.secondary" fontFamily="Albert Sans, sans-serif" display="block">
            End Date
          </Typography>
          <Typography variant="body2" fontFamily="Albert Sans, sans-serif">
            {formatDate(episode.endDate)}
          </Typography>
        </Grid>
        <Grid>
          <Typography variant="caption" color="text.secondary" fontFamily="Albert Sans, sans-serif" display="block">
            Primary Diagnosis
          </Typography>
          <Typography variant="body2" fontFamily="Albert Sans, sans-serif">
            {episode.primaryDiagnosis ?? '—'}
          </Typography>
        </Grid>
        <Grid>
          <Typography variant="caption" color="text.secondary" fontFamily="Albert Sans, sans-serif" display="block">
            Key Clinician
          </Typography>
          <Typography variant="body2" fontFamily="Albert Sans, sans-serif">
            {episode.keyClinician ?? '—'}
          </Typography>
        </Grid>
      </Grid>
    </Paper>
  );
};
