import { useState, useMemo } from 'react';
import {
  Alert, Autocomplete, Box, Button, Chip, CircularProgress, Dialog, DialogActions,
  DialogContent, DialogTitle, Divider, FormControl, Grid, IconButton, InputLabel,
  MenuItem, Paper, Rating, Select, Tab, Table, TableBody, TableCell, TableContainer,
  TableHead, TableRow, Tabs, TextField, Tooltip, Typography,
} from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import PeopleIcon from '@mui/icons-material/People';
import PersonAddIcon from '@mui/icons-material/PersonAdd';
import PersonRemoveIcon from '@mui/icons-material/PersonRemove';
import NoteAddIcon from '@mui/icons-material/NoteAdd';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '../../../shared/services/apiClient';
import { useAuthStore } from '../../../shared/store/authStore';
import { ListExportBar } from '../../../shared/components/ui/ListExportBar';
import { groupTherapyKeys } from '../queryKeys';

const GROUP_TYPES = ['CBT', 'DBT', 'ACT', 'Psychoeducation', 'Social Skills', 'Art Therapy', 'Other'];
const ATTENDANCE_STATUS = ['present', 'absent', 'late', 'left_early'] as const;
const ATTENDANCE_COLORS: Record<string, string> = { present: '#2E7D32', absent: '#D32F2F', late: '#b8621a', left_early: '#E65100' };

interface GroupSession {
  id: string; group_name: string; group_type: string; session_date: string;
  session_number: number | null; facilitator_name: string | null; topic: string | null;
  session_notes: string | null; skills_covered: string | null; status: string;
  location: string | null; start_time: string | null; attendee_count?: number; name?: string;
}

interface Attendee {
  id: string; session_id: string; patientId: string; attendance: string;
  participation_rating: number | null; individual_notes: string | null;
  diary_card_completed: boolean; homework_completed: boolean;
  patient_name?: string; patient_ur?: string;
}

interface PatientOption { id: string; givenName: string; familyName: string; emrNumber: string }

interface GroupSessionFormState {
  groupName?: string;
  groupType: string;
  sessionDate: string;
  startTime?: string;
  sessionNumber?: string;
  location?: string;
  topic?: string;
  skillsCovered?: string;
}

interface GroupTherapyApiError {
  message?: string;
  response?: { data?: { error?: string; message?: string } };
}

function getGroupTherapyErrorMessage(err: unknown): string {
  if (!err || typeof err !== 'object') return 'Unknown error';
  const parsed = err as GroupTherapyApiError;
  return parsed.response?.data?.error ?? parsed.response?.data?.message ?? parsed.message ?? 'Unknown error';
}

