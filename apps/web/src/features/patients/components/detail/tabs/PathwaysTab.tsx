import { useState } from 'react';
import {
  Alert, Box, Button, Chip, CircularProgress, Dialog, DialogActions, DialogContent,
  DialogTitle, Divider, FormControl, Grid, InputLabel, LinearProgress, MenuItem,
  Paper, Select, TextField, Typography,
} from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import { AddNoteDialog } from '../../notes/AddNoteDialog';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '../../../../../shared/services/apiClient';
import { useAuthStore } from '../../../../../shared/store/authStore';
import { patientPathwaysKeys, patientsKeys } from '../../../queryKeys';
import PathwayDigitalCareDialog from '../../../../../features/treatment-pathways/components/PathwayDigitalCareDialog';

const PATHWAY_TEMPLATES = [
  { type: 'cbt', name: 'Cognitive Behavioural Therapy (CBT)', sessions: 12, color: '#327C8D' },
  { type: 'dbt', name: 'Dialectical Behaviour Therapy (DBT)', sessions: 24, color: '#7B5EA7' },
  { type: 'act', name: 'Acceptance & Commitment Therapy (ACT)', sessions: 10, color: '#2E7D32' },
  { type: 'emdr', name: 'EMDR', sessions: 12, color: '#1565C0' },
  { type: 'ipp', name: 'Interpersonal Psychotherapy (IPP)', sessions: 16, color: '#E65100' },
  { type: 'schema', name: 'Schema Therapy', sessions: 20, color: '#6D4C41' },
  { type: 'cat', name: 'Cognitive Analytic Therapy (CAT)', sessions: 16, color: '#00695C' },
  { type: 'other', name: 'Other', sessions: 12, color: '#999' },
];

interface Pathway {
  id: string;
  pathwayType: string;
  pathwayName: string;
  totalSessions: number;
  completedSessions: number;
  status: string;
  startDate: string;
  endDate?: string;
  clinicianName?: string;
  notes?: string;
  // BUG-402 — REQUIRED echo for opt-locked PATCH / POST /:id/session.
  // R-FIX-BUG-402-FRONTEND-PATHWAYSTAB
  lockVersion: number;
}

interface PathwaysResponse {
  data?: Pathway[];
}

interface CreatePathwayInput {
  patientId: string;
  clinician_id?: string;
  pathwayType: string;
  pathwayName: string;
  totalSessions: number;
  startDate: string;
  notes?: string;
}

interface UpdatePathwayInput {
  id: string;
  status?: string;
  endDate?: string;
  completedSessions?: number;
  expectedLockVersion: number;
}

interface PatientPathwayNote {
  id: string;
  title?: string;
  content?: string;
  createdAt?: string;
  authorName?: string;
}

interface PatientNotesResponse {
  notes?: PatientPathwayNote[];
}

function getErrorMessage(error: unknown, fallback: string): string {
  if (typeof error === 'object' && error !== null) {
    const maybeError = error as { response?: { data?: { error?: string; code?: string } }; message?: string; code?: string };
    return maybeError.response?.data?.error ?? maybeError.message ?? fallback;
  }
  return fallback;
}

