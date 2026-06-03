import CommentIcon from '@mui/icons-material/Comment';
import NoteAddIcon from '@mui/icons-material/NoteAdd';
import ReportProblemIcon from '@mui/icons-material/ReportProblem';
import SendIcon from '@mui/icons-material/Send';
import {
    Alert, Box, Button, Chip, CircularProgress, Dialog, DialogActions, DialogContent, DialogTitle, Divider,
    FormControl, Grid, InputLabel, MenuItem, Paper, Select, TextField, Typography
} from '@mui/material';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { apiClient } from '../../../../../shared/services/apiClient';
import { episodesKeys, incidentsKeys, patientsKeys } from '../../../queryKeys';

// ── Incident classifications (Australian health/MH context) ──────────────────

const INCIDENT_TYPES = [
  'Aggression / Violence towards staff',
  'Aggression / Violence towards other patients',
  'Self-harm (non-suicidal)',
  'Suicide attempt',
  'Absconding / Elopement',
  'Falls',
  'Medication error',
  'Medication adverse reaction',
  'Restraint — physical',
  'Restraint — mechanical',
  'Seclusion',
  'Rapid tranquilisation',
  'Near-miss (clinical)',
  'Equipment failure / environment hazard',
  'Breach of privacy / confidentiality',
  'Complaint — patient / family',
  'Unexpected clinical deterioration',
  'Sentinel event',
  'Other',
];

const SEVERITY_LEVELS = [
  { value: 'low',      label: 'Low',      color: '#2E7D32', bg: '#E8F5E9' },
  { value: 'moderate', label: 'Moderate', color: '#E65100', bg: '#FFF3E0' },
  { value: 'high',     label: 'High',     color: '#C62828', bg: '#FFEBEE' },
  { value: 'critical', label: 'Critical', color: '#6A1B9A', bg: '#F3E5F5' },
];

const INCIDENT_OUTCOMES = [
  'No harm', 'Minor harm — no treatment required', 'Moderate harm — treatment required',
  'Severe harm — hospitalisation / ICU', 'Death', 'Near-miss — potential harm averted',
];

const INCIDENT_STATUSES = ['open', 'under_review', 'closed'];

interface IncidentNote {
  id: string; title: string; noteType: string; content: string; status: string;
  authorName: string; authorSignature?: string; createdAt: string; episodeTitle?: string;
}

interface EpisodeOption {
  id: string;
  title: string;
  status?: string;
}

function getErrorMessage(error: unknown, fallback: string): string {
  if (typeof error === 'object' && error !== null) {
    const maybeError = error as { response?: { data?: { error?: string } }; message?: string };
    return maybeError.response?.data?.error ?? maybeError.message ?? fallback;
  }
  return fallback;
}

// ── Parse structured incident data from note content ──────────────────────────
function parseIncidentMeta(content: string): { type?: string; severity?: string; outcome?: string } {
  const get = (key: string) => {
    const m = content.match(new RegExp(`${key}:\\s*(.+)`));
    return m?.[1]?.trim();
  };
  return { type: get('Incident Type'), severity: get('Severity'), outcome: get('Outcome') };
}

function severityConfig(value?: string) {
  return SEVERITY_LEVELS.find(s => s.value === value?.toLowerCase()) ?? SEVERITY_LEVELS[0];
}

// ── Add Incident Dialog ───────────────────────────────────────────────────────

