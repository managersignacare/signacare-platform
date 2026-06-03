import AddIcon from '@mui/icons-material/Add';
import CalendarViewWeekIcon from '@mui/icons-material/CalendarViewWeek';
import ChevronLeftIcon from '@mui/icons-material/ChevronLeft';
import ChevronRightIcon from '@mui/icons-material/ChevronRight';
import PersonAddIcon from '@mui/icons-material/PersonAdd';
import TodayIcon from '@mui/icons-material/Today';
import ViewDayIcon from '@mui/icons-material/ViewDay';
import ViewListIcon from '@mui/icons-material/ViewList';
import ViewWeekIcon from '@mui/icons-material/ViewWeek';
import {
    Alert, Box, Button, Card, CardContent, Chip, CircularProgress,
    Dialog, DialogActions, DialogContent, DialogTitle, Divider, FormControl, FormControlLabel,
    Grid, IconButton, InputLabel, MenuItem, Paper, Select, Switch, Tab, Tabs, TextField, ToggleButton, ToggleButtonGroup, Tooltip, Typography
} from '@mui/material';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import React, { useMemo, useState } from 'react';
import { type AppointmentType } from '@signacare/shared';
import { PrintExportButtons } from '../../../../../shared/components/ui/PrintExportButtons';
import { apiClient } from '../../../../../shared/services/apiClient';
import { extractListResponse } from '../../../../../shared/services/extractListResponse';
import {
  episodesKeys,
  patientAppointmentsKeys,
  patientNotesKeys,
  patientReferralsKeys,
  patientsKeys,
} from '../../../queryKeys';
import { useOrgTree } from '../../../../org-settings/hooks/useOrgSettings';
import type { OrgUnit } from '../../../../org-settings/services/orgSettingsApi';
import { ContactFormDialog } from '../../notes/ContactFormDialog';
import { PatientSearchAutocomplete, type PatientOption } from '../../PatientSearchAutocomplete';

function flattenUnits(nodes: OrgUnit[]): { id: string; name: string }[] {
  const r: { id: string; name: string }[] = [];
  function w(l: OrgUnit[], d: number) { for (const n of l) { r.push({ id: n.id, name: '\u00A0'.repeat(d * 2) + n.name }); if (n.children?.length) w(n.children, d + 1); } }
  w(nodes, 0); return r;
}

interface StaffLookupEntry {
  id: string;
  givenName: string;
  familyName: string;
}

interface AppointmentApiRecord {
  id: string;
  title?: string | null;
  startTime: string;
  endTime: string;
  clinicianId?: string | null;
  teamId?: string | null;
  status: string;
  type: string;
  notes?: string | null;
  telehealthLink?: string | null;
}

interface EpisodeSummary {
  id: string;
  title: string;
  episodeType: string;
  status: string;
}

function useStaffLookup() {
  return useQuery({ queryKey: patientsKeys.staffLookup(), queryFn: () => apiClient.get<StaffLookupEntry[]>('staff/lookup'), staleTime: 5 * 60 * 1000 });
}

function useAppointmentModes() {
  return useQuery({ queryKey: patientsKeys.staffSettingsAppointmentModes(), queryFn: () => apiClient.get<{ modes: { id: string; name: string; isActive: boolean }[] }>('staff-settings/appointment-modes').then(r => r.modes), staleTime: 5 * 60 * 1000 });
}

type CalView = 'day' | 'workweek' | 'week' | 'list';

interface Appointment {
  id: string; title: string; date: string; startTime: string; endTime: string;
  clinicianName: string; teamName: string; status: string; type: string; mode?: string;
  patientResponse?: string;
  clinicianId?: string | null;
  teamId?: string | null;
  notes?: string | null;
}

const HOURS = Array.from({ length: 12 }, (_, i) => i + 7);
const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'];
const ALLDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const DURATIONS = [15, 20, 30, 45, 60, 90, 120];
const APPOINTMENT_TYPE_OPTIONS: Array<{ value: AppointmentType; label: string }> = [
  { value: 'clinical_review', label: 'Psychiatrist Review' },
  { value: 'follow_up', label: 'Follow-up' },
  { value: 'assessment', label: 'Assessment' },
  { value: 'initial', label: 'Initial Assessment' },
  { value: 'group', label: 'Group Session' },
  { value: 'telehealth', label: 'Telehealth' },
];
const APPOINTMENT_TYPE_LABEL_BY_VALUE: Record<AppointmentType, string> = APPOINTMENT_TYPE_OPTIONS.reduce(
  (acc, option) => {
    acc[option.value] = option.label;
    return acc;
  },
  {} as Record<AppointmentType, string>,
);
const MBS_ITEMS = ['291 — Consultation (< 45 min)', '293 — Consultation (> 45 min)', '296 — Group therapy', '2710 — Telepsychiatry', '2712 — Telepsychiatry (> 45 min)', '2713 — Review (< 15 min)', '80010 — Focused Psychological Strategy (short)', '80110 — Focused Psychological Strategy (standard)', 'None — No MBS item'];
const REMINDER_OPTIONS = ['1 hour before', '2 hours before', '1 day before', '2 days before', '1 week before'];

function getWeekDates(date: Date, includeWeekend: boolean): Date[] {
  const d = new Date(date); const day = d.getDay(); const diff = d.getDate() - day + (day === 0 ? -6 : 1);
  const mon = new Date(d.setDate(diff)); const days = includeWeekend ? 7 : 5;
  return Array.from({ length: days }, (_, i) => { const dd = new Date(mon); dd.setDate(mon.getDate() + i); return dd; });
}
function formatDate(d: Date): string { return d.toLocaleDateString('en-AU', { day: '2-digit', month: 'short' }); }

const APPT_TYPE_LABELS: Record<string, string> = {
  initial: 'Initial Assessment', follow_up: 'Follow-up', assessment: 'Assessment',
  telehealth: 'Telehealth', group: 'Group Session', clinical_review: 'Clinical Review',
};

interface AppointmentsTabProps { patientId: string }
export function AppointmentsTab({ patientId }: AppointmentsTabProps) {
  const [subTab, setSubTab] = useState<'appointments' | 'contacts' | 'dna'>('appointments');
  return (
    <Box>
      <Tabs aria-label="Navigation tabs" value={subTab} onChange={(_, v) => setSubTab(v)} sx={{ mb: 2, '& .MuiTab-root': { textTransform: 'none', fontFamily: 'Albert Sans, sans-serif', fontSize: 13 } }}>
        <Tab label="Appointments" value="appointments" />
        <Tab label="Contacts" value="contacts" />
        <Tab label="DNA" value="dna" />
      </Tabs>
      {subTab === 'appointments' && <CalendarView patientId={patientId} />}
      {subTab === 'contacts' && <ContactsPanel patientId={patientId} />}
      {subTab === 'dna' && <DNAPanel patientId={patientId} />}
    </Box>
  );
}

// ============ Calendar View ============

