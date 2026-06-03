import { useState, useEffect, useCallback } from 'react';
import {
  Box, Button, Card, CardContent, Chip, CircularProgress, Dialog, DialogActions,
  DialogContent, DialogTitle, IconButton, Paper, Stack,
  Tooltip, Typography,
} from '@mui/material';
import DeleteIcon from '@mui/icons-material/Delete';
import EditIcon from '@mui/icons-material/Edit';
import MicIcon from '@mui/icons-material/Mic';
import DescriptionIcon from '@mui/icons-material/Description';
import PersonIcon from '@mui/icons-material/Person';
import OpenInNewIcon from '@mui/icons-material/OpenInNew';
import { useNavigate } from 'react-router-dom';
import { apiClient } from '../../../shared/services/apiClient';
import { unstyledButtonSx } from '../../../shared/styles/unstyledButton';
import { openEditableInNewWindow } from '../../../shared/utils/openInNewWindow';
import { useSessionStore } from '../../../shared/store/sessionStore';

interface Draft {
  id: string;
  patientId: string;
  patientName?: string;
  title: string;
  noteType: string;
  content: string;
  createdAt: string;
}

interface DraftNoteRow {
  id: string;
  patientId?: string;
  patient_id?: string;
  patientName?: string;
  patient_family_name?: string;
  patient_given_name?: string;
  title?: string;
  noteType?: string;
  content?: string;
  createdAt: string;
}

interface DraftsListEnvelope {
  data?: DraftNoteRow[];
}

type DraftsListResponse = DraftNoteRow[] | DraftsListEnvelope;

function extractDraftRows(response: DraftsListResponse): DraftNoteRow[] {
  if (Array.isArray(response)) return response;
  if (Array.isArray(response.data)) return response.data;
  return [];
}

const TYPE_COLORS: Record<string, string> = {
  progress: '#327C8D', assessment: '#b8621a', letter: '#1565C0',
  message: '#2E7D32', report: '#C62828', contact: '#7B1FA2',
  scribe: '#7B1FA2', phone: '#b8621a',
};