interface AddIncidentDialogProps { open: boolean; patientId: string; onClose: () => void; onSaved: () => void; }
function AddIncidentDialog({ open, patientId, onClose, onSaved }: AddIncidentDialogProps) {
  const qc = useQueryClient();
  const [incidentType, setIncidentType]   = useState(INCIDENT_TYPES[0]);
  const [severity, setSeverity]           = useState('moderate');
  const [outcome, setOutcome]             = useState(INCIDENT_OUTCOMES[0]);
  const [incidentDate, setIncidentDate]   = useState(new Date().toISOString().slice(0, 16));
  const [location, setLocation]           = useState('');
  const [description, setDescription]     = useState('');
  const [actionsTaken, setActionsTaken]   = useState('');
  const [followUp, setFollowUp]           = useState('');
  const [incidentStatus, setIncidentStatus] = useState('open');
  const [error, setError]                 = useState('');

  const { data: episodes } = useQuery({
    queryKey: episodesKeys.active(patientId),
    queryFn: () => apiClient.get<{ data: EpisodeOption[] }>(`episodes/patient/${patientId}`).then(r => (r.data ?? []).filter((e) => e.status === 'open')),
    enabled: !!patientId,
  });
  const [episodeId, setEpisodeId] = useState('');

  const svConfig = severityConfig(severity);

  const saveMut = useMutation({
    mutationFn: (status: string) => {
      const content = [
        `Incident Type: ${incidentType}`,
        `Severity: ${severity.charAt(0).toUpperCase() + severity.slice(1)}`,
        `Incident Date/Time: ${new Date(incidentDate).toLocaleString('en-AU')}`,
        `Location: ${location || 'Not specified'}`,
        `Outcome: ${outcome}`,
        `Incident Status: ${incidentStatus}`,
        '',
        '=== DESCRIPTION ===',
        description,
        '',
        '=== IMMEDIATE ACTIONS TAKEN ===',
        actionsTaken,
        '',
        '=== FOLLOW-UP REQUIRED ===',
        followUp,
      ].join('\n');
      return apiClient.post(`patients/${patientId}/notes`, {
        episodeId: episodeId || undefined,
        title: `Incident — ${incidentType}`,
        noteType: 'incident',
        content,
        status,
        didNotAttend: false,
      });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: patientsKeys.notesIncidents(patientId) });
      onSaved();
    },
    onError: (e: unknown) => setError(getErrorMessage(e, 'Save failed')),
  });

  return (
    <Dialog aria-labelledby="dialog-title" open={open} onClose={onClose} maxWidth="md" fullWidth>
      <DialogTitle id="dialog-title" sx={{ fontWeight: 700, fontFamily: 'Albert Sans, sans-serif' }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <ReportProblemIcon sx={{ color: '#C62828' }} />
          Report Incident
        </Box>
      </DialogTitle>
      <Divider />
      {/* Severity banner */}
      <Box sx={{ px: 3, py: 1.5, bgcolor: svConfig.bg, borderBottom: '1px solid', borderColor: 'divider', display: 'flex', alignItems: 'center', gap: 2 }}>
        <Typography variant="body2" fontWeight={700} color={svConfig.color}>Severity:</Typography>
        <Box sx={{ display: 'flex', gap: 1 }}>
          {SEVERITY_LEVELS.map(s => (
            <Chip key={s.value} label={s.label} size="small" onClick={() => setSeverity(s.value)}
              sx={{ cursor: 'pointer', fontWeight: severity === s.value ? 700 : 400, bgcolor: severity === s.value ? s.bg : undefined, color: severity === s.value ? s.color : 'text.secondary', border: severity === s.value ? `2px solid ${s.color}` : undefined }} />
          ))}
        </Box>
      </Box>
      <DialogContent>
        <Grid container spacing={2} sx={{ mt: 0.5 }}>
          <Grid size={{ xs: 12, sm: 6 }}>
            <FormControl fullWidth size="small">
              <InputLabel>Incident Type *</InputLabel>
              <Select value={incidentType} onChange={e => setIncidentType(e.target.value)} label="Incident Type *">
                {INCIDENT_TYPES.map(t => <MenuItem key={t} value={t}>{t}</MenuItem>)}
              </Select>
            </FormControl>
          </Grid>
          <Grid size={{ xs: 12, sm: 6 }}>
            <FormControl fullWidth size="small">
              <InputLabel>Episode</InputLabel>
              <Select value={episodeId} onChange={e => setEpisodeId(e.target.value)} label="Episode">
                <MenuItem value="">— None —</MenuItem>
                {(episodes ?? []).map((ep) => <MenuItem key={ep.id} value={ep.id}>{ep.title}</MenuItem>)}
              </Select>
            </FormControl>
          </Grid>
          <Grid size={{ xs: 12, sm: 6 }}>
            <TextField label="Date / Time of Incident *" type="datetime-local" fullWidth size="small"
              value={incidentDate} onChange={e => setIncidentDate(e.target.value)}
              InputLabelProps={{ shrink: true }} />
          </Grid>
          <Grid size={{ xs: 12, sm: 6 }}>
            <TextField label="Location" fullWidth size="small" value={location}
              onChange={e => setLocation(e.target.value)} placeholder="e.g. Ward 3B, Community — Patient Home" />
          </Grid>
          <Grid size={{ xs: 12, sm: 6 }}>
            <FormControl fullWidth size="small">
              <InputLabel>Outcome</InputLabel>
              <Select value={outcome} onChange={e => setOutcome(e.target.value)} label="Outcome">
                {INCIDENT_OUTCOMES.map(o => <MenuItem key={o} value={o}>{o}</MenuItem>)}
              </Select>
            </FormControl>
          </Grid>
          <Grid size={{ xs: 12, sm: 6 }}>
            <FormControl fullWidth size="small">
              <InputLabel>Incident Status</InputLabel>
              <Select value={incidentStatus} onChange={e => setIncidentStatus(e.target.value)} label="Incident Status">
                {INCIDENT_STATUSES.map(s => <MenuItem key={s} value={s} sx={{ textTransform: 'capitalize' }}>{s.replace('_', ' ')}</MenuItem>)}
              </Select>
            </FormControl>
          </Grid>
          <Grid size={{ xs: 12 }}>
            <TextField label="Description of Incident *" fullWidth multiline rows={4}
              value={description} onChange={e => setDescription(e.target.value)}
              placeholder="Describe what happened, who was involved, and the sequence of events…"
              sx={{ '& .MuiInputBase-input': { fontSize: 13 } }} />
          </Grid>
          <Grid size={{ xs: 12 }}>
            <TextField label="Immediate Actions Taken" fullWidth multiline rows={3}
              value={actionsTaken} onChange={e => setActionsTaken(e.target.value)}
              placeholder="De-escalation, medical review, notification of on-call, safeguarding steps…"
              sx={{ '& .MuiInputBase-input': { fontSize: 13 } }} />
          </Grid>
          <Grid size={{ xs: 12 }}>
            <TextField label="Follow-up Required" fullWidth multiline rows={2}
              value={followUp} onChange={e => setFollowUp(e.target.value)}
              placeholder="Debriefing, formal incident review, notification to VHIMS / RISKMAN, family notification…"
              sx={{ '& .MuiInputBase-input': { fontSize: 13 } }} />
          </Grid>
          {error && <Grid size={{ xs: 12 }}><Alert role="alert" severity="error">{error}</Alert></Grid>}
        </Grid>
      </DialogContent>
      <Divider />
      <DialogActions sx={{ px: 3, py: 2 }}>
        <Button onClick={onClose} sx={{ color: 'text.secondary' }}>Cancel</Button>
        <Button variant="outlined" onClick={() => saveMut.mutate('draft')} disabled={!incidentType || !description.trim() || saveMut.isPending}
          sx={{ borderColor: '#327C8D', color: '#327C8D', textTransform: 'none' }}>
          {saveMut.isPending ? 'Saving…' : 'Save Draft'}
        </Button>
        <Button variant="contained" onClick={() => saveMut.mutate('signed')} disabled={!incidentType || !description.trim() || saveMut.isPending}
          sx={{ bgcolor: '#C62828', '&:hover': { bgcolor: '#B71C1C' }, textTransform: 'none' }}>
          {saveMut.isPending ? 'Saving…' : 'Submit Incident Report'}
        </Button>
      </DialogActions>
    </Dialog>
  );
}