interface CalendarViewProps { patientId: string }
function CalendarView({ patientId }: CalendarViewProps) {
  const { data: tree } = useOrgTree();
  const { data: staffList } = useStaffLookup();
  const flatUnits = useMemo(() => tree ? flattenUnits(tree) : [], [tree]);

  const [view, setView] = useState<CalView>('list');
  const [currentDate, setCurrentDate] = useState(new Date());
  const [teamFilter, setTeamFilter] = useState('');
  const [clinicianFilter, setClinicianFilter] = useState('');
  const [addOpen, setAddOpen] = useState(false);
  const [editAppt, setEditAppt] = useState<Appointment | null>(null);

  const goToday = () => setCurrentDate(new Date());
  const goPrev = () => { const d = new Date(currentDate); d.setDate(d.getDate() - (view === 'day' ? 1 : 7)); setCurrentDate(d); };
  const goNext = () => { const d = new Date(currentDate); d.setDate(d.getDate() + (view === 'day' ? 1 : 7)); setCurrentDate(d); };

  const { data: rawAppts = [], isError: appointmentsLoadError } = useQuery({
    queryKey: patientAppointmentsKeys.byPatient(patientId),
    queryFn: async () => {
      const response = await apiClient.get<unknown>('appointments', { patientId });
      return extractListResponse<AppointmentApiRecord>(response, {
        endpoint: 'appointments',
        keys: ['appointments', 'data', 'items'],
      });
    },
    enabled: !!patientId,
    staleTime: 60_000,
  });

  const appointments: Appointment[] = useMemo(() => rawAppts.map((a) => {
    const start = new Date(a.startTime);
    const end = new Date(a.endTime);
    const clinician = (staffList ?? []).find((s) => s.id === a.clinicianId);
    const clinicianName = clinician ? `${clinician.givenName} ${clinician.familyName}` : 'Unknown';
    return {
      id: a.id,
      title: APPT_TYPE_LABELS[a.type] ?? a.type,
      date: start.toISOString().split('T')[0],
      startTime: start.toLocaleTimeString('en-AU', { hour: '2-digit', minute: '2-digit', hour12: false }),
      endTime: end.toLocaleTimeString('en-AU', { hour: '2-digit', minute: '2-digit', hour12: false }),
      clinicianName,
      teamName: '',
      status: a.status,
      type: a.type,
      mode: a.type === 'telehealth' ? 'Telehealth (Video)' : a.telehealthLink ? 'Telehealth (Video)' : 'In Person',
      clinicianId: a.clinicianId ?? null,
      teamId: a.teamId ?? null,
      notes: a.notes ?? null,
    };
  }), [rawAppts, staffList]);

  const filtered = useMemo(() => {
    let appts = appointments;
    if (teamFilter) appts = appts.filter(a => a.teamName.includes(teamFilter));
    if (clinicianFilter) appts = appts.filter(a => a.clinicianName.includes(clinicianFilter));
    return appts;
  }, [appointments, teamFilter, clinicianFilter]);

  const weekDates = useMemo(() => getWeekDates(currentDate, view === 'week'), [currentDate, view]);

  return (
    <Box>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2, flexWrap: 'wrap', gap: 1 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <Button size="small" variant="outlined" onClick={goToday} startIcon={<TodayIcon />} sx={{ textTransform: 'none' }}>Today</Button>
          <IconButton size="small" aria-label="Previous period" onClick={goPrev}><ChevronLeftIcon /></IconButton>
          <IconButton size="small" aria-label="Next period" onClick={goNext}><ChevronRightIcon /></IconButton>
          <Typography variant="subtitle1" fontWeight={600} fontFamily="Albert Sans, sans-serif">
            {view === 'day' ? currentDate.toLocaleDateString('en-AU', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })
              : `${formatDate(weekDates[0])} — ${formatDate(weekDates[weekDates.length - 1])} ${weekDates[0].getFullYear()}`}
          </Typography>
        </Box>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <ToggleButtonGroup value={view} exclusive onChange={(_, v) => { if (v) setView(v); }} size="small">
            <ToggleButton value="day"><Tooltip title="Day"><ViewDayIcon fontSize="small" /></Tooltip></ToggleButton>
            <ToggleButton value="workweek"><Tooltip title="Work Week"><CalendarViewWeekIcon fontSize="small" /></Tooltip></ToggleButton>
            <ToggleButton value="week"><Tooltip title="Full Week"><ViewWeekIcon fontSize="small" /></Tooltip></ToggleButton>
            <ToggleButton value="list"><Tooltip title="List"><ViewListIcon fontSize="small" /></Tooltip></ToggleButton>
          </ToggleButtonGroup>
          <Button size="small" variant="contained" startIcon={<AddIcon />} onClick={() => setAddOpen(true)}
            sx={{ bgcolor: '#b8621a', '&:hover': { bgcolor: '#d6741f' }, textTransform: 'none' }}>New Appointment</Button>
        </Box>
      </Box>
      <Box sx={{ display: 'flex', gap: 1.5, mb: 2, flexWrap: 'wrap' }}>
        <FormControl size="small" sx={{ minWidth: 180 }}><InputLabel>Team / Unit</InputLabel>
          <Select value={teamFilter} onChange={e => setTeamFilter(e.target.value)} label="Team / Unit" sx={{ bgcolor: '#fff' }}>
            <MenuItem value="">All Teams</MenuItem>{flatUnits.map(u => <MenuItem key={u.id} value={u.name}>{u.name}</MenuItem>)}
          </Select></FormControl>
        <FormControl size="small" sx={{ minWidth: 180 }}><InputLabel>Clinician</InputLabel>
          <Select value={clinicianFilter} onChange={e => setClinicianFilter(e.target.value)} label="Clinician" sx={{ bgcolor: '#fff' }}>
            <MenuItem value="">All Clinicians</MenuItem>{(staffList ?? []).map(s => <MenuItem key={s.id} value={`${s.givenName} ${s.familyName}`}>{s.givenName} {s.familyName}</MenuItem>)}
          </Select></FormControl>
      </Box>
      {appointmentsLoadError && (
        <Alert role="alert" severity="error" sx={{ mb: 2 }}>
          Failed to load appointments. Refresh to retry.
        </Alert>
      )}
      {view === 'list' ? <ListView appointments={filtered} onEdit={(a) => { setEditAppt(a); setAddOpen(true); }} /> : view === 'day' ? <DayView date={currentDate} appointments={filtered} /> : <WeekView dates={weekDates} dayLabels={view === 'week' ? ALLDAYS : WEEKDAYS} appointments={filtered} />}
      <NewAppointmentDialog open={addOpen} onClose={() => { setAddOpen(false); setEditAppt(null); }} flatUnits={flatUnits} staffList={staffList ?? []} patientId={patientId} editing={editAppt} />
    </Box>
  );
}

