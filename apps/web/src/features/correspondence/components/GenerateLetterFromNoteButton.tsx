import { useState } from 'react';
import {
  Button, Dialog, DialogTitle, DialogContent, DialogActions, List, ListItemButton,
  ListItemText, Typography, CircularProgress, Box,
} from '@mui/material';
import DescriptionIcon from '@mui/icons-material/Description';
import { useQuery } from '@tanstack/react-query';
import { apiClient } from '../../../shared/services/apiClient';
import { correspondenceKeys } from '../queryKeys';

interface Props {
  patientId: string;
  episodeId?: string;
  onNoteContentLoaded: (content: string) => void;
}

interface NoteRow {
  id: string;
  episodeId?: string;
  episode_id?: string;
  title?: string;
  noteType?: string;
  content: string;
  status: string;
  createdAt: string;
  authorName?: string;
}

export function GenerateLetterFromNoteButton({ patientId, episodeId, onNoteContentLoaded }: Props) {
  const [open, setOpen] = useState(false);

  const { data: notes, isLoading } = useQuery<NoteRow[]>({
    queryKey: correspondenceKeys.patientNotesForLetter(patientId, episodeId),
    queryFn: async () => {
      const r = await apiClient.get<{ notes: NoteRow[] }>(`patients/${patientId}/notes`);
      const all = r.notes ?? [];
      return all
        .filter((n) => (episodeId ? n.episodeId === episodeId || n.episode_id === episodeId : true))
        .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
        .slice(0, 25);
    },
    enabled: open && !!patientId,
  });

  const handleSelect = (note: NoteRow) => {
    onNoteContentLoaded(note.content ?? '');
    setOpen(false);
  };

  return (
    <>
      <Button
        size="small"
        variant="outlined"
        startIcon={<DescriptionIcon />}
        onClick={() => setOpen(true)}
        sx={{ borderColor: '#327C8D', color: '#327C8D', textTransform: 'none' }}
      >
        From Note
      </Button>

      <Dialog open={open} onClose={() => setOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>Generate letter from a clinical note</DialogTitle>
        <DialogContent dividers>
          {isLoading && (
            <Box sx={{ display: 'flex', justifyContent: 'center', py: 3 }}>
              <CircularProgress size={28} />
            </Box>
          )}
          {!isLoading && (notes ?? []).length === 0 && (
            <Typography variant="body2" color="text.secondary">
              No notes found for this patient{episodeId ? ' in this episode' : ''}.
            </Typography>
          )}
          <List dense>
            {(notes ?? []).map((n) => (
              <ListItemButton key={n.id} onClick={() => handleSelect(n)}>
                <ListItemText
                  primary={n.title || (n.noteType ?? 'Note')}
                  secondary={`${new Date(n.createdAt).toLocaleDateString('en-AU')} — ${n.authorName ?? ''} — ${n.status}`}
                  primaryTypographyProps={{ fontSize: 14, fontWeight: 600 }}
                  secondaryTypographyProps={{ fontSize: 12 }}
                />
              </ListItemButton>
            ))}
          </List>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setOpen(false)}>Cancel</Button>
        </DialogActions>
      </Dialog>
    </>
  );
}

export default GenerateLetterFromNoteButton;