// ── Parse full structured incident data from note content ────────────────────
function parseIncidentFull(content: string) {
  const getField = (key: string) => {
    const m = content.match(new RegExp(`${key}:\\s*(.+)`));
    return m?.[1]?.trim() ?? '';
  };
  const getSection = (header: string) => {
    const parts = content.split(`=== ${header} ===`);
    if (parts.length < 2) return '';
    return (parts[1]?.split('\n===')?.[0] ?? '').trim();
  };
  return {
    type: getField('Incident Type'),
    severity: getField('Severity'),
    dateTime: getField('Incident Date/Time'),
    location: getField('Location'),
    outcome: getField('Outcome'),
    status: getField('Incident Status'),
    description: getSection('DESCRIPTION'),
    actionsTaken: getSection('IMMEDIATE ACTIONS TAKEN'),
    followUp: getSection('FOLLOW-UP REQUIRED'),
  };
}

// ── Incident Detail Dialog ───────────────────────────────────────────────────

interface IncidentDetailDialogProps {
  open: boolean;
  incident: IncidentNote | null;
  patientId: string;
  onClose: () => void;
}

function IncidentDetailDialog({ open, incident, patientId, onClose }: IncidentDetailDialogProps) {
  const qc = useQueryClient();
  const [commentText, setCommentText] = useState('');
  const [commentError, setCommentError] = useState('');

  const parsed = incident ? parseIncidentFull(incident.content ?? '') : null;
  const sv = severityConfig(parsed?.severity);

  // Fetch comments linked to this incident
  const { data: comments, isLoading: commentsLoading } = useQuery({
    queryKey: incidentsKeys.comments(patientId, incident?.id ?? ''),
    queryFn: () =>
      apiClient
        .get<{ notes: IncidentNote[] }>(`patients/${patientId}/notes`)
        .then(r => (r.notes ?? []).filter(n => n.noteType === 'incident_comment' && n.content?.includes(`[Incident: ${incident?.id}]`))),
    enabled: !!patientId && !!incident?.id,
  });

  const addCommentMut = useMutation({
    mutationFn: (text: string) =>
      apiClient.post(`patients/${patientId}/notes`, {
        title: `Comment on: ${incident?.title ?? 'Incident'}`,
        noteType: 'incident_comment',
        content: `[Incident: ${incident?.id}]\n\n${text}`,
        status: 'signed',
        didNotAttend: false,
        contactMeta: { incidentId: incident?.id },
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: incidentsKeys.comments(patientId, incident?.id ?? '') });
      setCommentText('');
      setCommentError('');
    },
    onError: (e: unknown) => setCommentError(getErrorMessage(e, 'Failed to save comment')),
  });

  if (!incident || !parsed) return null;

  return (
    <Dialog aria-labelledby="incident-detail-title" open={open} onClose={onClose} maxWidth="md" fullWidth>
      <DialogTitle id="incident-detail-title" sx={{ fontWeight: 700, fontFamily: 'Albert Sans, sans-serif', pb: 0 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <ReportProblemIcon sx={{ color: sv.color }} />
          {incident.title}
        </Box>
        <Box sx={{ display: 'flex', gap: 1, mt: 1 }}>
          <Chip label={sv.label} size="small" sx={{ bgcolor: sv.bg, color: sv.color, fontWeight: 700, fontSize: 10, border: `1px solid ${sv.color}` }} />
          <Chip label={(parsed.status || 'Open').replace('_', ' ')} size="small" sx={{ fontSize: 10, textTransform: 'capitalize' }} variant="outlined" />
          {parsed.outcome && <Chip label={parsed.outcome} size="small" variant="outlined" sx={{ fontSize: 10 }} />}
        </Box>
      </DialogTitle>
      <Divider sx={{ mt: 1.5 }} />
      <DialogContent>
        {/* Fields grid */}
        <Grid container spacing={2} sx={{ mb: 2 }}>
          <Grid size={{ xs: 12, sm: 6 }}>
            <Typography variant="caption" color="text.secondary" fontWeight={600}>Incident Type</Typography>
            <Typography variant="body2">{parsed.type || '—'}</Typography>
          </Grid>
          <Grid size={{ xs: 12, sm: 6 }}>
            <Typography variant="caption" color="text.secondary" fontWeight={600}>Date / Time</Typography>
            <Typography variant="body2">{parsed.dateTime || '—'}</Typography>
          </Grid>
          <Grid size={{ xs: 12, sm: 6 }}>
            <Typography variant="caption" color="text.secondary" fontWeight={600}>Severity</Typography>
            <Typography variant="body2" sx={{ color: sv.color, fontWeight: 600 }}>{parsed.severity || '—'}</Typography>
          </Grid>
          <Grid size={{ xs: 12, sm: 6 }}>
            <Typography variant="caption" color="text.secondary" fontWeight={600}>Location</Typography>
            <Typography variant="body2">{parsed.location || '—'}</Typography>
          </Grid>
          <Grid size={{ xs: 12, sm: 6 }}>
            <Typography variant="caption" color="text.secondary" fontWeight={600}>Reported By</Typography>
            <Typography variant="body2">{incident.authorName || '—'}</Typography>
          </Grid>
          <Grid size={{ xs: 12, sm: 6 }}>
            <Typography variant="caption" color="text.secondary" fontWeight={600}>Created</Typography>
            <Typography variant="body2">{incident.createdAt ? new Date(incident.createdAt).toLocaleString('en-AU') : '—'}</Typography>
          </Grid>
        </Grid>

        <Divider sx={{ my: 1.5 }} />

        {/* Description */}
        {parsed.description && (
          <Box sx={{ mb: 2 }}>
            <Typography variant="subtitle2" fontWeight={700} sx={{ mb: 0.5 }}>Description</Typography>
            <Paper variant="outlined" sx={{ p: 1.5, bgcolor: '#FAFAFA' }}>
              <Typography variant="body2" sx={{ whiteSpace: 'pre-wrap', fontSize: 13 }}>{parsed.description}</Typography>
            </Paper>
          </Box>
        )}

        {/* Actions Taken */}
        {parsed.actionsTaken && (
          <Box sx={{ mb: 2 }}>
            <Typography variant="subtitle2" fontWeight={700} sx={{ mb: 0.5 }}>Immediate Actions Taken</Typography>
            <Paper variant="outlined" sx={{ p: 1.5, bgcolor: '#FAFAFA' }}>
              <Typography variant="body2" sx={{ whiteSpace: 'pre-wrap', fontSize: 13 }}>{parsed.actionsTaken}</Typography>
            </Paper>
          </Box>
        )}

        {/* Follow-up */}
        {parsed.followUp && (
          <Box sx={{ mb: 2 }}>
            <Typography variant="subtitle2" fontWeight={700} sx={{ mb: 0.5 }}>Follow-up Required</Typography>
            <Paper variant="outlined" sx={{ p: 1.5, bgcolor: '#FAFAFA' }}>
              <Typography variant="body2" sx={{ whiteSpace: 'pre-wrap', fontSize: 13 }}>{parsed.followUp}</Typography>
            </Paper>
          </Box>
        )}

        <Divider sx={{ my: 2 }} />

        {/* Comments / Follow-up Notes */}
        <Box>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1.5 }}>
            <CommentIcon sx={{ fontSize: 18, color: '#327C8D' }} />
            <Typography variant="subtitle2" fontWeight={700}>Comments / Follow-up Notes</Typography>
          </Box>

          {commentsLoading && <CircularProgress size={20} sx={{ display: 'block', mx: 'auto', my: 2 }} />}

          {!commentsLoading && (comments ?? []).length === 0 && (
            <Typography variant="body2" color="text.secondary" sx={{ mb: 2, fontSize: 12 }}>
              No comments yet. Add a follow-up note below.
            </Typography>
          )}

          {(comments ?? []).map(c => (
            <Paper key={c.id} variant="outlined" sx={{ p: 1.5, mb: 1, bgcolor: '#F5F5F5' }}>
              <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 0.5 }}>
                <Typography variant="caption" fontWeight={600}>{c.authorName || 'Staff'}</Typography>
                <Typography variant="caption" color="text.secondary">
                  {c.createdAt ? new Date(c.createdAt).toLocaleString('en-AU', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—'}
                </Typography>
              </Box>
              <Typography variant="body2" sx={{ fontSize: 12, whiteSpace: 'pre-wrap' }}>
                {(c.content ?? '').replace(/\[Incident: [^\]]+\]\n?\n?/, '')}
              </Typography>
              {c.authorSignature && (
                <Box sx={{ mt: 1, pt: 0.5, borderTop: '1px solid #E0E0E0' }}>
                  <img src={c.authorSignature} alt={`Signature — ${c.authorName}`} style={{ maxHeight: 30, maxWidth: 120 }} />
                  <Typography variant="caption" display="block" color="text.secondary" sx={{ fontSize: 9 }}>{c.authorName}</Typography>
                </Box>
              )}
            </Paper>
          ))}

          {/* Add comment form */}
          <Box sx={{ display: 'flex', gap: 1, mt: 1.5 }}>
            <TextField
              fullWidth size="small" multiline minRows={2} maxRows={4}
              placeholder="Add a comment or follow-up note..."
              value={commentText} onChange={e => setCommentText(e.target.value)}
              sx={{ '& .MuiInputBase-input': { fontSize: 13 } }}
            />
            <Button
              variant="contained" size="small"
              disabled={!commentText.trim() || addCommentMut.isPending}
              onClick={() => addCommentMut.mutate(commentText.trim())}
              sx={{ bgcolor: '#327C8D', '&:hover': { bgcolor: '#265f6d' }, textTransform: 'none', minWidth: 48, alignSelf: 'flex-end' }}
            >
              {addCommentMut.isPending ? <CircularProgress size={18} sx={{ color: '#fff' }} /> : <SendIcon sx={{ fontSize: 18 }} />}
            </Button>
          </Box>
          {commentError && <Alert severity="error" sx={{ mt: 1 }}>{commentError}</Alert>}
        </Box>
      </DialogContent>
      <Divider />
      <DialogActions sx={{ px: 3, py: 1.5 }}>
        <Button onClick={onClose} sx={{ textTransform: 'none' }}>Close</Button>
      </DialogActions>
    </Dialog>
  );
}