export default function GroupTherapyPage() {
  const qc = useQueryClient();
  const user = useAuthStore(s => s.user);
  const [addOpen, setAddOpen] = useState(false);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [form, setForm] = useState<GroupSessionFormState>({ groupType: 'CBT', sessionDate: new Date().toISOString().split('T')[0] });
  const [filterName, setFilterName] = useState('');
  const [filterStatus, setFilterStatus] = useState('all');

  const { data: sessions, isLoading } = useQuery({
    queryKey: groupTherapyKeys.all,
    queryFn: () => apiClient.get<GroupSession[]>('group-therapy').then(r => Array.isArray(r) ? r : []),
  });

  const createMut = useMutation({
    mutationFn: (data: GroupSessionFormState & { facilitator_id?: string }) => apiClient.post('group-therapy', data),
    onSuccess: () => { qc.invalidateQueries({ queryKey: groupTherapyKeys.all }); setAddOpen(false); setForm({ groupType: 'CBT', sessionDate: new Date().toISOString().split('T')[0] }); },
    onError: (err: unknown) => { alert(`Failed to create session: ${getGroupTherapyErrorMessage(err)}`); },
  });

  const selectedSession = useMemo(() => (sessions ?? []).find(s => s.id === detailId), [sessions, detailId]);

  // ── Session Detail View ──
  const filteredSessions = (sessions ?? []).filter((s) => {
    const nameMatch = !filterName || (s.name ?? s.group_name ?? '').toLowerCase().includes(filterName.toLowerCase());
    const statusMatch = filterStatus === 'all' || s.status === filterStatus;
    return nameMatch && statusMatch;
  });
  // Use filteredSessions instead of sessions for the table display
  const displaySessions = filteredSessions;

  if (detailId && selectedSession) {
    return <SessionDetailView session={selectedSession} onBack={() => setDetailId(null)} />;
  }

  // ── Sessions List View ──
  return (
    <Box sx={{ p: { xs: 2, md: 3 }, bgcolor: '#FBF8F5', minHeight: '100vh' }}>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 3 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
          <PeopleIcon sx={{ color: '#327C8D', fontSize: 28 }} />
          <Box>
            <Typography variant="h5" fontWeight={700} fontFamily="Albert Sans, sans-serif" color="#3D484B">Group Therapy</Typography>
            <Typography variant="body2" color="text.secondary">Manage group sessions, attendance, and notes</Typography>
          </Box>
        </Box>
        <Button variant="contained" startIcon={<AddIcon />} onClick={() => setAddOpen(true)}
          sx={{ bgcolor: '#b8621a', '&:hover': { bgcolor: '#d6741f' }, textTransform: 'none' }}>
          New Session
        </Button>
      </Box>

      {/* Filters */}
      <Box sx={{ display: 'flex', gap: 1.5, mb: 2, flexWrap: 'wrap' }}>
        <TextField label="Search group name" size="small" value={filterName} onChange={e => setFilterName(e.target.value)} sx={{ minWidth: 200 }} />
        <FormControl size="small" sx={{ minWidth: 130 }}>
          <InputLabel>Status</InputLabel>
          <Select value={filterStatus} onChange={e => setFilterStatus(e.target.value)} label="Status">
            <MenuItem value="all">All</MenuItem>
            <MenuItem value="scheduled">Scheduled</MenuItem>
            <MenuItem value="completed">Completed</MenuItem>
            <MenuItem value="cancelled">Cancelled</MenuItem>
          </Select>
        </FormControl>
      </Box>

      {isLoading ? <CircularProgress role="progressbar" aria-label="Loading" /> : (
        <>
          <Box sx={{ display: 'flex', justifyContent: 'flex-end', mb: 0.5 }}>
            <ListExportBar compact title="Group Therapy Sessions" subtitle={`${(displaySessions).length} sessions`}
              columns={['Group Name', 'Type', 'Date', 'Facilitator', 'Attendees', 'Status']}
              rows={displaySessions.map(s => [
                s.group_name, s.group_type,
                new Date(s.session_date).toLocaleDateString('en-AU'),
                s.facilitator_name ?? '', String(s.attendee_count ?? 0), s.status,
              ])} />
          </Box>
          <TableContainer role="region" aria-label="Data table" component={Paper} variant="outlined">
            <Table size="small">
              <TableHead>
                <TableRow sx={{ bgcolor: '#FBF8F5' }}>
                  <TableCell sx={{ fontWeight: 600 }}>Group Name</TableCell>
                  <TableCell sx={{ fontWeight: 600 }}>Type</TableCell>
                  <TableCell sx={{ fontWeight: 600 }}>Date</TableCell>
                  <TableCell sx={{ fontWeight: 600 }}>Session #</TableCell>
                  <TableCell sx={{ fontWeight: 600 }}>Facilitator</TableCell>
                  <TableCell sx={{ fontWeight: 600 }}>Attendees</TableCell>
                  <TableCell sx={{ fontWeight: 600 }}>Status</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {displaySessions.length === 0 && (
                  <TableRow><TableCell colSpan={7}><Alert severity="info">No group sessions. Click "New Session" to create one.</Alert></TableCell></TableRow>
                )}
                {displaySessions.map(s => (
                  <TableRow key={s.id} hover onClick={() => setDetailId(s.id)} sx={{ cursor: 'pointer' }}>
                    <TableCell sx={{ fontWeight: 500 }}>{s.group_name}</TableCell>
                    <TableCell><Chip label={s.group_type} size="small" sx={{ fontSize: 10 }} /></TableCell>
                    <TableCell>{new Date(s.session_date).toLocaleDateString('en-AU')}</TableCell>
                    <TableCell>{s.session_number ?? '—'}</TableCell>
                    <TableCell>{s.facilitator_name ?? '—'}</TableCell>
                    <TableCell>
                      <Chip label={s.attendee_count ?? 0} size="small" icon={<PeopleIcon sx={{ fontSize: 12 }} />}
                        sx={{ fontSize: 11, bgcolor: '#327C8D15', color: '#327C8D' }} />
                    </TableCell>
                    <TableCell><Chip label={s.status} size="small" color={s.status === 'completed' ? 'success' : 'default'} sx={{ fontSize: 10 }} /></TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>
        </>
      )}

      {/* New Session Dialog */}
      <Dialog aria-labelledby="dialog-title" open={addOpen} onClose={() => setAddOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle id="dialog-title" sx={{ fontWeight: 700 }}>New Group Session</DialogTitle>
        <Divider />
        <DialogContent>
          <Grid container spacing={2} sx={{ mt: 0.5 }}>
            <Grid size={{ xs: 8 }}><TextField label="Group Name *" fullWidth size="small" value={form.groupName ?? ''} onChange={e => setForm(p => ({ ...p, groupName: e.target.value }))} placeholder="e.g. DBT Skills Group" /></Grid>
            <Grid size={{ xs: 4 }}>
              <FormControl fullWidth size="small"><InputLabel>Type</InputLabel>
                <Select value={form.groupType ?? 'CBT'} onChange={e => setForm(p => ({ ...p, groupType: e.target.value }))} label="Type">
                  {GROUP_TYPES.map(t => <MenuItem key={t} value={t}>{t}</MenuItem>)}
                </Select>
              </FormControl>
            </Grid>
            <Grid size={{ xs: 4 }}><TextField label="Date" type="date" fullWidth size="small" value={form.sessionDate} onChange={e => setForm(p => ({ ...p, sessionDate: e.target.value }))} slotProps={{ inputLabel: { shrink: true } }} /></Grid>
            <Grid size={{ xs: 4 }}><TextField label="Start Time" type="time" fullWidth size="small" value={form.startTime ?? ''} onChange={e => setForm(p => ({ ...p, startTime: e.target.value }))} slotProps={{ inputLabel: { shrink: true } }} /></Grid>
            <Grid size={{ xs: 4 }}><TextField label="Session #" type="number" fullWidth size="small" value={form.sessionNumber ?? ''} onChange={e => setForm(p => ({ ...p, sessionNumber: e.target.value }))} /></Grid>
            <Grid size={{ xs: 12 }}><TextField label="Location" fullWidth size="small" value={form.location ?? ''} onChange={e => setForm(p => ({ ...p, location: e.target.value }))} /></Grid>
            <Grid size={{ xs: 12 }}><TextField label="Topic" fullWidth size="small" value={form.topic ?? ''} onChange={e => setForm(p => ({ ...p, topic: e.target.value }))} placeholder="e.g. Distress Tolerance — TIPP Skills" /></Grid>
            <Grid size={{ xs: 12 }}><TextField label="Skills Covered" fullWidth size="small" value={form.skillsCovered ?? ''} onChange={e => setForm(p => ({ ...p, skillsCovered: e.target.value }))} placeholder="e.g. TIPP, Wise Mind, Opposite Action" /></Grid>
          </Grid>
        </DialogContent>
        <DialogActions sx={{ px: 3, py: 2 }}>
          <Button onClick={() => setAddOpen(false)} sx={{ textTransform: 'none' }}>Cancel</Button>
          <Button variant="contained" onClick={() => createMut.mutate({ ...form, facilitator_id: user?.id })}
            disabled={createMut.isPending || !form.groupName}
            sx={{ bgcolor: '#b8621a', '&:hover': { bgcolor: '#d6741f' }, textTransform: 'none' }}>
            {createMut.isPending ? 'Creating...' : 'Create Session'}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// Session Detail View — Attendance, Notes, Patient Management
// ════════════════════════════════════════════════════════════════════════════

interface SessionDetailViewProps { session: GroupSession; onBack: () => void }
function SessionDetailView({ session, onBack }: SessionDetailViewProps) {
  const qc = useQueryClient();
  const user = useAuthStore(s => s.user);
  const [tab, setTab] = useState(0);
  const [addPatientOpen, setAddPatientOpen] = useState(false);
  const [patientSearch, setPatientSearch] = useState('');
  const [selectedPatient, setSelectedPatient] = useState<PatientOption | null>(null);
  const [noteDialogOpen, setNoteDialogOpen] = useState(false);
  const [notePatient, setNotePatient] = useState<Attendee | null>(null);
  const [noteText, setNoteText] = useState('');
  const [sessionNotes, setSessionNotes] = useState(session.session_notes ?? '');
  const [editingSessionNotes, setEditingSessionNotes] = useState(false);

  // Fetch attendees
  const { data: attendees, isLoading: loadingAttendees } = useQuery({
    queryKey: groupTherapyKeys.attendees(session.id),
    queryFn: () => apiClient.get<Attendee[]>(`group-therapy/${session.id}/attendees`).then(r => Array.isArray(r) ? r : []),
  });

  // Fetch patients for search
  const { data: patientResults } = useQuery({
    queryKey: groupTherapyKeys.patientSearch(patientSearch),
    queryFn: () => apiClient.get<{ data: PatientOption[] }>('patients', { search: patientSearch, limit: 20 }).then(r => r.data ?? []),
    enabled: patientSearch.length >= 2,
  });

  // Add patient to session
  const addPatientMut = useMutation({
    mutationFn: (patientId: string) => apiClient.post(`group-therapy/${session.id}/attendees`, { patient_id: patientId, attendance: 'present' }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: groupTherapyKeys.attendees(session.id) }); qc.invalidateQueries({ queryKey: groupTherapyKeys.all }); setAddPatientOpen(false); setSelectedPatient(null); },
  });

  // Remove patient from session
  const removePatientMut = useMutation({
    mutationFn: (attendeeId: string) => apiClient.delete(`group-therapy/${session.id}/attendees/${attendeeId}`),
    onSuccess: () => { qc.invalidateQueries({ queryKey: groupTherapyKeys.attendees(session.id) }); qc.invalidateQueries({ queryKey: groupTherapyKeys.all }); },
  });

  // Update attendance
  const updateAttendanceMut = useMutation({
    mutationFn: ({ attendeeId, ...data }: { attendeeId: string; attendance?: string; participation_rating?: number; diary_card_completed?: boolean; homework_completed?: boolean }) =>
      apiClient.patch(`group-therapy/${session.id}/attendees/${attendeeId}`, data),
    onSuccess: () => qc.invalidateQueries({ queryKey: groupTherapyKeys.attendees(session.id) }),
  });

  // Save individual note (also creates clinical note in patient record)
  const saveNoteMut = useMutation({
    mutationFn: ({ attendeeId, patientId, note }: { attendeeId: string; patientId: string; note: string }) =>
      apiClient.post(`group-therapy/${session.id}/attendees/${attendeeId}/note`, {
        individual_notes: note,
        patientId: patientId,
        // This endpoint should also create a clinical note in the patient's record
        create_clinical_note: true,
        note_category: 'group-therapy',
        note_title: `Group: ${session.group_name} — Session ${session.session_number ?? ''}`,
        author_id: user?.id,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: groupTherapyKeys.attendees(session.id) });
      // Also invalidate patient notes so it appears in episode timeline
      if (notePatient) qc.invalidateQueries({ queryKey: groupTherapyKeys.patientNotes(notePatient.patientId) });
      setNoteDialogOpen(false);
      setNoteText('');
    },
  });

  // Save session-level notes
  const saveSessionNotesMut = useMutation({
    mutationFn: (notes: string) => apiClient.patch(`group-therapy/${session.id}`, { session_notes: notes }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: groupTherapyKeys.all }); setEditingSessionNotes(false); },
  });

  // Complete session
  const completeMut = useMutation({
    mutationFn: () => apiClient.patch(`group-therapy/${session.id}`, { status: 'completed' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: groupTherapyKeys.all }),
  });

  const presentCount = (attendees ?? []).filter(a => a.attendance === 'present' || a.attendance === 'late').length;
  const absentCount = (attendees ?? []).filter(a => a.attendance === 'absent').length;

  return (
    <Box sx={{ p: { xs: 2, md: 3 }, bgcolor: '#FBF8F5', minHeight: '100vh' }}>
      {/* Header */}
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, mb: 2 }}>
        <IconButton onClick={onBack} sx={{ color: '#3D484B' }}><ArrowBackIcon /></IconButton>
        <Box sx={{ flex: 1 }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <Typography variant="h5" fontWeight={700} fontFamily="Albert Sans, sans-serif" color="#3D484B">
              {session.group_name}
            </Typography>
            <Chip label={session.group_type} size="small" sx={{ fontSize: 10, bgcolor: '#327C8D15', color: '#327C8D' }} />
            <Chip label={session.status} size="small" color={session.status === 'completed' ? 'success' : 'default'} sx={{ fontSize: 10 }} />
          </Box>
          <Typography variant="body2" color="text.secondary">
            {new Date(session.session_date).toLocaleDateString('en-AU', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}
            {session.start_time && ` at ${session.start_time}`}
            {session.location && ` — ${session.location}`}
            {session.session_number && ` — Session #${session.session_number}`}
          </Typography>
        </Box>
        <Box sx={{ display: 'flex', gap: 1 }}>
          <Button startIcon={<PersonAddIcon />} variant="outlined" size="small" onClick={() => setAddPatientOpen(true)}
            sx={{ textTransform: 'none', borderColor: '#327C8D', color: '#327C8D' }}>
            Add Patient
          </Button>
          {session.status !== 'completed' && (
            <Button startIcon={<CheckCircleIcon />} variant="contained" size="small" onClick={() => completeMut.mutate()}
              sx={{ textTransform: 'none', bgcolor: '#2E7D32', '&:hover': { bgcolor: '#1B5E20' } }}>
              Complete Session
            </Button>
          )}
        </Box>
      </Box>

      {/* Summary chips */}
      <Box sx={{ display: 'flex', gap: 1.5, mb: 2 }}>
        <Chip icon={<PeopleIcon sx={{ fontSize: 14 }} />} label={`${(attendees ?? []).length} enrolled`} size="small" sx={{ bgcolor: '#327C8D15', color: '#327C8D' }} />
        <Chip label={`${presentCount} present`} size="small" sx={{ bgcolor: '#2E7D3215', color: '#2E7D32' }} />
        {absentCount > 0 && <Chip label={`${absentCount} absent`} size="small" sx={{ bgcolor: '#D32F2F15', color: '#D32F2F' }} />}
        {session.topic && <Chip label={`Topic: ${session.topic}`} size="small" variant="outlined" sx={{ fontSize: 10 }} />}
      </Box>

      {/* Tabs */}
      <Tabs aria-label="Navigation tabs" value={tab} onChange={(_, v) => setTab(v)} sx={{ mb: 2, '& .MuiTab-root': { textTransform: 'none', fontWeight: 600, fontSize: 13 } }}>
        <Tab label={`Attendance (${(attendees ?? []).length})`} />
        <Tab label="Session Notes" />
      </Tabs>

      {/* ── Tab 0: Attendance ── */}
      {tab === 0 && (
        <Paper variant="outlined" sx={{ overflow: 'hidden' }}>
          {loadingAttendees ? <Box sx={{ p: 3, textAlign: 'center' }}><CircularProgress role="progressbar" aria-label="Loading" size={24} /></Box> : (
            <Table size="small">
              <TableHead>
                <TableRow sx={{ bgcolor: '#FBF8F5' }}>
                  <TableCell sx={{ fontWeight: 600, width: 200 }}>Patient</TableCell>
                  <TableCell sx={{ fontWeight: 600, width: 80 }}>UR</TableCell>
                  <TableCell sx={{ fontWeight: 600, width: 120 }}>Attendance</TableCell>
                  <TableCell sx={{ fontWeight: 600, width: 130 }}>Participation</TableCell>
                  <TableCell sx={{ fontWeight: 600 }}>Individual Notes</TableCell>
                  <TableCell sx={{ fontWeight: 600, width: 80 }}>Diary</TableCell>
                  <TableCell sx={{ fontWeight: 600, width: 80 }}>HW</TableCell>
                  <TableCell sx={{ fontWeight: 600, width: 100 }}>Actions</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {(attendees ?? []).length === 0 && (
                  <TableRow><TableCell colSpan={8}>
                    <Alert severity="info" sx={{ fontSize: 12 }}>No patients added yet. Click "Add Patient" to enrol patients in this session.</Alert>
                  </TableCell></TableRow>
                )}
                {(attendees ?? []).map(a => (
                  <TableRow key={a.id} sx={{ bgcolor: a.attendance === 'absent' ? '#FFF5F5' : undefined }}>
                    <TableCell sx={{ fontWeight: 500 }}>{a.patient_name ?? 'Unknown'}</TableCell>
                    <TableCell sx={{ fontSize: 12, color: '#327C8D' }}>{a.patient_ur ?? '—'}</TableCell>
                    <TableCell>
                      <Select size="small" value={a.attendance} sx={{ fontSize: 11, height: 28, minWidth: 100 }}
                        onChange={e => updateAttendanceMut.mutate({ attendeeId: a.id, attendance: e.target.value })}>
                        {ATTENDANCE_STATUS.map(s => (
                          <MenuItem key={s} value={s}>
                            <Chip label={s.replace('_', ' ')} size="small"
                              sx={{ fontSize: 9, height: 16, bgcolor: `${ATTENDANCE_COLORS[s]}15`, color: ATTENDANCE_COLORS[s], textTransform: 'capitalize' }} />
                          </MenuItem>
                        ))}
                      </Select>
                    </TableCell>
                    <TableCell>
                      <Rating size="small" value={a.participation_rating ?? 0} max={5}
                        onChange={(_, v) => updateAttendanceMut.mutate({ attendeeId: a.id, participation_rating: v ?? 0 })} />
                    </TableCell>
                    <TableCell>
                      <Typography variant="caption" sx={{ fontSize: 11, color: a.individual_notes ? '#3D484B' : '#999' }}>
                        {a.individual_notes ? (a.individual_notes.length > 60 ? a.individual_notes.substring(0, 60) + '...' : a.individual_notes) : '— no notes —'}
                      </Typography>
                    </TableCell>
                    <TableCell align="center">
                      <Chip label={a.diary_card_completed ? 'Yes' : 'No'} size="small"
                        onClick={() => updateAttendanceMut.mutate({ attendeeId: a.id, diary_card_completed: !a.diary_card_completed })}
                        sx={{ fontSize: 9, height: 18, cursor: 'pointer', bgcolor: a.diary_card_completed ? '#2E7D3215' : '#eee', color: a.diary_card_completed ? '#2E7D32' : '#999' }} />
                    </TableCell>
                    <TableCell align="center">
                      <Chip label={a.homework_completed ? 'Yes' : 'No'} size="small"
                        onClick={() => updateAttendanceMut.mutate({ attendeeId: a.id, homework_completed: !a.homework_completed })}
                        sx={{ fontSize: 9, height: 18, cursor: 'pointer', bgcolor: a.homework_completed ? '#2E7D3215' : '#eee', color: a.homework_completed ? '#2E7D32' : '#999' }} />
                    </TableCell>
                    <TableCell>
                      <Box sx={{ display: 'flex', gap: 0.5 }}>
                        <Tooltip title="Write individual note">
                          <IconButton size="small" onClick={() => { setNotePatient(a); setNoteText(a.individual_notes ?? ''); setNoteDialogOpen(true); }}
                            sx={{ color: '#b8621a' }}>
                            <NoteAddIcon sx={{ fontSize: 16 }} />
                          </IconButton>
                        </Tooltip>
                        <Tooltip title="Remove from session">
                          <IconButton size="small" onClick={() => removePatientMut.mutate(a.id)}
                            sx={{ color: '#D32F2F' }}>
                            <PersonRemoveIcon sx={{ fontSize: 16 }} />
                          </IconButton>
                        </Tooltip>
                      </Box>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </Paper>
      )}

      {/* ── Tab 1: Session Notes ── */}
      {tab === 1 && (
        <Paper variant="outlined" sx={{ p: 2 }}>
          <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 1 }}>
            <Typography variant="subtitle2" fontWeight={600}>Session Notes</Typography>
            <Button size="small" onClick={() => setEditingSessionNotes(!editingSessionNotes)}
              sx={{ textTransform: 'none', color: '#b8621a' }}>
              {editingSessionNotes ? 'Cancel' : 'Edit'}
            </Button>
          </Box>
          {editingSessionNotes ? (
            <Box>
              <TextField fullWidth multiline rows={8} value={sessionNotes} onChange={e => setSessionNotes(e.target.value)}
                sx={{ '& .MuiInputBase-input': { fontFamily: 'monospace', fontSize: 12 } }} />
              <Box sx={{ mt: 1, display: 'flex', justifyContent: 'flex-end' }}>
                <Button variant="contained" size="small" onClick={() => saveSessionNotesMut.mutate(sessionNotes)}
                  disabled={saveSessionNotesMut.isPending}
                  sx={{ bgcolor: '#b8621a', '&:hover': { bgcolor: '#d6741f' }, textTransform: 'none' }}>
                  Save Notes
                </Button>
              </Box>
            </Box>
          ) : (
            <Box sx={{ whiteSpace: 'pre-wrap', fontFamily: 'monospace', fontSize: 12, color: '#3D484B', bgcolor: '#FAFAFA', p: 2, borderRadius: 1, minHeight: 100 }}>
              {sessionNotes || '(No session notes recorded)'}
            </Box>
          )}

          {session.skills_covered && (
            <Box sx={{ mt: 2 }}>
              <Typography variant="caption" fontWeight={600} color="#327C8D">Skills Covered</Typography>
              <Box sx={{ display: 'flex', gap: 0.5, flexWrap: 'wrap', mt: 0.5 }}>
                {session.skills_covered.split(',').map((s, i) => (
                  <Chip key={i} label={s.trim()} size="small" variant="outlined" sx={{ fontSize: 10 }} />
                ))}
              </Box>
            </Box>
          )}
        </Paper>
      )}

      {/* ── Add Patient Dialog ── */}
      <Dialog aria-labelledby="dialog-title" open={addPatientOpen} onClose={() => setAddPatientOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle id="dialog-title" sx={{ fontWeight: 700 }}>Add Patient to Session</DialogTitle>
        <Divider />
        <DialogContent sx={{ pt: 2 }}>
          <Autocomplete
            options={patientResults ?? []}
            getOptionLabel={(p: PatientOption) => `${p.familyName}, ${p.givenName} (UR: ${p.emrNumber})`}
            value={selectedPatient}
            onChange={(_, v) => setSelectedPatient(v)}
            inputValue={patientSearch}
            onInputChange={(_, v) => setPatientSearch(v)}
            isOptionEqualToValue={(a, b) => a.id === b.id}
            renderInput={params => (
              <TextField {...params} label="Search Patient" size="small" placeholder="Type name or UR number..." />
            )}
            noOptionsText={patientSearch.length < 2 ? 'Type at least 2 characters' : 'No patients found'}
          />
        </DialogContent>
        <DialogActions sx={{ px: 3, py: 2 }}>
          <Button onClick={() => setAddPatientOpen(false)} sx={{ textTransform: 'none' }}>Cancel</Button>
          <Button variant="contained" disabled={!selectedPatient || addPatientMut.isPending}
            onClick={() => selectedPatient && addPatientMut.mutate(selectedPatient.id)}
            sx={{ bgcolor: '#327C8D', '&:hover': { bgcolor: '#265f6d' }, textTransform: 'none' }}>
            Add to Session
          </Button>
        </DialogActions>
      </Dialog>

      {/* ── Individual Note Dialog ── */}
      <Dialog aria-labelledby="dialog-title" open={noteDialogOpen} onClose={() => setNoteDialogOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle id="dialog-title" sx={{ fontWeight: 700 }}>
          Individual Note — {notePatient?.patient_name}
        </DialogTitle>
        <Divider />
        <DialogContent sx={{ pt: 2 }}>
          <Alert severity="info" sx={{ mb: 2, fontSize: 12 }}>
            This note will be saved to the patient's clinical record as a group therapy contact and will appear in their episode timeline and contacts tab.
          </Alert>
          <TextField fullWidth multiline rows={6} value={noteText} onChange={e => setNoteText(e.target.value)}
            label="Clinical Note"
            placeholder={`Group: ${session.group_name}\nSession #${session.session_number ?? ''} — ${session.topic ?? ''}\n\nPresentation:\n\nParticipation:\n\nPlan:`}
            sx={{ '& .MuiInputBase-input': { fontFamily: 'monospace', fontSize: 12 } }} />
        </DialogContent>
        <DialogActions sx={{ px: 3, py: 2 }}>
          <Button onClick={() => setNoteDialogOpen(false)} sx={{ textTransform: 'none' }}>Cancel</Button>
          <Button variant="contained" disabled={!noteText.trim() || saveNoteMut.isPending}
            onClick={() => notePatient && saveNoteMut.mutate({ attendeeId: notePatient.id, patientId: notePatient.patientId, note: noteText.trim() })}
            sx={{ bgcolor: '#b8621a', '&:hover': { bgcolor: '#d6741f' }, textTransform: 'none' }}>
            {saveNoteMut.isPending ? 'Saving...' : 'Save Note to Patient Record'}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