// ============ Week Grid ============
interface WeekViewProps { dates: Date[]; dayLabels: string[]; appointments: Appointment[] }
function WeekView({ dates, dayLabels, appointments }: WeekViewProps) {
  return (
    <Paper variant="outlined" sx={{ overflow: 'auto' }}>
      <Box sx={{ display: 'grid', gridTemplateColumns: `60px repeat(${dates.length}, 1fr)`, minWidth: dates.length > 5 ? 900 : 700 }}>
        <Box sx={{ borderBottom: '1px solid', borderColor: 'divider', p: 0.5, bgcolor: '#FBF8F5' }} />
        {dates.map((d, i) => { const isToday = d.toDateString() === new Date().toDateString(); return (
          <Box key={i} sx={{ borderBottom: '1px solid', borderLeft: '1px solid', borderColor: 'divider', p: 0.5, textAlign: 'center', bgcolor: isToday ? '#FFF3E0' : '#FBF8F5' }}>
            <Typography variant="caption" fontWeight={600} sx={{ color: isToday ? '#b8621a' : '#3D484B' }}>{dayLabels[i]}</Typography>
            <Typography variant="caption" display="block" sx={{ color: isToday ? '#b8621a' : 'text.secondary' }}>{d.getDate()}</Typography>
          </Box>); })}
        {HOURS.map(hour => (<React.Fragment key={hour}>
          <Box sx={{ borderBottom: '1px solid', borderColor: 'divider', p: 0.5, textAlign: 'right', pr: 1 }}><Typography variant="caption" color="text.secondary">{`${hour}:00`}</Typography></Box>
          {dates.map((d, di) => { const dateStr = d.toISOString().split('T')[0]; const slotAppts = appointments.filter(a => a.date === dateStr && parseInt(a.startTime, 10) === hour); return (
            <Box key={di} sx={{ borderBottom: '1px solid', borderLeft: '1px solid', borderColor: 'divider', minHeight: 48, p: 0.25 }}>
              {slotAppts.map(a => (
                <Tooltip key={a.id} title={`${a.clinicianName} | ${a.mode || ''} ${a.patientResponse ? `| Patient: ${a.patientResponse}` : ''}`}>
                  <Box sx={{ bgcolor: a.patientResponse === 'accepted' ? '#E8F5E9' : a.patientResponse === 'rejected' ? '#FFEBEE' : '#E3F2FD', borderLeft: `3px solid ${a.patientResponse === 'accepted' ? '#4CAF50' : a.patientResponse === 'rejected' ? '#D32F2F' : '#2196F3'}`, borderRadius: 0.5, p: 0.5, mb: 0.25, cursor: 'pointer' }}>
                    <Typography variant="caption" fontWeight={600} sx={{ fontSize: 10, display: 'block', lineHeight: 1.2 }}>{a.title}</Typography>
                    <Typography variant="caption" sx={{ fontSize: 9, color: 'text.secondary' }}>{a.startTime}–{a.endTime}</Typography>
                  </Box>
                </Tooltip>))}
            </Box>); })}
        </React.Fragment>))}
      </Box>
    </Paper>
  );
}

// ============ Day View ============
interface DayViewProps { date: Date; appointments: Appointment[] }
function DayView({ date, appointments }: DayViewProps) {
  const dateStr = date.toISOString().split('T')[0]; const dayAppts = appointments.filter(a => a.date === dateStr);
  return (
    <Paper variant="outlined" sx={{ overflow: 'auto' }}>
      <Box sx={{ display: 'grid', gridTemplateColumns: '60px 1fr', minWidth: 400 }}>
        {HOURS.map(hour => { const slotAppts = dayAppts.filter(a => parseInt(a.startTime, 10) === hour); return (<React.Fragment key={hour}>
          <Box sx={{ borderBottom: '1px solid', borderColor: 'divider', p: 0.5, textAlign: 'right', pr: 1 }}><Typography variant="caption" color="text.secondary">{`${hour}:00`}</Typography></Box>
          <Box sx={{ borderBottom: '1px solid', borderLeft: '1px solid', borderColor: 'divider', minHeight: 56, p: 0.5 }}>
            {slotAppts.map(a => (
              <Box key={a.id} sx={{ bgcolor: a.patientResponse === 'accepted' ? '#E8F5E9' : '#E3F2FD', borderLeft: `3px solid ${a.patientResponse === 'accepted' ? '#4CAF50' : '#2196F3'}`, borderRadius: 1, p: 1, mb: 0.5 }}>
                <Typography variant="body2" fontWeight={600} sx={{ fontSize: 13 }}>{a.title}</Typography>
                <Typography variant="caption" color="text.secondary">{a.startTime}–{a.endTime} | {a.clinicianName} | {a.mode || ''}</Typography>
                {a.patientResponse && <Chip label={`Patient: ${a.patientResponse}`} size="small" sx={{ ml: 1, fontSize: 9, height: 18 }} color={a.patientResponse === 'accepted' ? 'success' : a.patientResponse === 'rejected' ? 'error' : 'default'} />}
              </Box>))}
          </Box></React.Fragment>); })}
      </Box>
    </Paper>
  );
}