// ── Main IncidentsTab ─────────────────────────────────────────────────────────

interface IncidentsTabProps { patientId: string }
export function IncidentsTab({ patientId }: IncidentsTabProps) {
  const [addOpen, setAddOpen] = useState(false);
  const [selectedIncident, setSelectedIncident] = useState<IncidentNote | null>(null);
  const [statusFilter, setStatusFilter] = useState('all');
  const qc = useQueryClient();

  const { data: notes, isLoading } = useQuery({
    queryKey: patientsKeys.notesIncidents(patientId),
    queryFn: () =>
      apiClient
        .get<{ notes: IncidentNote[] }>(`patients/${patientId}/notes`)
        .then(r => (r.notes ?? []).filter(n => n.noteType === 'incident').sort((a, b) => new Date(b.createdAt ?? 0).getTime() - new Date(a.createdAt ?? 0).getTime())),
    enabled: !!patientId,
  });

  const filtered = (notes ?? []).filter(n => {
    if (statusFilter === 'all') return true;
    const incStatus = (n.content ?? '').match(/Incident Status:\s*(.+)/)?.[1]?.trim().toLowerCase().replace(' ', '_') ?? '';
    return incStatus === statusFilter || (statusFilter === 'open' && n.status === 'draft');
  });

  const counts = {
    total: notes?.length ?? 0,
    open: (notes ?? []).filter(n => n.status !== 'signed').length,
    signed: (notes ?? []).filter(n => n.status === 'signed').length,
    critical: (notes ?? []).filter(n => { const sev = (parseIncidentMeta(n.content ?? '').severity ?? '').toLowerCase(); return sev === 'high' || sev === 'critical'; }).length,
  };

  return (
    <Box>
      {/* Header */}
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', mb: 2 }}>
        <Box>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, mb: 0.5 }}>
            <ReportProblemIcon sx={{ color: '#C62828' }} />
            <Typography variant="h6" fontWeight={700} fontFamily="Albert Sans, sans-serif">Incidents</Typography>
          </Box>
          <Box sx={{ display: 'flex', gap: 1.5 }}>
            <Chip label={`${counts.total} total`} size="small" variant="outlined" sx={{ fontSize: 11 }} />
            {counts.open > 0 && <Chip label={`${counts.open} open`} size="small" sx={{ bgcolor: '#FFF3E0', color: '#E65100', fontWeight: 600, fontSize: 11 }} />}
            {counts.critical > 0 && <Chip label={`${counts.critical} high/critical`} size="small" sx={{ bgcolor: '#FFEBEE', color: '#C62828', fontWeight: 700, fontSize: 11 }} />}
          </Box>
        </Box>
        <Button startIcon={<NoteAddIcon />} variant="contained" size="small" onClick={() => setAddOpen(true)}
          sx={{ bgcolor: '#C62828', '&:hover': { bgcolor: '#B71C1C' }, textTransform: 'none', fontFamily: 'Albert Sans, sans-serif' }}>
          Add Incident
        </Button>
      </Box>

      {/* Status filter */}
      <Box sx={{ display: 'flex', gap: 1, mb: 2 }}>
        {[{ v: 'all', l: 'All' }, { v: 'open', l: 'Open' }, { v: 'under_review', l: 'Under Review' }, { v: 'closed', l: 'Closed' }].map(({ v, l }) => (
          <Chip key={v} label={l} size="small" onClick={() => setStatusFilter(v)} clickable
            variant={statusFilter === v ? 'filled' : 'outlined'}
            sx={{ fontFamily: 'Albert Sans, sans-serif', fontWeight: statusFilter === v ? 600 : 400, bgcolor: statusFilter === v ? '#3D484B' : undefined, color: statusFilter === v ? '#fff' : 'text.primary' }} />
        ))}
      </Box>

      {isLoading && <CircularProgress role="progressbar" aria-label="Loading" size={24} />}

      {!isLoading && filtered.length === 0 && (
        <Alert severity={counts.total === 0 ? 'info' : 'warning'} sx={{ mb: 2 }}>
          {counts.total === 0
            ? 'No incidents recorded for this patient. Use "Add Incident" to report one.'
            : `No incidents match the current filter.`}
        </Alert>
      )}

      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5 }}>
        {filtered.map(n => {
          const meta = parseIncidentMeta(n.content ?? '');
          const sv = severityConfig(meta.severity);
          const incStatus = (n.content ?? '').match(/Incident Status:\s*(.+)/)?.[1]?.trim() ?? (n.status === 'signed' ? 'Closed' : 'Open');
          const dateTime = (n.content ?? '').match(/Incident Date\/Time:\s*(.+)/)?.[1]?.trim();
          return (
            <Paper key={n.id} variant="outlined"
              role="button"
              tabIndex={0}
              aria-label={`Open incident: ${n.title} — ${sv.label} severity, ${incStatus}`}
              onClick={() => setSelectedIncident(n)}
              onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setSelectedIncident(n); } }}
              sx={{ borderLeft: `5px solid ${sv.color}`, p: 0, overflow: 'hidden', cursor: 'pointer', '&:hover': { boxShadow: '0 2px 8px rgba(0,0,0,0.1)' }, '&:focus-visible': { outline: `2px solid ${sv.color}`, outlineOffset: 2 }, transition: 'box-shadow 0.2s' }}>
              <Box sx={{ px: 2, py: 1.5, bgcolor: sv.bg }}>
                <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 1 }}>
                  <Box>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 0.5, flexWrap: 'wrap' }}>
                      <Typography variant="body2" fontWeight={700}>{n.title}</Typography>
                      <Chip label={sv.label} size="small" sx={{ bgcolor: sv.bg, color: sv.color, fontWeight: 700, fontSize: 10, border: `1px solid ${sv.color}` }} />
                      <Chip label={incStatus.replace('_', ' ')} size="small" sx={{ fontSize: 10, textTransform: 'capitalize' }} variant="outlined" />
                      {n.status === 'signed' && <Chip label="Submitted" size="small" color="success" sx={{ fontSize: 10 }} />}
                    </Box>
                    <Typography variant="caption" color="text.secondary">
                      {dateTime ? `Incident: ${dateTime}` : (n.createdAt ? new Date(n.createdAt).toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—')}
                      {n.authorName && ` — Reported by: ${n.authorName}`}
                      {n.episodeTitle && ` | ${n.episodeTitle}`}
                    </Typography>
                  </Box>
                  {meta.outcome && (
                    <Chip label={meta.outcome} size="small" variant="outlined" sx={{ fontSize: 10, maxWidth: 220 }} />
                  )}
                </Box>
              </Box>
              {n.content && (
                <Box sx={{ px: 2, py: 1, bgcolor: '#FAFAFA' }}>
                  <Typography variant="caption" color="text.secondary" sx={{ fontFamily: 'monospace', fontSize: 11, whiteSpace: 'pre-wrap', display: 'block', maxHeight: 80, overflow: 'hidden' }}>
                    {(() => {
                      const parts = (n.content ?? '').split('=== DESCRIPTION ===\n');
                      const description = parts.length > 1 ? (parts[1]?.split('\n===')?.[0] ?? n.content) : n.content;
                      return (description ?? '').slice(0, 300);
                    })()}
                    {n.content.length > 300 ? '…' : ''}
                  </Typography>
                </Box>
              )}
            </Paper>
          );
        })}
      </Box>

      <AddIncidentDialog open={addOpen} patientId={patientId}
        onClose={() => setAddOpen(false)}
        onSaved={() => { qc.invalidateQueries({ queryKey: patientsKeys.notesIncidents(patientId) }); setAddOpen(false); }} />

      <IncidentDetailDialog
        open={!!selectedIncident}
        incident={selectedIncident}
        patientId={patientId}
        onClose={() => setSelectedIncident(null)}
      />
    </Box>
  );
}

export default IncidentsTab;
