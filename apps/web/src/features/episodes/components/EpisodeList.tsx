import { useState } from 'react';
import {
  Alert,
  Box,
  Button,
  CircularProgress,
  Divider,
  MenuItem,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import { useEpisodes }        from '../hooks/useEpisodes';
import { EpisodeCard }        from './EpisodeCard';
import { EpisodeForm }        from './EpisodeForm';
import type { EpisodeStatus } from '../types/episodeTypes';

interface Props {
  patientId: string;
  onSelect?: (episodeId: string) => void;
}

export const EpisodeList = ({ patientId, onSelect }: Props) => {
  const [statusFilter, setStatusFilter] = useState<EpisodeStatus | ''>('');
  const [showForm, setShowForm]         = useState(false);

  const { data, isLoading, isError, error } = useEpisodes(
    patientId,
    statusFilter ? { status: statusFilter } : undefined,
  );

  return (
    <Box>
      {/* Header */}
      <Stack
        direction="row"
        justifyContent="space-between"
        alignItems="center"
        mb={2}
      >
        <Typography
          fontFamily="Albert Sans, sans-serif"
          fontWeight={700}
          fontSize={16}
          color="#3D484B"
        >
          Episodes
        </Typography>

        <Stack direction="row" spacing={1.5} alignItems="center">
          <TextField
            select
            size="small"
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as EpisodeStatus | '')}
            sx={{ minWidth: 130, fontFamily: 'Albert Sans, sans-serif' }}
            label="Status"
          >
            <MenuItem value="">All</MenuItem>
            <MenuItem value="open">Open</MenuItem>
            <MenuItem value="onhold">On Hold</MenuItem>
            <MenuItem value="closed">Closed</MenuItem>
          </TextField>

          <Button
            size="small"
            variant="contained"
            startIcon={<AddIcon />}
            onClick={() => setShowForm(true)}
            sx={{
              fontFamily: 'Albert Sans, sans-serif',
              bgcolor: '#327C8D',
              '&:hover': { bgcolor: '#265f6d' },
              textTransform: 'none',
              borderRadius: 2,
            }}
          >
            New Episode
          </Button>
        </Stack>
      </Stack>

      <Divider sx={{ mb: 2 }} />

      {/* New Episode Form */}
      {showForm && (
        <Box mb={2}>
          <EpisodeForm
            patientId={patientId}
            onSuccess={() => setShowForm(false)}
            onCancel={() => setShowForm(false)}
          />
        </Box>
      )}

      {/* Loading */}
      {isLoading && (
        <Box display="flex" justifyContent="center" py={4}>
          <CircularProgress role="progressbar" aria-label="Loading" size={28} sx={{ color: '#327C8D' }} />
        </Box>
      )}

      {/* Error */}
      {isError && (
        <Alert role="alert" severity="error">
          {error instanceof Error ? error.message : 'Failed to load episodes.'}
        </Alert>
      )}

      {/* Empty */}
      {!isLoading && !isError && (!data?.data || data.data.length === 0) && (
        <Alert severity="info" sx={{ fontFamily: 'Albert Sans, sans-serif' }}>
          No episodes found. Create a new episode to get started.
        </Alert>
      )}

      {/* Episode cards */}
      {data?.data.map((episode) => (
        <EpisodeCard
          key={episode.id}
          episode={episode}
          onClick={onSelect ? () => onSelect(episode.id) : undefined}
        />
      ))}
    </Box>
  );
};