// ============ List View ============
interface ListViewProps { appointments: Appointment[]; onEdit?: (a: Appointment) => void }
function ListView({ appointments, onEdit }: ListViewProps) {
  const sorted = [...appointments].sort((a, b) => `${a.date}${a.startTime}`.localeCompare(`${b.date}${b.startTime}`));
  if (!sorted.length) return <Alert severity="info">No appointments to display.</Alert>;
  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
      {sorted.map(a => (
        <Card key={a.id} variant="outlined" sx={{ '&:hover': { borderColor: '#b8621a' } }}>
          <CardContent sx={{ py: 1.5, '&:last-child': { pb: 1.5 }, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <Box>
              <Typography variant="body2" fontWeight={600}>{a.title}</Typography>
              <Typography variant="caption" color="text.secondary">
                {new Date(a.date).toLocaleDateString('en-AU', { weekday: 'short', day: 'numeric', month: 'short' })} | {a.startTime}–{a.endTime} | {a.clinicianName} | {a.teamName} | {a.mode || ''}
              </Typography>
            </Box>
            <Box sx={{ display: 'flex', gap: 0.5, alignItems: 'center' }}>
              {a.patientResponse && <Chip label={`Patient: ${a.patientResponse}`} size="small" sx={{ fontSize: 9, height: 18 }} color={a.patientResponse === 'accepted' ? 'success' : a.patientResponse === 'rejected' ? 'error' : 'default'} />}
              <Chip label={a.status} size="small" color={a.status === 'confirmed' ? 'success' : 'info'} sx={{ fontSize: 10, height: 20, textTransform: 'capitalize' }} />
              {onEdit && <Button size="small" onClick={() => onEdit(a)} sx={{ fontSize: 10, minWidth: 0, color: '#327C8D' }}>Edit</Button>}
            </Box>
          </CardContent>
        </Card>))}
    </Box>
  );
}

// ============ Enhanced Appointment Dialog ============

function NewAppointmentDialog({ open, onClose, flatUnits, staffList, patientId, editing }: {
  open: boolean; onClose: () => void;
  flatUnits: { id: string; name: string }[];
  staffList: { id: string; givenName: string; familyName: string }[];
  patientId?: string;
  editing?: Appointment | null;
}) {
  const { data: modes } = useAppointmentModes();
  const activeEpisodes = useQuery({
    queryKey: episodesKeys.active(patientId ?? ''),
    queryFn: () => apiClient.get<{ data: EpisodeSummary[] }>(`episodes/patient/${patientId}`).then(r => r.data?.filter(e => e.status === 'open') ?? []),
    enabled: !!patientId,
  });

  // Patient search (for sidebar appointment creation)
  // When `patientId` is supplied by the parent, we don't render the
  // search field at all (see `{!patientId && (...)}` below); when it's
  // not supplied, this state captures the user's selection.
  const [selectedPatient, setSelectedPatient] = useState<PatientOption | null>(null);
  const selectedPatientId = selectedPatient?.id ?? '';

  const [title, setTitle] = useState('');
  const [date, setDate] = useState(new Date().toISOString().split('T')[0]);
  const [startTime, setStartTime] = useState('09:00');
  const [duration, setDuration] = useState(30);
  const [endTime, setEndTime] = useState('09:30');
  const [clinician, setClinician] = useState('');
  const [team, setTeam] = useState('');
  const [apptType, setApptType] = useState<AppointmentType>('clinical_review');
  const [mode, setMode] = useState('');
  const [telehealthLink, setTelehealthLink] = useState('');
  const [episodeId, setEpisodeId] = useState('');
  const [mbsItem, setMbsItem] = useState('');
  const [inviteEmails, setInviteEmails] = useState('');
  const [reminders, setReminders] = useState<string[]>(['1 day before']);
  const [notes, setNotes] = useState('');
  const [checklistItems, setChecklistItems] = useState<string[]>([]);
  const [newCheckItem, setNewCheckItem] = useState('');
  const [sendPatientReminder, setSendPatientReminder] = useState(true);
  const [recurrence, setRecurrence] = useState('none');
  const [recurrenceEnd, setRecurrenceEnd] = useState('');
  const [recurrenceDays, setRecurrenceDays] = useState<number[]>([]);
  const [recurrenceTime, setRecurrenceTime] = useState('');
  const [savingAppt, setSavingAppt] = useState(false);
  const qc = useQueryClient();

  // Pre-fill form when editing
  React.useEffect(() => {
    if (editing && open) {
      setTitle(editing.title || '');
      setDate(editing.date || new Date().toISOString().split('T')[0]);
      setStartTime(editing.startTime || '09:00');
      setEndTime(editing.endTime || '09:30');
      setClinician(editing.clinicianId ?? '');
      setTeam(editing.teamId ?? '');
      setApptType((editing.type as AppointmentType) || 'clinical_review');
      setMode(editing.mode || '');
      setNotes(editing.notes || '');
    }
  }, [editing, open]);

  // Auto-calculate end time from start + duration
  React.useEffect(() => {
    const [h, m] = (startTime ?? '00:00').split(':').map(Number);
    const totalMin = h * 60 + m + duration;
    const eh = Math.floor(totalMin / 60);
    const em = totalMin % 60;
    setEndTime(`${String(eh).padStart(2, '0')}:${String(em).padStart(2, '0')}`);
  }, [startTime, duration]);

  const isTelehealth = mode?.toLowerCase().includes('telehealth');

  const handleReminderToggle = (reminder: string) => {
    setReminders(prev => prev.includes(reminder) ? prev.filter(r => r !== reminder) : [...prev, reminder]);
  };

  return (
    <Dialog aria-labelledby="dialog-title" open={open} onClose={onClose} maxWidth="md" fullWidth>
      <DialogTitle id="dialog-title" sx={{ fontFamily: 'Albert Sans, sans-serif', fontWeight: 700 }}>{editing ? 'Edit Appointment' : 'New Appointment'}</DialogTitle>
      <Divider />
      <DialogContent>
        <Grid container spacing={2} sx={{ mt: 0.5 }}>

          {/* Patient search — only if no patientId provided. Shape C: MUI Autocomplete (BUG-447 child 8/15) */}
          {!patientId && (
            <Grid size={{ xs: 12 }}>
              <Typography variant="subtitle2" sx={{ mb: 0.5 }}>Patient</Typography>
              <PatientSearchAutocomplete
                value={selectedPatient}
                onChange={setSelectedPatient}
                placeholder="Search patient by name or UR number…"
                fullWidth
              />
            </Grid>
          )}

          {/* Episode */}
          <Grid size={{ xs: 12, sm: 6 }}>
            <FormControl fullWidth size="small">
              <InputLabel>Episode</InputLabel>
              <Select value={episodeId} onChange={e => setEpisodeId(e.target.value)} label="Episode">
                <MenuItem value="">— No episode —</MenuItem>
                {(activeEpisodes.data ?? []).map((ep) => <MenuItem key={ep.id} value={ep.id}>{ep.title} ({ep.episodeType})</MenuItem>)}
              </Select>
            </FormControl>
          </Grid>

          <Grid size={{ xs: 12, sm: 6 }}>
            <FormControl fullWidth size="small">
              <InputLabel>Appointment Type</InputLabel>
              <Select value={apptType} onChange={e => { const nextType = e.target.value as AppointmentType; setApptType(nextType); if (!title) setTitle(APPOINTMENT_TYPE_LABEL_BY_VALUE[nextType] ?? nextType); }} label="Appointment Type">
                {APPOINTMENT_TYPE_OPTIONS.map(t => <MenuItem key={t.value} value={t.value}>{t.label}</MenuItem>)}
              </Select>
            </FormControl>
          </Grid>

          <Grid size={{ xs: 12 }}>
            <TextField label="Title *" fullWidth size="small" value={title} onChange={e => setTitle(e.target.value)} placeholder="e.g. Psychiatrist Review" />
          </Grid>

          {/* Date, Time, Duration */}
          <Grid size={{ xs: 12, sm: 3 }}>
            <TextField label="Date" type="date" fullWidth size="small" value={date} onChange={e => setDate(e.target.value)} slotProps={{ inputLabel: { shrink: true } }} />
          </Grid>
          <Grid size={{ xs: 6, sm: 3 }}>
            <TextField label="Start Time" type="time" fullWidth size="small" value={startTime} onChange={e => setStartTime(e.target.value)} slotProps={{ inputLabel: { shrink: true } }} />
          </Grid>
          <Grid size={{ xs: 6, sm: 3 }}>
            <FormControl fullWidth size="small">
              <InputLabel>Duration</InputLabel>
              <Select value={duration} onChange={e => setDuration(Number(e.target.value))} label="Duration">
                {DURATIONS.map(d => <MenuItem key={d} value={d}>{d} min</MenuItem>)}
              </Select>
            </FormControl>
          </Grid>
          <Grid size={{ xs: 6, sm: 3 }}>
            <TextField label="End Time" type="time" fullWidth size="small" value={endTime} onChange={e => setEndTime(e.target.value)} slotProps={{ inputLabel: { shrink: true } }} />
          </Grid>

          {/* Mode */}
          <Grid size={{ xs: 12, sm: 6 }}>
            <FormControl fullWidth size="small">
              <InputLabel>Mode</InputLabel>
              <Select value={mode} onChange={e => setMode(e.target.value)} label="Mode">
                <MenuItem value="">—</MenuItem>
                {(modes ?? []).filter(m => m.isActive).map(m => <MenuItem key={m.id} value={m.name}>{m.name}</MenuItem>)}
              </Select>
            </FormControl>
          </Grid>

          {isTelehealth && (
            <Grid size={{ xs: 12, sm: 6 }}>
              <TextField label="Telehealth Link" fullWidth size="small" value={telehealthLink} onChange={e => setTelehealthLink(e.target.value)} placeholder="https://meet.example.com/..." />
            </Grid>
          )}

          {/* Clinician & Team */}
          <Grid size={{ xs: 12, sm: 6 }}>
            <FormControl fullWidth size="small">
              <InputLabel>Clinician</InputLabel>
              <Select value={clinician} onChange={e => setClinician(e.target.value)} label="Clinician">
                <MenuItem value="">—</MenuItem>
                {staffList.map(s => <MenuItem key={s.id} value={s.id}>{s.givenName} {s.familyName}</MenuItem>)}
              </Select>
            </FormControl>
          </Grid>
          <Grid size={{ xs: 12, sm: 6 }}>
            <FormControl fullWidth size="small">
              <InputLabel>Team / Unit</InputLabel>
              <Select value={team} onChange={e => setTeam(e.target.value)} label="Team / Unit">
                <MenuItem value="">—</MenuItem>
                {flatUnits.map(u => <MenuItem key={u.id} value={u.id}>{u.name}</MenuItem>)}
              </Select>
            </FormControl>
          </Grid>

          {/* MBS Item */}
          <Grid size={{ xs: 12, sm: 6 }}>
            <FormControl fullWidth size="small">
              <InputLabel>MBS Item</InputLabel>
              <Select value={mbsItem} onChange={e => setMbsItem(e.target.value)} label="MBS Item">
                <MenuItem value="">— None —</MenuItem>
                {MBS_ITEMS.map(m => <MenuItem key={m} value={m}>{m}</MenuItem>)}
              </Select>
            </FormControl>
          </Grid>

          {/* Invite others */}
          <Grid size={{ xs: 12, sm: 6 }}>
            <TextField label="Invite Others (emails, comma separated)" fullWidth size="small" value={inviteEmails} onChange={e => setInviteEmails(e.target.value)} placeholder="dr.smith@example.com, nurse@clinic.com" />
          </Grid>

          {/* Reminders */}
          <Grid size={{ xs: 12 }}>
            <Typography variant="subtitle2" sx={{ mb: 0.5 }}>Reminders</Typography>
            <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap', alignItems: 'center' }}>
              {REMINDER_OPTIONS.map(r => (
                <Chip key={r} label={r} size="small" variant={reminders.includes(r) ? 'filled' : 'outlined'}
                  onClick={() => handleReminderToggle(r)}
                  sx={{ cursor: 'pointer', ...(reminders.includes(r) ? { bgcolor: '#b8621a', color: '#fff' } : {}) }} />
              ))}
            </Box>
            <FormControlLabel sx={{ mt: 0.5 }}
              control={<Switch size="small" checked={sendPatientReminder} onChange={(_, v) => setSendPatientReminder(v)} sx={{ '& .Mui-checked': { color: '#b8621a' } }} />}
              label={<Typography variant="caption">Send reminder to patient app</Typography>} />
          </Grid>

          {/* Notes */}
          <Grid size={{ xs: 12 }}>
            <TextField label="Notes" fullWidth size="small" multiline rows={2} value={notes} onChange={e => setNotes(e.target.value)} />
          </Grid>

          {/* Recurring Appointment */}
          {!editing && (
            <>
              <Grid size={{ xs: 12, sm: 6 }}>
                <FormControl fullWidth size="small">
                  <InputLabel>Recurring</InputLabel>
                  <Select value={recurrence} onChange={e => { setRecurrence(e.target.value); if (e.target.value === 'none') { setRecurrenceDays([]); setRecurrenceTime(''); } }} label="Recurring">
                    <MenuItem value="none">One-off</MenuItem>
                    <MenuItem value="daily">Daily</MenuItem>
                    <MenuItem value="weekly">Weekly</MenuItem>
                    <MenuItem value="fortnightly">Fortnightly</MenuItem>
                    <MenuItem value="monthly">Monthly</MenuItem>
                  </Select>
                </FormControl>
              </Grid>
              {recurrence !== 'none' && (
                <>
                  <Grid size={{ xs: 12, sm: 6 }}>
                    <TextField label="Recurrence End Date" type="date" fullWidth size="small" value={recurrenceEnd} onChange={e => setRecurrenceEnd(e.target.value)}
                      slotProps={{ inputLabel: { shrink: true } }} />
                  </Grid>
                  {(recurrence === 'weekly' || recurrence === 'fortnightly') && (
                    <Grid size={{ xs: 12 }}>
                      <Typography variant="caption" color="text.secondary" sx={{ mb: 0.5, display: 'block' }}>Repeat on days</Typography>
                      <Box sx={{ display: 'flex', gap: 0.5, flexWrap: 'wrap' }}>
                        {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((day, idx) => (
                          <Chip key={day} label={day} size="small"
                            variant={recurrenceDays.includes(idx) ? 'filled' : 'outlined'}
                            onClick={() => setRecurrenceDays(prev => prev.includes(idx) ? prev.filter(d => d !== idx) : [...prev, idx].sort())}
                            sx={{ cursor: 'pointer', fontSize: 11, minWidth: 44, ...(recurrenceDays.includes(idx) ? { bgcolor: '#327C8D', color: '#fff' } : {}) }} />
                        ))}
                      </Box>
                    </Grid>
                  )}
                  <Grid size={{ xs: 12, sm: 4 }}>
                    <TextField label="Recurrence Time" type="time" fullWidth size="small"
                      value={recurrenceTime || startTime} onChange={e => setRecurrenceTime(e.target.value)}
                      slotProps={{ inputLabel: { shrink: true } }}
                      helperText="Time for each recurring appointment" />
                  </Grid>
                </>
              )}
            </>
          )}
        </Grid>

        {/* Pre-Appointment Checklist for Viva App */}
        <Box sx={{ mt: 2, p: 2, bgcolor: '#F3E5F5', borderRadius: 2 }}>
          <Typography variant="subtitle2" sx={{ fontWeight: 700, color: '#7B1FA2', mb: 1 }}>
            📋 Pre-Appointment Checklist (Viva App)
          </Typography>
          <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 1 }}>
            Items here will be sent to the patient's Viva app as a checklist to complete before the appointment.
          </Typography>
          {checklistItems.map((item, i) => (
            <Box key={i} sx={{ display: 'flex', alignItems: 'center', py: 0.3 }}>
              <Typography sx={{ fontSize: 12, flex: 1 }}>• {item}</Typography>
              <Button size="small" sx={{ fontSize: 9, minWidth: 0, color: '#D32F2F' }}
                onClick={() => setChecklistItems(prev => prev.filter((_, idx) => idx !== i))}>✕</Button>
            </Box>
          ))}
          <Box sx={{ display: 'flex', gap: 1, mt: 0.5 }}>
            <input value={newCheckItem} onChange={e => setNewCheckItem(e.target.value)}
              placeholder="e.g. Bring Medicare card, blood test results..."
              onKeyDown={e => { if (e.key === 'Enter' && newCheckItem.trim()) { setChecklistItems(prev => [...prev, newCheckItem.trim()]); setNewCheckItem(''); } }}
              style={{ flex: 1, padding: '6px 10px', border: '1px solid #CE93D8', borderRadius: 6, fontSize: 12, background: 'white' }} />
            <Button size="small" variant="outlined" disabled={!newCheckItem.trim()}
              onClick={() => { if (newCheckItem.trim()) { setChecklistItems(prev => [...prev, newCheckItem.trim()]); setNewCheckItem(''); } }}
              sx={{ fontSize: 10, borderColor: '#7B1FA2', color: '#7B1FA2' }}>Add</Button>
          </Box>
        </Box>
      </DialogContent>
      <Divider />
      <DialogActions sx={{ px: 3, py: 2 }}>
        <Button onClick={onClose} sx={{ color: 'text.secondary' }}>Cancel</Button>
        <Button variant="contained" disabled={!title.trim() || savingAppt}
          onClick={async () => {
            setSavingAppt(true);
            try {
              const pid = selectedPatientId || patientId;
              // Build ISO datetime from date + time
              const startIso = `${date}T${startTime || '09:00'}:00`;
              const endIso = `${date}T${endTime || '09:30'}:00`;
              const isRecurring = !editing && recurrence !== 'none';
              const method = editing ? apiClient.patch : apiClient.post;
              const url = editing ? `appointments/${editing.id}` : isRecurring ? 'appointments/recurring' : 'appointments';

              if (editing) {
                // PATCH — send only fields accepted by UpdateAppointmentDTO
                await method(url, {
                  clinicianId: clinician || undefined,
                  startTime: startIso,
                  endTime: endIso,
                  type: apptType || 'follow_up',
                  episodeId: episodeId || null,
                  notes: notes || undefined,
                  ...(telehealthLink ? {
                    telehealthDetails: {
                      telehealthLink,
                      telehealthProvider: undefined,
                      telehealthPasscode: undefined,
                    },
                  } : {}),
                });
              } else {
                // POST — send full CreateAppointmentDTO
                await method(url, {
                  patientId: pid,
                  clinicianId: clinician || undefined,
                  startTime: startIso,
                  endTime: endIso,
                  type: apptType || 'follow_up',
                  episodeId: episodeId || undefined,
                  notes: notes || undefined,
                  ...(telehealthLink ? {
                    telehealthDetails: {
                      telehealthLink,
                      telehealthProvider: undefined,
                      telehealthPasscode: undefined,
                    },
                  } : {}),
                  ...(isRecurring ? {
                    recurrenceRule: recurrence,
                    recurrenceEndDate: recurrenceEnd || undefined,
                    recurrenceDays: recurrenceDays.length > 0 ? recurrenceDays : undefined,
                    recurrenceTime: recurrenceTime || startTime || undefined,
                  } : {}),
                });
              }
              qc.invalidateQueries({ queryKey: patientAppointmentsKeys.all });
              qc.invalidateQueries({ queryKey: patientsKeys.appointments(pid ?? '') });
              // Save checklist items to Viva if any
              if (checklistItems.length > 0 && pid) {
                for (let ci = 0; ci < checklistItems.length; ci++) {
                  try {
                    await apiClient.post(`patient-app/checklists/${pid}`, { item: checklistItems[ci], sortOrder: ci });
                  } catch { /* non-critical */ }
                }
              }
              onClose();
            } catch { /* error handled by global handler */ }
            setSavingAppt(false);
          }}
          sx={{ bgcolor: '#b8621a', '&:hover': { bgcolor: '#d6741f' } }}>
          {savingAppt ? 'Creating...' : 'Create Appointment'}
        </Button>
      </DialogActions>
    </Dialog>
  );
}