interface PathwaysTabProps { patientId: string }
export function PathwaysTab({ patientId }: PathwaysTabProps) {
  const qc = useQueryClient();
  const user = useAuthStore(s => s.user);
  const [addOpen, setAddOpen] = useState(false);
  const [pathwayType, setPathwayType] = useState('cbt');
  const [customName, setCustomName] = useState('');
  const [totalSessions, setTotalSessions] = useState(12);
  const [notes, setNotes] = useState('');
  const [startDate, setStartDate] = useState(new Date().toISOString().split('T')[0]);

  const { data: pathways, isLoading } = useQuery({
    queryKey: patientPathwaysKeys.byPatient(patientId),
    queryFn: () => apiClient.get<Pathway[] | PathwaysResponse>(`pathways/patient/${patientId}`).then(r => {
      if (Array.isArray(r)) return r;
      if (r && Array.isArray(r.data)) return r.data;
      return [];
    }).catch((err) => { console.warn('PathwaysTab: query failed', err); return []; }),
    enabled: !!patientId,
  });

  const [saveError, setSaveError] = useState('');

  const createMut = useMutation({
    mutationFn: (data: CreatePathwayInput) => apiClient.post('pathways', data),
    onSuccess: () => { qc.invalidateQueries({ queryKey: patientPathwaysKeys.byPatient(patientId) }); setAddOpen(false); setSaveError(''); },
    onError: (err: unknown) => setSaveError(getErrorMessage(err, 'Failed to save pathway')),
  });

  const updateMut = useMutation({
    mutationFn: ({ id, ...data }: UpdatePathwayInput) => apiClient.patch(`pathways/${id}`, data),
    onSuccess: () => qc.invalidateQueries({ queryKey: patientPathwaysKeys.byPatient(patientId) }),
    // BUG-402 — surface 409 conflict explicitly so user retries with fresh state
    onError: (err: unknown) => {
      const maybeError = err as { response?: { data?: { code?: string } }; code?: string };
      const code = maybeError.response?.data?.code ?? maybeError.code;
      if (code === 'OPTIMISTIC_LOCK_CONFLICT') {
        setSaveError('Someone else just updated this pathway. Please refresh and try again.');
        qc.invalidateQueries({ queryKey: patientPathwaysKeys.byPatient(patientId) });
      } else {
        setSaveError(getErrorMessage(err, 'Failed to update pathway'));
      }
    },
  });

  const template = PATHWAY_TEMPLATES.find(t => t.type === pathwayType);

  const handleCreate = () => {
    const name = pathwayType === 'other' ? customName : template?.name ?? customName;
    if (!name.trim()) return;
    createMut.mutate({
      patientId: patientId,
      clinician_id: user?.id,
      pathwayType: pathwayType,
      pathwayName: name,
      totalSessions: totalSessions,
      startDate: startDate,
      notes: notes.trim() || undefined,
    });
  };

  const [sessionNoteOpen, setSessionNoteOpen] = useState(false);
  const [sessionPathway, setSessionPathway] = useState<Pathway | null>(null);
  const [digitalPathway, setDigitalPathway] = useState<Pathway | null>(null);

  const handleRecordSession = (pathway: Pathway) => {
    setSessionPathway(pathway);
    setSessionNoteOpen(true);
  };

  // BUG-402 — every mutation echoes the lockVersion the client read.
  // The server's opt-lock predicate rejects (409) any stale call.
  const handleComplete = (pathway: Pathway) => {
    updateMut.mutate({
      id: pathway.id,
      status: 'completed',
      endDate: new Date().toISOString().split('T')[0],
      expectedLockVersion: pathway.lockVersion,
    });
  };

  const handleDiscontinue = (pathway: Pathway) => {
    updateMut.mutate({
      id: pathway.id,
      status: 'discontinued',
      endDate: new Date().toISOString().split('T')[0],
      expectedLockVersion: pathway.lockVersion,
    });
  };

  const active = (pathways ?? []).filter((p: Pathway) => p.status === 'active');
  const completed = (pathways ?? []).filter((p: Pathway) => p.status !== 'active');

  if (isLoading) return <CircularProgress role="progressbar" aria-label="Loading" size={24} />;

  return (
    <Box>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
        <Typography variant="h6" fontWeight={600} fontFamily="Albert Sans, sans-serif">Treatment Pathways</Typography>
        <Button startIcon={<AddIcon />} variant="contained" size="small" onClick={() => setAddOpen(true)}
          sx={{ bgcolor: '#b8621a', '&:hover': { bgcolor: '#d6741f' }, textTransform: 'none' }}>
          New Pathway
        </Button>
      </Box>

      {active.length === 0 && completed.length === 0 && (
        <Alert severity="info">No treatment pathways recorded. Click New Pathway to start one.</Alert>
      )}

      {/* Active Pathways */}
      {active.map((p: Pathway) => {
        const tmpl = PATHWAY_TEMPLATES.find(t => t.type === p.pathwayType);
        const progress = p.totalSessions > 0 ? Math.round((p.completedSessions / p.totalSessions) * 100) : 0;
        const color = tmpl?.color ?? '#999';

        return (
          <Paper key={p.id} variant="outlined" sx={{ p: 2, mb: 1.5, borderLeft: `4px solid ${color}` }}>
            <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', mb: 1 }}>
              <Box>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                  <Typography variant="subtitle2" fontWeight={700}>{p.pathwayName}</Typography>
                  <Chip label={p.pathwayType.toUpperCase()} size="small" sx={{ fontSize: 9, height: 18, bgcolor: `${color}20`, color, fontWeight: 700 }} />
                </Box>
                <Typography variant="caption" color="text.secondary">
                  Started {new Date(p.startDate).toLocaleDateString('en-AU')}
                  {p.clinicianName && ` — ${p.clinicianName}`}
                </Typography>
              </Box>
              <Box sx={{ display: 'flex', gap: 0.5 }}>
                <Button size="small" variant="outlined" onClick={() => setDigitalPathway(p)}
                  sx={{ fontSize: 11, textTransform: 'none' }}>
                  Digital Care
                </Button>
                <Button size="small" variant="outlined" onClick={() => handleRecordSession(p)}
                  sx={{ fontSize: 11, textTransform: 'none', borderColor: color, color }}>
                  + Session ({p.completedSessions}/{p.totalSessions})
                </Button>
                {p.completedSessions >= p.totalSessions && (
                  <Button size="small" variant="contained" startIcon={<CheckCircleIcon sx={{ fontSize: 14 }} />}
                    onClick={() => handleComplete(p)}
                    sx={{ fontSize: 11, textTransform: 'none', bgcolor: '#2E7D32', '&:hover': { bgcolor: '#1B5E20' } }}>
                    Complete
                  </Button>
                )}
                <Button size="small" variant="text" onClick={() => handleDiscontinue(p)}
                  sx={{ fontSize: 11, textTransform: 'none', color: '#D32F2F' }}>
                  Discontinue
                </Button>
              </Box>
            </Box>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
              <LinearProgress variant="determinate" value={progress} sx={{
                flex: 1, height: 8, borderRadius: 4,
                bgcolor: '#eee',
                '& .MuiLinearProgress-bar': { bgcolor: progress >= 100 ? '#2E7D32' : color, borderRadius: 4 },
              }} />
              <Typography variant="caption" fontWeight={600} sx={{ minWidth: 35, color }}>{progress}%</Typography>
            </Box>
            {p.notes && <Typography variant="caption" color="text.secondary" sx={{ mt: 0.5, display: 'block' }}>{p.notes}</Typography>}
            <PathwaySessionNotes patientId={patientId} pathwayName={p.pathwayName ?? p.pathwayType} />
          </Paper>
        );
      })}

      {/* Completed / Discontinued */}
      {completed.length > 0 && (
        <Box sx={{ mt: 3 }}>
          <Typography variant="subtitle2" fontWeight={600} color="text.secondary" sx={{ mb: 1 }}>
            Past Pathways ({completed.length})
          </Typography>
          {completed.map((p: Pathway) => {
            const tmpl = PATHWAY_TEMPLATES.find(t => t.type === p.pathwayType);
            return (
              <Paper key={p.id} variant="outlined" sx={{ p: 1.5, mb: 1, opacity: 0.7, borderLeft: `4px solid ${tmpl?.color ?? '#999'}` }}>
                <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                    <Typography variant="body2" fontWeight={600}>{p.pathwayName}</Typography>
                    <Chip label={p.status} size="small"
                      color={p.status === 'completed' ? 'success' : 'default'}
                      sx={{ fontSize: 9, height: 18, textTransform: 'capitalize' }} />
                  </Box>
                  <Typography variant="caption" color="text.secondary">
                    {p.completedSessions}/{p.totalSessions} sessions
                    {p.endDate && ` — Ended ${new Date(p.endDate).toLocaleDateString('en-AU')}`}
                  </Typography>
                </Box>
              </Paper>
            );
          })}
        </Box>
      )}

      {/* New Pathway Dialog */}
      <Dialog aria-labelledby="dialog-title" open={addOpen} onClose={() => setAddOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle id="dialog-title" sx={{ fontWeight: 700, color: '#3D484B' }}>New Treatment Pathway</DialogTitle>
        <Divider />
        <DialogContent sx={{ pt: 2 }}>
          <Grid container spacing={2}>
            <Grid size={{ xs: 12, sm: 6 }}>
              <FormControl fullWidth size="small">
                <InputLabel>Pathway Type</InputLabel>
                <Select value={pathwayType} onChange={e => {
                  setPathwayType(e.target.value);
                  const t = PATHWAY_TEMPLATES.find(pt => pt.type === e.target.value);
                  if (t) setTotalSessions(t.sessions);
                }} label="Pathway Type">
                  {PATHWAY_TEMPLATES.map(t => (
                    <MenuItem key={t.type} value={t.type}>
                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                        <Box sx={{ width: 8, height: 8, borderRadius: '50%', bgcolor: t.color }} />
                        {t.name} ({t.sessions} sessions)
                      </Box>
                    </MenuItem>
                  ))}
                </Select>
              </FormControl>
            </Grid>
            <Grid size={{ xs: 6, sm: 3 }}>
              <TextField label="Total Sessions" size="small" fullWidth type="number" value={totalSessions}
                onChange={e => setTotalSessions(parseInt(e.target.value, 10) || 12)}
                slotProps={{ htmlInput: { min: 1, max: 100 } }} />
            </Grid>
            <Grid size={{ xs: 6, sm: 3 }}>
              <TextField label="Start Date" size="small" fullWidth type="date" value={startDate}
                onChange={e => setStartDate(e.target.value)} slotProps={{ inputLabel: { shrink: true } }} />
            </Grid>
            {pathwayType === 'other' && (
              <Grid size={{ xs: 12 }}>
                <TextField label="Pathway Name *" size="small" fullWidth value={customName}
                  onChange={e => setCustomName(e.target.value)} placeholder="e.g. Motivational Interviewing" />
              </Grid>
            )}
            <Grid size={{ xs: 12 }}>
              <TextField label="Notes" size="small" fullWidth multiline rows={2} value={notes}
                onChange={e => setNotes(e.target.value)} placeholder="Goals, focus areas, etc." />
            </Grid>
          </Grid>
        {saveError && <Alert role="alert" severity="error" sx={{ mx: 3, mb: 1 }}>{saveError}</Alert>}
        </DialogContent>
        <Divider />
        <DialogActions sx={{ px: 3, py: 2 }}>
          <Button onClick={() => { setAddOpen(false); setSaveError(''); }} sx={{ color: 'text.secondary', textTransform: 'none' }}>Cancel</Button>
          <Button variant="contained" onClick={handleCreate} disabled={createMut.isPending}
            sx={{ bgcolor: '#b8621a', '&:hover': { bgcolor: '#d6741f' }, textTransform: 'none' }}>
            {createMut.isPending ? 'Saving...' : 'Start Pathway'}
          </Button>
        </DialogActions>
      </Dialog>

      {/* Session Note Dialog */}
      <AddNoteDialog
        open={sessionNoteOpen}
        onClose={() => setSessionNoteOpen(false)}
        patientId={patientId}
        noteType="progress"
        defaultContent={sessionPathway ? `**Treatment Pathway Session** — ${sessionPathway.pathwayName ?? sessionPathway.pathwayType}\nSession ${(sessionPathway.completedSessions ?? 0) + 1} of ${sessionPathway.totalSessions ?? '?'}\n\n` : ''}
        onSaved={() => {
          if (sessionPathway) {
            // BUG-402 — echo lockVersion. Server-side does the canonical
            // +1 increment via /:id/session; this PATCH path stays
            // opt-locked too so two concurrent "saved" callbacks cannot
            // both win.
            updateMut.mutate({
              id: sessionPathway.id,
              completedSessions: (sessionPathway.completedSessions ?? 0) + 1,
              expectedLockVersion: sessionPathway.lockVersion,
            });
          }
          setSessionNoteOpen(false);
          setSessionPathway(null);
        }}
      />

      {digitalPathway && (
        <PathwayDigitalCareDialog
          open={!!digitalPathway}
          pathwayId={digitalPathway.id}
          pathwayName={digitalPathway.pathwayName ?? digitalPathway.pathwayType}
          onClose={() => setDigitalPathway(null)}
        />
      )}
    </Box>
  );
}

// Session notes for a specific pathway
function PathwaySessionNotes({ patientId, pathwayName }: { patientId: string; pathwayName: string }) {
  const { data: notes } = useQuery({
    queryKey: patientsKeys.notesPathway(patientId, pathwayName),
    queryFn: () => apiClient.get<PatientPathwayNote[] | PatientNotesResponse>(`patients/${patientId}/notes`).then(r => {
      const all: PatientPathwayNote[] = Array.isArray(r) ? r : r.notes ?? [];
      return all.filter((n: PatientPathwayNote) => (n.content ?? '').includes(pathwayName));
    }),
    enabled: !!patientId && !!pathwayName,
  });
  if (!notes?.length) return null;
  return (
    <Box sx={{ mt: 1.5, pt: 1, borderTop: '1px solid #E0E0E0' }}>
      <Typography variant="caption" fontWeight={600} color="text.secondary" sx={{ mb: 0.5, display: 'block' }}>Session Notes ({notes.length})</Typography>
      {notes.map((n: PatientPathwayNote) => (
        <Box key={n.id} sx={{ display: 'flex', gap: 1, py: 0.3, borderBottom: '1px solid #f5f5f5' }}>
          <Typography variant="caption" color="text.secondary" sx={{ minWidth: 80 }}>
            {n.createdAt ? new Date(n.createdAt).toLocaleDateString('en-AU') : '—'}
          </Typography>
          <Typography variant="caption" sx={{ flex: 1 }}>{n.title || 'Session Note'}</Typography>
          <Typography variant="caption" color="text.secondary">{n.authorName || ''}</Typography>
        </Box>
      ))}
    </Box>
  );
}

export default PathwaysTab;
