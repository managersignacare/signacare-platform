import React from 'react';
import {
  Alert,
  Box,
  Button,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  FormControl,
  InputLabel,
  MenuItem,
  Select,
  TextField,
  Typography,
} from '@mui/material';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { MarkdownRenderer } from './MarkdownRenderer';
import { apiClient } from '../../services/apiClient';
import { episodesKeys, patientsKeys } from '../../../features/patients/queryKeys';
import type { EpisodeOption } from '../../../features/patients/components/notes/AddNoteDialogSupport';

interface AiGeneratedNoteSaveDialogProps {
  open: boolean;
  patientId: string | null;
  content: string;
  defaultTitle: string;
  sourceKey: string;
  sourceLabel: string;
  onClose: () => void;
  onSaved?: (payload: { noteId?: string; episodeId: string }) => void;
}

interface NoteCreateResponse {
  note?: { id?: string };
  id?: string;
}

export function AiGeneratedNoteSaveDialog({
  open,
  patientId,
  content,
  defaultTitle,
  sourceKey,
  sourceLabel,
  onClose,
  onSaved,
}: AiGeneratedNoteSaveDialogProps) {
  const queryClient = useQueryClient();
  const normalizedPatientId = patientId?.trim() ?? '';
  const hasPatientId = normalizedPatientId.length > 0;
  const [title, setTitle] = React.useState(defaultTitle);
  const [episodeId, setEpisodeId] = React.useState('');
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState('');

  const { data: episodes = [], isLoading: episodesLoading } = useQuery({
    queryKey: episodesKeys.active(normalizedPatientId),
    queryFn: () =>
      apiClient
        .get<{ data: EpisodeOption[] }>(`episodes/patient/${normalizedPatientId}`)
        .then((response) => (response.data ?? []).filter((episode) => episode.status === 'open')),
    enabled: open && hasPatientId,
    staleTime: 30_000,
  });

  React.useEffect(() => {
    if (!open) return;
    setTitle(defaultTitle);
    setError('');
    setSaving(false);
  }, [defaultTitle, open]);

  React.useEffect(() => {
    if (!open) return;
    if (episodes.length === 0) {
      setEpisodeId('');
      return;
    }
    setEpisodeId((current) => {
      if (current && episodes.some((episode) => episode.id === current)) return current;
      return episodes[0]?.id ?? '';
    });
  }, [episodes, open]);

  const handleSave = async () => {
    if (!hasPatientId || !episodeId || !content.trim()) return;
    setSaving(true);
    setError('');
    try {
      const response = await apiClient.post<NoteCreateResponse>(`patients/${normalizedPatientId}/notes`, {
        episodeId,
        title: title.trim() || defaultTitle,
        noteType: 'progress',
        content,
        status: 'draft',
        isAiDraft: true,
        contactMeta: {
          aiGeneratedSource: sourceKey,
          aiGeneratedLabel: sourceLabel,
          aiGeneratedSavedAt: new Date().toISOString(),
        },
      });

      await Promise.all([
        queryClient.invalidateQueries({ queryKey: patientsKeys.notes(normalizedPatientId) }),
        queryClient.invalidateQueries({ queryKey: patientsKeys.notesByEpisode(normalizedPatientId, episodeId) }),
      ]);

      onSaved?.({ noteId: response.note?.id ?? response.id, episodeId });
      onClose();
    } catch (err: unknown) {
      if (
        typeof err === 'object' &&
        err !== null &&
        'message' in err &&
        typeof (err as { message?: unknown }).message === 'string'
      ) {
        setError((err as { message: string }).message);
      } else {
        setError('Failed to save AI output into the selected episode.');
      }
    } finally {
      setSaving(false);
    }
  };

  const saveDisabled =
    saving ||
    !hasPatientId ||
    !episodeId ||
    episodesLoading ||
    episodes.length === 0 ||
    content.trim().length === 0;

  return (
    <Dialog open={open} onClose={saving ? undefined : onClose} maxWidth="sm" fullWidth>
      <DialogTitle sx={{ fontWeight: 700 }}>Save AI Output to Episode</DialogTitle>
      <Divider />
      <DialogContent>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          This saves the AI-generated content as a draft clinical note inside the selected episode.
          Saving through this path also triggers the standard draft contact-record creation for follow-up review.
        </Typography>

        {!hasPatientId && (
          <Alert severity="warning" sx={{ mb: 2 }}>
            Select a patient before saving AI-generated content.
          </Alert>
        )}

        {hasPatientId && episodes.length === 0 && !episodesLoading && (
          <Alert severity="warning" sx={{ mb: 2 }}>
            No open episode is available for this patient. Open an episode first so the AI output can be saved into episode context.
          </Alert>
        )}

        {error && (
          <Alert severity="error" sx={{ mb: 2 }}>
            {error}
          </Alert>
        )}

        <FormControl fullWidth size="small" sx={{ mb: 2 }}>
          <InputLabel>Episode</InputLabel>
          <Select
            value={episodeId}
            onChange={(event) => setEpisodeId(event.target.value)}
            label="Episode"
            disabled={!hasPatientId || episodesLoading || episodes.length === 0}
          >
            {episodesLoading && <MenuItem disabled value="">Loading episodes…</MenuItem>}
            {!episodesLoading && episodes.length === 0 && <MenuItem disabled value="">No open episodes</MenuItem>}
            {episodes.map((episode) => (
              <MenuItem key={episode.id} value={episode.id}>
                {episode.title || episode.episodeType || 'Open episode'}
              </MenuItem>
            ))}
          </Select>
        </FormControl>

        <TextField
          label="Note Title"
          fullWidth
          size="small"
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          sx={{ mb: 2 }}
        />

        <Typography variant="caption" color="text.secondary">
          Content preview
        </Typography>
        <Box
          sx={{
            maxHeight: 220,
            overflowY: 'auto',
            bgcolor: '#FAFAFA',
            p: 1.5,
            borderRadius: 1,
            mt: 0.5,
            border: '1px solid #eee',
          }}
        >
          <MarkdownRenderer content={content.length > 1200 ? `${content.slice(0, 1200)}\n\n...` : content} />
        </Box>
      </DialogContent>
      <DialogActions sx={{ px: 3, py: 2 }}>
        <Button onClick={onClose} disabled={saving} sx={{ color: 'text.secondary' }}>
          Cancel
        </Button>
        <Button
          variant="contained"
          onClick={() => void handleSave()}
          disabled={saveDisabled}
          sx={{ bgcolor: '#327C8D', '&:hover': { bgcolor: '#265f6d' } }}
        >
          {saving ? <CircularProgress size={16} sx={{ color: '#fff' }} /> : 'Save to Episode'}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