// ============ Shared helpers ============

interface ContactMeta {
  contactDate?: string; contactTime?: string; durationMin?: number | string;
  team?: string; numProvidingService?: number; numReceivingService?: number;
  location?: string; contactMedium?: string; program?: string;
  serviceRecipients?: string[];
}

interface PatientNote {
  id: string; title: string; noteType: string; content: string; status: string;
  didNotAttend: boolean; authorName: string; createdAt: string; episodeTitle: string;
  isReportableContact?: boolean; contactMeta?: ContactMeta | null;
}

function usePatientNotes(patientId: string) {
  return useQuery({
    queryKey: patientNotesKeys.patientAll(patientId),
    queryFn: () => apiClient.get<{ notes: PatientNote[] }>(`patients/${patientId}/notes`).then(r => r.notes ?? []),
    enabled: !!patientId,
  });
}

// ============ Contacts Panel — Timeline ============

const NOTE_TYPE_COLORS: Record<string, string> = {
  progress: '#327C8D', ward_round: '#5C6BC0', intake: '#b8621a',
  lai: '#D32F2F', clozapine: '#7B1FA2', review: '#0288D1',
  collateral: '#455A64', phone: '#00838F', home_visit: '#558B2F',
  case_conference: '#E65100', group: '#AD1457', contact: '#327C8D',
  physical_health: '#2E7D32', incident: '#B71C1C',
};

