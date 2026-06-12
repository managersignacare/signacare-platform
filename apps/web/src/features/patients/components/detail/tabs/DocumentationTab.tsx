import DescriptionIcon from '@mui/icons-material/Description';
import NotesIcon from '@mui/icons-material/Notes';
import PsychologyIcon from '@mui/icons-material/Psychology';
import RecordVoiceOverIcon from '@mui/icons-material/RecordVoiceOver';
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  CircularProgress,
  FormControl,
  Grid,
  InputLabel,
  MenuItem,
  Paper,
  Select,
  Stack,
  Typography,
} from '@mui/material';
import { useQuery } from '@tanstack/react-query';
import React from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { apiClient } from '../../../../../shared/services/apiClient';
import { AddNoteDialog } from '../../notes/AddNoteDialog';
import { episodesKeys } from '../../../queryKeys';

interface EpisodeOption {
  id: string;
  title?: string;
  episodeType?: string;
  status: string;
}

interface DocumentationTabProps {
  patientId: string;
}

export function DocumentationTab({ patientId }: DocumentationTabProps) {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const [selectedEpisodeId, setSelectedEpisodeId] = React.useState('');
  const [noteDialogOpen, setNoteDialogOpen] = React.useState(false);
  const [reportDialogOpen, setReportDialogOpen] = React.useState(false);

  const { data: episodes, isLoading } = useQuery({
    queryKey: episodesKeys.active(patientId),
    queryFn: () =>
      apiClient
        .get<{ data: EpisodeOption[] }>(`episodes/patient/${patientId}`)
        .then((response) => (response.data ?? []).filter((episode) => episode.status === 'open')),
    enabled: !!patientId,
    staleTime: 30_000,
  });

  React.useEffect(() => {
    if (!episodes?.length) {
      setSelectedEpisodeId('');
      return;
    }
    setSelectedEpisodeId((current) => {
      if (current && episodes.some((episode) => episode.id === current)) {
        return current;
      }
      return episodes[0].id;
    });
  }, [episodes]);

  React.useEffect(() => {
    const action = searchParams.get('docAction');
    if (!action || !episodes?.length) return;

    if (action === 'note') {
      setNoteDialogOpen(true);
    } else if (action === 'report') {
      setReportDialogOpen(true);
    }

    const next = new URLSearchParams(searchParams);
    next.delete('docAction');
    setSearchParams(next, { replace: true });
  }, [episodes, searchParams, setSearchParams]);

  const selectedEpisode = episodes?.find((episode) => episode.id === selectedEpisodeId) ?? null;
  const hasOpenEpisode = Boolean(episodes?.length);

  return (
    <Box>
      <Stack spacing={2.5}>
        <Box>
          <Typography variant="h6" fontWeight={700} fontFamily="Albert Sans, sans-serif">
            Documentation
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
            Write clinical notes and reports against the active episode. Saved notes and reports appear in the Episode timeline in chronological order.
          </Typography>
        </Box>

        {isLoading ? (
          <Box sx={{ display: 'flex', justifyContent: 'center', py: 4 }}>
            <CircularProgress size={24} />
          </Box>
        ) : null}

        {!isLoading && !hasOpenEpisode ? (
          <Alert severity="warning">
            Open an episode before creating documentation. The Episode tab is the source of truth for chronological note and report history.
          </Alert>
        ) : null}

        <Paper variant="outlined" sx={{ p: 2.5, borderRadius: 2 }}>
          <Stack spacing={2}>
            <FormControl size="small" sx={{ maxWidth: 380 }}>
              <InputLabel>Episode</InputLabel>
              <Select
                value={selectedEpisodeId}
                label="Episode"
                onChange={(event) => setSelectedEpisodeId(String(event.target.value))}
                disabled={!hasOpenEpisode}
              >
                {(episodes ?? []).map((episode) => (
                  <MenuItem key={episode.id} value={episode.id}>
                    {episode.title ?? 'Untitled Episode'} ({episode.episodeType ?? 'episode'})
                  </MenuItem>
                ))}
              </Select>
            </FormControl>

            <Grid container spacing={2}>
              <Grid size={{ xs: 12, md: 6 }}>
                <Card variant="outlined" sx={{ height: '100%' }}>
                  <CardContent sx={{ display: 'flex', flexDirection: 'column', gap: 1.5 }}>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                      <NotesIcon sx={{ color: '#b8621a' }} />
                      <Typography variant="subtitle1" fontWeight={700}>
                        Write Note
                      </Typography>
                    </Box>
                    <Typography variant="body2" color="text.secondary" sx={{ flex: 1 }}>
                      Add a manual clinical note to the selected episode. It will appear in the Episode timeline with other documentation and clinical events.
                    </Typography>
                    <Button
                      variant="contained"
                      disabled={!hasOpenEpisode}
                      onClick={() => setNoteDialogOpen(true)}
                      sx={{ alignSelf: 'flex-start', bgcolor: '#b8621a', '&:hover': { bgcolor: '#d6741f' } }}
                      startIcon={<NotesIcon />}
                    >
                      Write Note
                    </Button>
                  </CardContent>
                </Card>
              </Grid>

              <Grid size={{ xs: 12, md: 6 }}>
                <Card variant="outlined" sx={{ height: '100%' }}>
                  <CardContent sx={{ display: 'flex', flexDirection: 'column', gap: 1.5 }}>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                      <DescriptionIcon sx={{ color: '#327C8D' }} />
                      <Typography variant="subtitle1" fontWeight={700}>
                        Write Report
                      </Typography>
                    </Box>
                    <Typography variant="body2" color="text.secondary" sx={{ flex: 1 }}>
                      Add a structured report to the selected episode. Reports are stored in the same chronological Episode history as notes.
                    </Typography>
                    <Button
                      variant="outlined"
                      disabled={!hasOpenEpisode}
                      onClick={() => setReportDialogOpen(true)}
                      sx={{ alignSelf: 'flex-start', borderColor: '#327C8D', color: '#327C8D' }}
                      startIcon={<DescriptionIcon />}
                    >
                      Write Report
                    </Button>
                  </CardContent>
                </Card>
              </Grid>
            </Grid>

            <Alert severity="info" icon={<PsychologyIcon fontSize="inherit" />}>
              AI writing tools and Medical Scribe now live in the main sidebar under AI Assistant / Medical Scribe, not inside the note or report dialog.
            </Alert>

            <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
              <Button
                variant="text"
                startIcon={<PsychologyIcon />}
                onClick={() => navigate('/ai-agent')}
                sx={{ textTransform: 'none' }}
              >
                Open AI Assistant
              </Button>
              <Button
                variant="text"
                startIcon={<RecordVoiceOverIcon />}
                onClick={() => navigate('/agentic-scribe')}
                sx={{ textTransform: 'none' }}
              >
                Open Medical Scribe
              </Button>
              {selectedEpisode ? (
                <Typography variant="caption" color="text.secondary" sx={{ alignSelf: 'center', ml: 'auto' }}>
                  Current episode: {selectedEpisode.title ?? 'Untitled Episode'}
                </Typography>
              ) : null}
            </Box>
          </Stack>
        </Paper>
      </Stack>

      <AddNoteDialog
        open={noteDialogOpen}
        onClose={() => setNoteDialogOpen(false)}
        patientId={patientId}
        defaultEpisodeId={selectedEpisodeId || undefined}
        noteType="progress"
      />

      <AddNoteDialog
        open={reportDialogOpen}
        onClose={() => setReportDialogOpen(false)}
        patientId={patientId}
        defaultEpisodeId={selectedEpisodeId || undefined}
        noteType="report"
      />
    </Box>
  );
}

export default DocumentationTab;