export default function DraftsPage() {
  const navigate = useNavigate();
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [loading, setLoading] = useState(true);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const setDraftCount = useSessionStore((s) => s.setDraftCount);

  const loadDrafts = useCallback(async () => {
    setLoading(true);
    try {
      const response = await apiClient.get<DraftsListResponse>('clinical-notes', { status: 'draft', limit: 50 });
      const notes = extractDraftRows(response);
      setDrafts(notes.map((n) => ({
        id: n.id,
        patientId: n.patientId || n.patient_id || '',
        patientName: n.patientName || `${n.patient_family_name || ''}, ${n.patient_given_name || ''}`.trim(),
        title: n.title || 'Untitled Draft',
        noteType: n.noteType || 'progress',
        content: n.content || '',
        createdAt: n.createdAt,
      })));
      setDraftCount(notes.length);
    } catch {
      setDrafts([]);
    } finally {
      setLoading(false);
    }
  }, [setDraftCount]);

  useEffect(() => { loadDrafts(); }, [loadDrafts]);

  const handleDelete = async (id: string) => {
    try { await apiClient.delete(`clinical-notes/${id}`); } catch { /* ignore */ }
    setDrafts(prev => prev.filter(d => d.id !== id));
    setDraftCount(Math.max(0, drafts.length - 1));
    setDeleteId(null);
  };

  const timeAgo = (ts: string) => {
    if (!ts) return '';
    const diff = Date.now() - new Date(ts).getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return 'just now';
    if (mins < 60) return `${mins}m ago`;
    const hours = Math.floor(mins / 60);
    if (hours < 24) return `${hours}h ago`;
    return `${Math.floor(hours / 24)}d ago`;
  };

  return (
    <Box sx={{ p: 3, maxWidth: 900, mx: 'auto' }}>
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 3 }}>
        <Box>
          <Typography variant="h5" fontWeight={700} fontFamily="Albert Sans, sans-serif">Drafts</Typography>
          <Typography variant="body2" color="text.secondary">Auto-saved work in progress. Click to resume.</Typography>
        </Box>
        <Button onClick={loadDrafts} disabled={loading} size="small" sx={{ textTransform: 'none', color: 'text.secondary' }}>
          {loading ? <CircularProgress role="progressbar" aria-label="Loading" size={16} /> : 'Refresh'}
        </Button>
      </Box>

      {!loading && drafts.length === 0 && (
        <Paper sx={{ p: 4, textAlign: 'center', bgcolor: '#f8f6f3' }}>
          <DescriptionIcon sx={{ fontSize: 48, color: '#ccc', mb: 1 }} />
          <Typography variant="h6" color="text.secondary">No drafts</Typography>
          <Typography variant="body2" color="text.secondary">Unsaved notes and scribe recordings will appear here.</Typography>
        </Paper>
      )}

      <Stack spacing={1.5}>
        {drafts.map(draft => {
          const openDraft = () => {
            if (!draft.patientId) return;
            const apiBase = (import.meta.env.VITE_API_URL as string) || '/api/v1';
            openEditableInNewWindow({
              title: draft.title || 'Untitled Draft',
              subtitle: `${draft.noteType} — ${draft.patientName ?? 'Patient'}`,
              content: draft.content || '',
              meta: { Type: draft.noteType, Patient: draft.patientName ?? '', Created: draft.createdAt ? new Date(draft.createdAt).toLocaleDateString('en-AU') : '' },
              patchUrl: `${apiBase}/patients/${draft.patientId}/notes/${draft.id}`,
            });
          };
          return (
          <Card key={draft.id} variant="outlined"
            sx={{ borderLeft: `4px solid ${TYPE_COLORS[draft.noteType] || '#327C8D'}`, '&:hover': { borderColor: TYPE_COLORS[draft.noteType] || '#327C8D', bgcolor: '#faf8f5' } }}>
            <CardContent sx={{ py: 1.5, px: 2, '&:last-child': { pb: 1.5 } }}>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
                <Box sx={{ width: 36, height: 36, borderRadius: 1, display: 'flex', alignItems: 'center', justifyContent: 'center',
                  bgcolor: (TYPE_COLORS[draft.noteType] || '#327C8D') + '15', color: TYPE_COLORS[draft.noteType] || '#327C8D' }}>
                  {draft.noteType === 'scribe' ? <MicIcon sx={{ fontSize: 18 }} /> : <DescriptionIcon sx={{ fontSize: 18 }} />}
                </Box>
                {/* Shape B′ sub-region trigger — left summary is the keyboard-
                    accessible target; right-side IconButtons are siblings. */}
                <Box
                  component="button"
                  type="button"
                  aria-label={`Open draft ${draft.title || 'Untitled'} (${draft.noteType}) for ${draft.patientName ?? 'patient'}`}
                  onClick={openDraft}
                  sx={{ flex: 1, minWidth: 0, ...unstyledButtonSx, '&:focus-visible': { outline: '2px solid #327C8D', outlineOffset: 2, borderRadius: 1 } }}>
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                    <Chip label="DRAFT" size="small" sx={{ fontSize: 9, height: 18, bgcolor: '#FFF3E0', color: '#E65100', fontWeight: 700 }} />
                    <Typography variant="body2" fontWeight={600} noWrap>{draft.title || 'Untitled Draft'}</Typography>
                    <Chip label={draft.noteType} size="small" sx={{ fontSize: 9, height: 18,
                      bgcolor: (TYPE_COLORS[draft.noteType] || '#327C8D') + '20', color: TYPE_COLORS[draft.noteType] || '#327C8D', fontWeight: 600 }} />
                  </Box>
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mt: 0.25 }}>
                    {draft.patientName && (
                      <Typography variant="caption" color="text.secondary" sx={{ display: 'flex', alignItems: 'center', gap: 0.25 }}>
                        <PersonIcon sx={{ fontSize: 12 }} /> {draft.patientName}
                      </Typography>
                    )}
                    <Typography variant="caption" color="text.secondary">{timeAgo(draft.createdAt)}</Typography>
                  </Box>
                  {draft.content && (
                    <Typography variant="caption" color="text.secondary" sx={{ mt: 0.5, display: 'block', fontSize: 11, fontFamily: 'monospace', bgcolor: '#FAFAFA', p: 0.75, borderRadius: 0.5, maxHeight: 40, overflow: 'hidden' }}>
                      {draft.content.substring(0, 120)}{draft.content.length > 120 ? '...' : ''}
                    </Typography>
                  )}
                </Box>
                <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.5, alignItems: 'center' }}>
                  <Tooltip title="Edit in new window">
                    <IconButton size="small" onClick={() => {
                      if (!draft.patientId) return;
                      const apiBase = (import.meta.env.VITE_API_URL as string) || '/api/v1';
                      openEditableInNewWindow({
                        title: draft.title || 'Untitled Draft',
                        subtitle: `${draft.noteType} — ${draft.patientName ?? 'Patient'}`,
                        content: draft.content || '',
                        meta: { Type: draft.noteType, Patient: draft.patientName ?? '' },
                        patchUrl: `${apiBase}/patients/${draft.patientId}/notes/${draft.id}`,
                      });
                    }} sx={{ color: '#327C8D' }}><EditIcon sx={{ fontSize: 18 }} /></IconButton>
                  </Tooltip>
                  <Tooltip title="Go to patient">
                    <IconButton size="small" onClick={() => draft.patientId && navigate(`/patients/${draft.patientId}?tab=episodes`)} sx={{ color: '#b8621a' }}><OpenInNewIcon sx={{ fontSize: 16 }} /></IconButton>
                  </Tooltip>
                  <Tooltip title="Delete draft">
                    <IconButton size="small" onClick={() => setDeleteId(draft.id)} sx={{ color: '#999', '&:hover': { color: '#D32F2F' } }}><DeleteIcon sx={{ fontSize: 18 }} /></IconButton>
                  </Tooltip>
                </Box>
              </Box>
            </CardContent>
          </Card>
          );
        })}
      </Stack>

      <Dialog aria-labelledby="dialog-title" open={!!deleteId} onClose={() => setDeleteId(null)} maxWidth="xs">
        <DialogTitle id="dialog-title">Delete Draft?</DialogTitle>
        <DialogContent><Typography variant="body2">This draft will be permanently deleted.</Typography></DialogContent>
        <DialogActions>
          <Button onClick={() => setDeleteId(null)}>Cancel</Button>
          <Button color="error" variant="contained" onClick={() => deleteId && handleDelete(deleteId)}>Delete</Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