const NOTE_TYPE_LABELS_LOCAL: Record<string, string> = {
  progress: 'Progress Note', ward_round: 'Ward Round', intake: 'Intake',
  lai: 'LAI Admin', clozapine: 'Clozapine', review: 'Review',
  collateral: 'Collateral', phone: 'Phone/Telehealth', home_visit: 'Home Visit',
  case_conference: 'Case Conf/MDT', group: 'Group', contact: 'Contact',
  physical_health: 'Physical Health', incident: 'Incident',
};

const CONTACTS_COLS = [
  { label: 'Date / Time', flex: 1.8 },
  { label: 'Type', flex: 1.6 },
  { label: 'Duration', flex: 0.9 },
  { label: 'Team', flex: 1.5 },
  { label: 'Location', flex: 1.5 },
  { label: 'Medium', flex: 1.5 },
  { label: 'Program', flex: 1.8 },
  { label: 'Recipients', flex: 1.5 },
  { label: 'ABF', flex: 0.8 },
];

function buildContactsCsv(contacts: PatientNote[]): string {
  const header = 'Date,Time,Type,Duration,Team,Location,Medium,Program,Recipients,ABF,Author,Status';
  const rows = contacts.map(n => {
    const m = n.contactMeta;
    const date = m?.contactDate ? new Date(m.contactDate).toLocaleDateString('en-AU') : new Date(n.createdAt).toLocaleDateString('en-AU');
    const time = m?.contactTime ?? '';
    const recipients = Array.isArray(m?.serviceRecipients) ? m.serviceRecipients.join('; ') : typeof m?.serviceRecipients === 'string' ? m.serviceRecipients : '';
    return [date, time, n.noteType, m?.durationMin ?? '', m?.team ?? '', m?.location ?? '', m?.contactMedium ?? '', m?.program ?? '', recipients, n.isReportableContact !== false ? 'Yes' : 'No', n.authorName ?? '', n.status ?? ''].map(v => `"${String(v).replace(/"/g, '""')}"`).join(',');
  });
  return [header, ...rows].join('\n');
}

interface ContactsPanelProps { patientId: string }
function ContactsPanel({ patientId }: ContactsPanelProps) {
  const qc = useQueryClient();
  const [addOpen, setAddOpen] = useState(false);
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());

  // Fetch from the unified contacts API (merges clinicalnotes + contact_records)
  const { data: contactsResponse, isLoading } = useQuery({
    queryKey: patientReferralsKeys.unifiedContacts(patientId),
    queryFn: () => apiClient.get<{ contacts: PatientNote[]; total: number }>(`contact-records/patient/${patientId}/unified`),
    enabled: !!patientId,
  });

  const contacts = useMemo(() => {
    const raw = contactsResponse?.contacts ?? [];
    return raw.filter((n) => !n.didNotAttend);
  }, [contactsResponse]);

  const toggle = (id: string) =>
    setExpandedIds(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });

  return (
    <Box>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2.5 }}>
        <Box>
          <Typography variant="subtitle1" fontWeight={700} fontFamily="Albert Sans, sans-serif">
            Contacts / Encounters
          </Typography>
          <Typography variant="caption" color="text.secondary">
            {contacts.length} total · click any row to expand note content
          </Typography>
        </Box>
        <Box sx={{ display: 'flex', gap: 1 }}>
          <Button size="small" variant="outlined"
            onClick={() => window.open(`${import.meta.env.VITE_API_URL}/contact-records/patient/${patientId}/unified?format=csv`, '_blank')}
            sx={{ textTransform: 'none', fontSize: 11, borderColor: '#327C8D', color: '#327C8D' }}>
            Export CSV
          </Button>
          <PrintExportButtons content={buildContactsCsv(contacts)} title={`Contacts — ${patientId}`} compact />
          <Button startIcon={<PersonAddIcon />} variant="contained" size="small" onClick={() => setAddOpen(true)}
            sx={{ bgcolor: '#b8621a', '&:hover': { bgcolor: '#d6741f' }, textTransform: 'none' }}>
            Add Contact
          </Button>
        </Box>
      </Box>

      {isLoading && <CircularProgress role="progressbar" aria-label="Loading" size={24} />}

      {!isLoading && contacts.length === 0 && (
        <Alert severity="info">No contact records. Click "Add Contact" to log an encounter.</Alert>
      )}

      {contacts.length > 0 && (
        <Paper elevation={0} sx={{ border: '1px solid', borderColor: 'divider', borderRadius: 2, overflow: 'hidden' }}>
          {/* Header row */}
          <Box sx={{ px: 2, py: 1, bgcolor: '#F5F7F8', display: 'flex', gap: 1, borderBottom: '1px solid', borderColor: 'divider' }}>
            {CONTACTS_COLS.map(c => (
              <Typography key={c.label} variant="caption" sx={{ flex: c.flex, fontWeight: 700, fontSize: 11, color: '#5A6672' }}>
                {c.label}
              </Typography>
            ))}
          </Box>

          {contacts.map((n, i) => {
            const m = n.contactMeta;
            const color = NOTE_TYPE_COLORS[n.noteType] ?? '#327C8D';
            const isExpanded = expandedIds.has(n.id);

            const displayDate = m?.contactDate
              ? new Date(m.contactDate).toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric' })
              : new Date(n.createdAt).toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric' });
            const displayTime = m?.contactTime
              ?? new Date(n.createdAt).toLocaleTimeString('en-AU', { hour: '2-digit', minute: '2-digit', hour12: false });

            return (
              <React.Fragment key={n.id}>
                <Box
                  role="button"
                  tabIndex={0}
                  aria-expanded={isExpanded}
                  aria-label={`${n.title || NOTE_TYPE_LABELS_LOCAL[n.noteType] || n.noteType} on ${displayDate} at ${displayTime} — ${isExpanded ? 'collapse' : 'expand'}`}
                  onClick={() => toggle(n.id)}
                  onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(n.id); } }}
                  sx={{
                    px: 2, py: 1.25, display: 'flex', gap: 1, alignItems: 'center',
                    borderTop: i > 0 ? '1px solid' : 'none', borderColor: 'divider',
                    cursor: 'pointer', borderLeft: `3px solid ${color}`,
                    bgcolor: isExpanded ? '#FAFAFA' : '#fff',
                    '&:hover': { bgcolor: '#F9F4EF' },
                    '&:focus-visible': { outline: '2px solid #b8621a', outlineOffset: -2 },
                    transition: 'background 0.1s',
                  }}
                >
                  {/* Date / Time */}
                  <Box sx={{ flex: 1.8, minWidth: 0 }}>
                    <Typography variant="body2" sx={{ fontSize: 12, fontWeight: 500 }}>{displayDate}</Typography>
                    <Typography variant="caption" color="text.secondary" sx={{ fontSize: 10 }}>{displayTime}</Typography>
                  </Box>

                  {/* Type */}
                  <Box sx={{ flex: 1.6, minWidth: 0 }}>
                    <Typography variant="body2" fontWeight={600} sx={{ fontSize: 12, lineHeight: 1.3, mb: 0.25 }} noWrap>
                      {n.title || NOTE_TYPE_LABELS_LOCAL[n.noteType] || n.noteType}
                    </Typography>
                    <Chip label={NOTE_TYPE_LABELS_LOCAL[n.noteType] ?? n.noteType} size="small"
                      sx={{ fontSize: 9, height: 14, bgcolor: color + '18', color, fontWeight: 600 }} />
                  </Box>

                  {/* Duration */}
                  <Typography variant="body2" sx={{ flex: 0.9, fontSize: 12, color: 'text.secondary' }}>
                    {m?.durationMin ? `${m.durationMin} min` : '—'}
                  </Typography>

                  {/* Team */}
                  <Typography variant="body2" sx={{ flex: 1.5, fontSize: 12, color: 'text.secondary' }} noWrap>
                    {m?.team || '—'}
                  </Typography>

                  {/* Location */}
                  <Typography variant="body2" sx={{ flex: 1.5, fontSize: 12, color: 'text.secondary' }} noWrap>
                    {m?.location || '—'}
                  </Typography>

                  {/* Medium */}
                  <Typography variant="body2" sx={{ flex: 1.5, fontSize: 12, color: 'text.secondary' }} noWrap>
                    {m?.contactMedium || '—'}
                  </Typography>

                  {/* Program */}
                  <Typography variant="body2" sx={{ flex: 1.8, fontSize: 12, color: 'text.secondary' }} noWrap>
                    {m?.program || '—'}
                  </Typography>

                  {/* Service Recipients */}
                  <Typography variant="body2" sx={{ flex: 1.5, fontSize: 12, color: 'text.secondary' }} noWrap>
                    {Array.isArray(m?.serviceRecipients) ? m.serviceRecipients.join(', ') : typeof m?.serviceRecipients === 'string' ? m.serviceRecipients : '—'}
                  </Typography>

                  {/* ABF */}
                  <Box sx={{ flex: 0.8 }}>
                    {n.isReportableContact !== false
                      ? <Chip label="ABF" size="small" sx={{ fontSize: 9, height: 16, bgcolor: '#E8F5E9', color: '#2E7D32', fontWeight: 700 }} />
                      : <Chip label="Non-ABF" size="small" sx={{ fontSize: 9, height: 16, bgcolor: '#FFF8E1', color: '#E65100' }} />
                    }
                  </Box>
                </Box>

                {/* Expanded detail row */}
                {isExpanded && (
                  <Box sx={{ px: 2, pb: 2, pt: 1.25, bgcolor: '#FAFAFA', borderTop: '1px solid', borderColor: 'divider' }}>
                    <Box sx={{ display: 'flex', gap: 3, flexWrap: 'wrap', mb: 1 }}>
                      {m?.numProvidingService != null && (
                        <Typography variant="caption" color="text.secondary">
                          Providing service: <strong>{m.numProvidingService}</strong>
                        </Typography>
                      )}
                      {m?.numReceivingService != null && (
                        <Typography variant="caption" color="text.secondary">
                          Receiving service: <strong>{m.numReceivingService}</strong>
                        </Typography>
                      )}
                      {n.authorName && (
                        <Typography variant="caption" color="text.secondary">
                          Author: <strong>{n.authorName}</strong>
                        </Typography>
                      )}
                      {n.status === 'signed' && (
                        <Chip label="Signed" size="small" color="success" sx={{ fontSize: 9, height: 16 }} />
                      )}
                    </Box>
                    {n.episodeTitle && (
                      <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 0.75 }}>
                        Episode: <strong>{n.episodeTitle}</strong>
                      </Typography>
                    )}
                    {n.content ? (
                      <Box sx={{
                        p: 1.5, bgcolor: '#fff', borderRadius: 1,
                        whiteSpace: 'pre-wrap', fontFamily: 'monospace', fontSize: 11,
                        color: '#3D484B', maxHeight: 320, overflowY: 'auto',
                        border: '1px solid #EBEBEB',
                      }}>
                        {n.content}
                      </Box>
                    ) : (
                      <Typography variant="caption" color="text.secondary" sx={{ fontStyle: 'italic' }}>
                        No content recorded.
                      </Typography>
                    )}
                  </Box>
                )}
              </React.Fragment>
            );
          })}
        </Paper>
      )}

      <ContactFormDialog
        open={addOpen}
        patientId={patientId}
        onClose={() => setAddOpen(false)}
        onSaved={() => { qc.invalidateQueries({ queryKey: patientReferralsKeys.unifiedContacts(patientId) }); qc.invalidateQueries({ queryKey: patientNotesKeys.patientAll(patientId) }); setAddOpen(false); }}
      />
    </Box>
  );
}

// ============ DNA Panel ============

interface DNAPanelProps { patientId: string }
function DNAPanel({ patientId }: DNAPanelProps) {
  const { data: notes, isLoading } = usePatientNotes(patientId);
  const dnaRecords = (notes ?? []).filter(n => n.didNotAttend);

  return (
    <Box>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
        <Box>
          <Typography variant="h6" fontWeight={600} fontFamily="Albert Sans, sans-serif">Did Not Attend (DNA)</Typography>
          <Typography variant="caption" color="text.secondary">All appointments / contacts where the patient did not attend</Typography>
        </Box>
        {dnaRecords.length > 0 && (
          <Chip label={`${dnaRecords.length} DNA event${dnaRecords.length !== 1 ? 's' : ''}`} size="small"
            sx={{ bgcolor: '#FFEBEE', color: '#C62828', fontWeight: 700, fontSize: 12 }} />
        )}
      </Box>

      {isLoading && <CircularProgress role="progressbar" aria-label="Loading" size={24} />}

      {!isLoading && dnaRecords.length === 0 && (
        <Alert severity="success">No DNA events recorded for this patient.</Alert>
      )}

      {dnaRecords.length > 0 && (
        <Paper elevation={0} sx={{ border: '1px solid', borderColor: 'divider', borderRadius: 2, overflow: 'hidden' }}>
          <Box sx={{ px: 2, py: 1, bgcolor: '#FFEBEE', display: 'flex', gap: 2 }}>
            <Typography variant="caption" fontWeight={700} color="#C62828" sx={{ flex: 2 }}>Date</Typography>
            <Typography variant="caption" fontWeight={700} color="#C62828" sx={{ flex: 3 }}>Title / Type</Typography>
            <Typography variant="caption" fontWeight={700} color="#C62828" sx={{ flex: 2 }}>Clinician</Typography>
            <Typography variant="caption" fontWeight={700} color="#C62828" sx={{ flex: 2 }}>Episode</Typography>
            <Typography variant="caption" fontWeight={700} color="#C62828" sx={{ flex: 1 }}>Status</Typography>
          </Box>
          {dnaRecords.map((n, i) => (
            <Box key={n.id} sx={{ px: 2, py: 1.5, display: 'flex', gap: 2, alignItems: 'center', borderTop: i > 0 ? '1px solid' : 'none', borderColor: 'divider', '&:hover': { bgcolor: '#FFFDE7' } }}>
              <Typography variant="body2" sx={{ flex: 2, fontWeight: 500 }}>
                {new Date(n.createdAt).toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric' })}
              </Typography>
              <Box sx={{ flex: 3 }}>
                <Typography variant="body2" fontWeight={600}>{n.title}</Typography>
                <Typography variant="caption" color="text.secondary" sx={{ textTransform: 'capitalize' }}>{n.noteType}</Typography>
              </Box>
              <Typography variant="body2" color="text.secondary" sx={{ flex: 2 }}>{n.authorName || '—'}</Typography>
              <Typography variant="body2" color="text.secondary" sx={{ flex: 2 }}>{n.episodeTitle || '—'}</Typography>
              <Box sx={{ flex: 1 }}>
                <Chip label="DNA" size="small" sx={{ bgcolor: '#FFEBEE', color: '#C62828', fontWeight: 700, fontSize: 10 }} />
              </Box>
            </Box>
          ))}
        </Paper>
      )}

      {dnaRecords.length >= 3 && (
        <Alert role="alert" severity="warning" sx={{ mt: 2 }}>
          <strong>{dnaRecords.length} DNA events</strong> recorded. Consider reviewing engagement and care plan.
        </Alert>
      )}
    </Box>
  );
}

export default AppointmentsTab;
