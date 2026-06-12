// apps/web/src/features/appointments/pages/AppointmentsPage.tsx
import React, { useState, useMemo } from 'react';
import {
  Alert, Box, Button, Card, CardContent, Chip, CircularProgress, Dialog, DialogActions,
  DialogContent, DialogTitle, Divider, FormControl, FormControlLabel, Grid, IconButton,
  InputLabel, MenuItem, Paper, Select, Switch,
  TextField, ToggleButton, ToggleButtonGroup, Tooltip, Typography,
} from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import ChevronLeftIcon from '@mui/icons-material/ChevronLeft';
import ChevronRightIcon from '@mui/icons-material/ChevronRight';
import TodayIcon from '@mui/icons-material/Today';
import ViewDayIcon from '@mui/icons-material/ViewDay';
import ViewWeekIcon from '@mui/icons-material/ViewWeek';
import CalendarViewWeekIcon from '@mui/icons-material/CalendarViewWeek';
import ViewListIcon from '@mui/icons-material/ViewList';
import { useQuery } from '@tanstack/react-query';
import {
  ALL_SPECIALTIES,
  SPECIALTY_DISPLAY,
  type AppointmentMode,
  type SpecialtyType,
  type AppointmentType,
} from '@signacare/shared';
import { apiClient } from '../../../shared/services/apiClient';
import { extractListResponse } from '../../../shared/services/extractListResponse';
import { useOrgTree } from '../../org-settings/hooks/useOrgSettings';
import type { OrgUnit } from '../../org-settings/services/orgSettingsApi';
import { PatientSearchAutocomplete, type PatientOption } from '../../patients/components/PatientSearchAutocomplete';
import { appointmentKeys } from '../queryKeys';

interface StaffLookupRow {
  id: string;
  givenName: string;
  familyName: string;
}

interface AppointmentApiRow {
  id: string;
  startTime: string;
  endTime: string;
  clinicianId: string | null;
  status: string;
  type: string;
  mode?: AppointmentMode | null;
  teamId?: string | null;
  teamName?: string | null;
  attendeeStaffIds?: string[];
  attendeeStaffNames?: string[];
  telehealthLink?: string | null;
  specialtyCode?: SpecialtyType | null;
}

interface EpisodeRow {
  id: string;
  title: string;
  episodeType: string;
  status: string;
}

type RecurringEndMode = 'never' | 'after' | 'date';

function flattenUnits(nodes: OrgUnit[]): { id: string; name: string }[] {
  const r: { id: string; name: string }[] = [];
  function w(l: OrgUnit[], d: number) { for (const n of l) { r.push({ id: n.id, name: '\u00A0'.repeat(d * 2) + n.name }); if (n.children?.length) w(n.children, d + 1); } }
  w(nodes, 0); return r;
}

function getErrorMessage(err: unknown, fallback: string): string {
  if (!err || typeof err !== 'object') return fallback;
  const maybe = err as {
    message?: unknown;
    response?: { data?: { message?: unknown; error?: unknown } };
  };
  if (typeof maybe.response?.data?.error === 'string' && maybe.response.data.error.trim()) return maybe.response.data.error;
  if (typeof maybe.response?.data?.message === 'string' && maybe.response.data.message.trim()) return maybe.response.data.message;
  if (typeof maybe.message === 'string' && maybe.message.trim()) return maybe.message;
  return fallback;
}

function useStaffLookup() { return useQuery({ queryKey: appointmentKeys.staffLookup(), queryFn: () => apiClient.get<StaffLookupRow[]>('staff/lookup'), staleTime: 5 * 60 * 1000 }); }
type CalView = 'day' | 'workweek' | 'week' | 'list';

interface Appointment {
  id: string;
  title: string;
  date: string;
  startTime: string;
  endTime: string;
  clinicianName: string;
  teamName: string;
  status: string;
  type: string;
  mode?: string;
  patientResponse?: string;
  specialtyCode?: SpecialtyType;
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
const MBS_ITEMS = [
  '291 — Initial consultation (< 45 min)', '293 — Initial consultation (> 45 min)',
  '296 — Group psychotherapy', '300 — Subsequent attendance (< 15 min)', '302 — Subsequent attendance (15-30 min)',
  '304 — Subsequent attendance (30-45 min)', '306 — Subsequent attendance (> 45 min)',
  '2710 — Telepsychiatry initial (< 45 min)', '2712 — Telepsychiatry initial (> 45 min)',
  '2713 — Telepsychiatry subsequent (< 15 min)', '2717 — Telepsychiatry subsequent (15-30 min)',
  '2721 — Telepsychiatry subsequent (30-45 min)', '2725 — Telepsychiatry subsequent (> 45 min)',
  '80000 — FPS — GP Mental Health consultation', '80010 — FPS — Allied health (short)',
  '80110 — FPS — Allied health (standard)', '80115 — FPS — Clinical psychologist (short)',
  '80125 — FPS — Clinical psychologist (standard)', '81300 — Eating disorder treatment',
  '91182 — Consultant psychiatrist case conference',
  'None — No MBS item',
];
const REMINDER_OPTIONS = ['15 min before', '30 min before', '1 hour before', '2 hours before', '1 day before', '2 days before', '1 week before'];

function getWeekDates(date: Date, includeWeekend: boolean): Date[] {
  const d = new Date(date); const day = d.getDay(); const diff = d.getDate() - day + (day === 0 ? -6 : 1);
  const mon = new Date(d.setDate(diff)); return Array.from({ length: includeWeekend ? 7 : 5 }, (_, i) => { const dd = new Date(mon); dd.setDate(mon.getDate() + i); return dd; });
}
function formatDate(d: Date): string { return d.toLocaleDateString('en-AU', { day: '2-digit', month: 'short' }); }

const APPT_TYPE_LABELS: Record<string, string> = {
  initial: 'Initial Assessment', follow_up: 'Follow-up', assessment: 'Assessment',
  telehealth: 'Telehealth', group: 'Group Session', clinical_review: 'Clinical Review',
};
const APPOINTMENT_MODE_OPTIONS: Array<{ value: AppointmentMode; label: string }> = [
  { value: 'direct', label: 'Direct' },
  { value: 'telehealth', label: 'Telehealth' },
  { value: 'videoconference', label: 'Videoconference' },
  { value: 'other', label: 'Other' },
];

function appointmentModeLabel(mode?: AppointmentMode | null, telehealthLink?: string | null): string {
  if (mode) {
    return APPOINTMENT_MODE_OPTIONS.find((option) => option.value === mode)?.label ?? mode;
  }
  return telehealthLink ? 'Videoconference' : 'Direct';
}

export const AppointmentsPage = () => {
  const { data: tree } = useOrgTree();
  const { data: staffList } = useStaffLookup();
  const flatUnits = useMemo(() => tree ? flattenUnits(tree) : [], [tree]);

  const [view, setView] = useState<CalView>('workweek');
  const [currentDate, setCurrentDate] = useState(new Date());
  const [teamFilter, setTeamFilter] = useState('');
  const [clinicianFilter, setClinicianFilter] = useState('');
  // Multi-specialty filter — populated from the seven core specialties.
  // Empty string = "all specialties" so the existing default behaviour is unchanged.
  const [specialtyFilter, setSpecialtyFilter] = useState<SpecialtyType | ''>('');
  const [patientFilter, setPatientFilter] = useState<PatientOption | null>(null);
  const patientIdFilter = patientFilter?.id ?? '';
  const patientLabel = patientFilter ? `${patientFilter.familyName}, ${patientFilter.givenName}` : '';
  const [addOpen, setAddOpen] = useState(false);

  const goToday = () => setCurrentDate(new Date());
  const goPrev = () => { const d = new Date(currentDate); d.setDate(d.getDate() - (view === 'day' ? 1 : 7)); setCurrentDate(d); };
  const goNext = () => { const d = new Date(currentDate); d.setDate(d.getDate() + (view === 'day' ? 1 : 7)); setCurrentDate(d); };

  const { data: rawAppts = [], isError: appointmentsLoadError } = useQuery({
    queryKey: appointmentKeys.clinic(patientIdFilter),
    queryFn: async () => {
      const response = await apiClient.get<unknown>(
        'appointments',
        patientIdFilter ? { patientId: patientIdFilter } : {},
      );
      return extractListResponse<AppointmentApiRow>(response, {
        endpoint: 'appointments',
        keys: ['appointments', 'data', 'items'],
      });
    },
    staleTime: 60_000,
  });

  const appointments: Appointment[] = useMemo(() => rawAppts.map((a) => {
    const start = new Date(a.startTime);
    const end = new Date(a.endTime);
    const clinician = (staffList ?? []).find((s) => s.id === a.clinicianId);
    const clinicianName = clinician ? `${clinician.givenName} ${clinician.familyName}` : '';
    return {
      id: a.id,
      title: APPT_TYPE_LABELS[a.type] ?? a.type,
      date: start.toISOString().split('T')[0],
      startTime: start.toLocaleTimeString('en-AU', { hour: '2-digit', minute: '2-digit', hour12: false }),
      endTime: end.toLocaleTimeString('en-AU', { hour: '2-digit', minute: '2-digit', hour12: false }),
      clinicianName,
      teamName: a.teamName ?? '',
      status: a.status,
      type: a.type,
      mode: appointmentModeLabel(a.mode, a.telehealthLink),
      specialtyCode: a.specialtyCode ?? undefined,
    };
  }), [rawAppts, staffList]);

  const filtered = useMemo(() => {
    let appts = appointments;
    if (clinicianFilter) appts = appts.filter(a => a.clinicianName.includes(clinicianFilter));
    if (teamFilter) appts = appts.filter(a => a.teamName.includes(teamFilter));
    if (specialtyFilter) appts = appts.filter(a => a.specialtyCode === specialtyFilter);
    return appts;
  }, [appointments, clinicianFilter, specialtyFilter, teamFilter]);

  const weekDates = useMemo(() => getWeekDates(currentDate, view === 'week'), [currentDate, view]);

  return (
    <Box sx={{ px: { xs: 2, sm: 3, md: 4 }, py: 3, bgcolor: '#FBF8F5', minHeight: '100vh' }}>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', mb: 3, gap: 2, flexWrap: 'wrap' }}>
        <Box>
          <Typography variant="h5" fontWeight={700} fontFamily="Albert Sans, sans-serif" sx={{ color: '#3D484B' }}>
            Clinic Appointments
            {patientLabel && <Chip label={patientLabel} size="small" onDelete={() => setPatientFilter(null)} sx={{ ml: 1.5, fontSize: 12 }} />}
          </Typography>
          <Typography variant="body2" color="text.secondary">All patients — clinic-wide scheduling view</Typography>
        </Box>
        <Button startIcon={<AddIcon />} variant="contained" onClick={() => setAddOpen(true)}
          sx={{ fontFamily: 'Albert Sans, sans-serif', fontWeight: 600, bgcolor: '#b8621a', '&:hover': { bgcolor: '#d6741f' } }}>
          New Appointment
        </Button>
      </Box>

      {/* Toolbar */}
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2, flexWrap: 'wrap', gap: 1 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <Button size="small" variant="outlined" onClick={goToday} startIcon={<TodayIcon />} sx={{ textTransform: 'none' }}>Today</Button>
          <IconButton size="small" onClick={goPrev}><ChevronLeftIcon /></IconButton>
          <IconButton size="small" onClick={goNext}><ChevronRightIcon /></IconButton>
          <Typography variant="subtitle1" fontWeight={600} fontFamily="Albert Sans, sans-serif">
            {view === 'day' ? currentDate.toLocaleDateString('en-AU', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })
              : `${formatDate(weekDates[0])} — ${formatDate(weekDates[weekDates.length - 1])} ${weekDates[0].getFullYear()}`}
          </Typography>
        </Box>
        <ToggleButtonGroup value={view} exclusive onChange={(_, v) => { if (v) setView(v); }} size="small">
          <ToggleButton value="day"><Tooltip title="Day"><ViewDayIcon fontSize="small" /></Tooltip></ToggleButton>
          <ToggleButton value="workweek"><Tooltip title="Work Week"><CalendarViewWeekIcon fontSize="small" /></Tooltip></ToggleButton>
          <ToggleButton value="week"><Tooltip title="Full Week"><ViewWeekIcon fontSize="small" /></Tooltip></ToggleButton>
          <ToggleButton value="list"><Tooltip title="List"><ViewListIcon fontSize="small" /></Tooltip></ToggleButton>
        </ToggleButtonGroup>
      </Box>

      {/* Filters */}
      <Box sx={{ display: 'flex', gap: 1.5, mb: 2, flexWrap: 'wrap', alignItems: 'flex-start' }}>
        {/* Patient filter — Shape C: MUI Autocomplete (BUG-447 child 8/15) */}
        <PatientSearchAutocomplete
          value={patientFilter}
          onChange={setPatientFilter}
          placeholder="Filter by patient…"
          sx={{ minWidth: 220 }}
        />
        <FormControl size="small" sx={{ minWidth: 180 }}><InputLabel>Team / Unit</InputLabel>
          <Select value={teamFilter} onChange={e => setTeamFilter(e.target.value)} label="Team / Unit" sx={{ bgcolor: '#fff' }}>
            <MenuItem value="">All Teams</MenuItem>{flatUnits.map(u => <MenuItem key={u.id} value={u.name}>{u.name}</MenuItem>)}
          </Select></FormControl>
        <FormControl size="small" sx={{ minWidth: 180 }}><InputLabel>Clinician</InputLabel>
          <Select value={clinicianFilter} onChange={e => setClinicianFilter(e.target.value)} label="Clinician" sx={{ bgcolor: '#fff' }}>
            <MenuItem value="">All Clinicians</MenuItem>{(staffList ?? []).map(s => <MenuItem key={s.id} value={`${s.givenName} ${s.familyName}`}>{s.givenName} {s.familyName}</MenuItem>)}
          </Select></FormControl>
        <FormControl size="small" sx={{ minWidth: 180 }}><InputLabel>Specialty</InputLabel>
          <Select value={specialtyFilter} onChange={e => setSpecialtyFilter(e.target.value as SpecialtyType | '')} label="Specialty" sx={{ bgcolor: '#fff' }}>
            <MenuItem value="">All Specialties</MenuItem>
            {ALL_SPECIALTIES.map(code => <MenuItem key={code} value={code}>{SPECIALTY_DISPLAY[code]}</MenuItem>)}
          </Select></FormControl>
      </Box>

      {/* Calendar */}
      {appointmentsLoadError && (
        <Alert role="alert" severity="error" sx={{ mb: 2 }}>
          Failed to load appointments. Refresh to retry.
        </Alert>
      )}
      {view === 'list' ? <ListView appointments={filtered} /> : view === 'day' ? <DayView date={currentDate} appointments={filtered} /> : <WeekView dates={weekDates} dayLabels={view === 'week' ? ALLDAYS : WEEKDAYS} appointments={filtered} />}

      {/* New Appointment Dialog — full version with patient search */}
      {addOpen && <NewAppointmentDialog open={addOpen} onClose={() => setAddOpen(false)} flatUnits={flatUnits} staffList={staffList ?? []} />}
    </Box>
  );
};

// ============ Calendar Views (compact) ============
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
          {dates.map((d, di) => { const dateStr = d.toISOString().split('T')[0]; const sa = appointments.filter(a => a.date === dateStr && parseInt(a.startTime, 10) === hour); return (
            <Box key={di} sx={{ borderBottom: '1px solid', borderLeft: '1px solid', borderColor: 'divider', minHeight: 48, p: 0.25 }}>
              {sa.map(a => <Tooltip key={a.id} title={`${a.clinicianName} | ${a.mode || ''}`}><Box sx={{ bgcolor: a.patientResponse === 'accepted' ? '#E8F5E9' : '#E3F2FD', borderLeft: `3px solid ${a.patientResponse === 'accepted' ? '#327C8D' : '#2196F3'}`, borderRadius: 0.5, p: 0.5, mb: 0.25, cursor: 'pointer' }}><Typography variant="caption" fontWeight={600} sx={{ fontSize: 10, display: 'block', lineHeight: 1.2 }}>{a.title}</Typography><Typography variant="caption" sx={{ fontSize: 9, color: 'text.secondary' }}>{a.startTime}–{a.endTime}</Typography></Box></Tooltip>)}
            </Box>); })}
        </React.Fragment>))}
      </Box>
    </Paper>
  );
}

interface DayViewProps { date: Date; appointments: Appointment[] }
function DayView({ date, appointments }: DayViewProps) {
  const dateStr = date.toISOString().split('T')[0]; const dayAppts = appointments.filter(a => a.date === dateStr);
  return (<Paper variant="outlined" sx={{ overflow: 'auto' }}><Box sx={{ display: 'grid', gridTemplateColumns: '60px 1fr', minWidth: 400 }}>
    {HOURS.map(hour => { const sa = dayAppts.filter(a => parseInt(a.startTime, 10) === hour); return (<React.Fragment key={hour}>
      <Box sx={{ borderBottom: '1px solid', borderColor: 'divider', p: 0.5, textAlign: 'right', pr: 1 }}><Typography variant="caption" color="text.secondary">{`${hour}:00`}</Typography></Box>
      <Box sx={{ borderBottom: '1px solid', borderLeft: '1px solid', borderColor: 'divider', minHeight: 56, p: 0.5 }}>
        {sa.map(a => <Box key={a.id} sx={{ bgcolor: '#E3F2FD', borderLeft: '3px solid #2196F3', borderRadius: 1, p: 1, mb: 0.5 }}><Typography variant="body2" fontWeight={600} sx={{ fontSize: 13 }}>{a.title}</Typography><Typography variant="caption" color="text.secondary">{a.startTime}–{a.endTime} | {a.clinicianName} | {a.mode || ''}</Typography></Box>)}
      </Box></React.Fragment>); })}
  </Box></Paper>);
}

interface ListViewProps { appointments: Appointment[] }
function ListView({ appointments }: ListViewProps) {
  const sorted = [...appointments].sort((a, b) => `${a.date}${a.startTime}`.localeCompare(`${b.date}${b.startTime}`));
  if (!sorted.length) return <Paper variant="outlined" sx={{ p: 4, textAlign: 'center' }}><Typography color="text.secondary">No appointments to display.</Typography></Paper>;
  return (<Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
    {sorted.map(a => (<Card key={a.id} variant="outlined" sx={{ '&:hover': { borderColor: '#b8621a' } }}><CardContent sx={{ py: 1.5, '&:last-child': { pb: 1.5 }, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
      <Box><Typography variant="body2" fontWeight={600}>{a.title}</Typography><Typography variant="caption" color="text.secondary">{new Date(a.date).toLocaleDateString('en-AU', { weekday: 'short', day: 'numeric', month: 'short' })} | {a.startTime}–{a.endTime} | {a.clinicianName} | {a.teamName} | {a.mode || ''}</Typography></Box>
      <Box sx={{ display: 'flex', gap: 0.5 }}>{a.patientResponse && <Chip label={`Patient: ${a.patientResponse}`} size="small" sx={{ fontSize: 9, height: 18 }} color={a.patientResponse === 'accepted' ? 'success' : a.patientResponse === 'rejected' ? 'error' : 'default'} />}<Chip label={a.status} size="small" color={a.status === 'confirmed' ? 'success' : 'info'} sx={{ fontSize: 10, height: 20, textTransform: 'capitalize' }} /></Box>
    </CardContent></Card>))}
  </Box>);
}

// ============ Episode & MDT Selector (used inside dialog) ============

interface EpisodeAndMdtSelectorProps {
  patientId: string;
  episodeId: string;
  setEpisodeId: (value: string) => void;
  additionalClinicianIds: string[];
  setAdditionalClinicianIds: React.Dispatch<React.SetStateAction<string[]>>;
}
function EpisodeAndMdtSelector({
  patientId,
  episodeId,
  setEpisodeId,
  additionalClinicianIds,
  setAdditionalClinicianIds,
}: EpisodeAndMdtSelectorProps) {

  const { data: episodes } = useQuery({
    queryKey: appointmentKeys.episodeActiveForAppt(patientId),
    queryFn: async () => {
      const response = await apiClient.get<unknown>(`episodes/patient/${patientId}`);
      const rows = extractListResponse<EpisodeRow>(response, {
        endpoint: `episodes/patient/${patientId}`,
        keys: ['data', 'items'],
      });
      return rows.filter((episode) => episode.status === 'open');
    },
    enabled: !!patientId,
  });

  const { data: alloc } = useQuery({
    queryKey: appointmentKeys.episodeAllocation(episodeId),
    queryFn: () => apiClient.get<{ primaryClinicianId: string | null; mdt: { staffid: string; rolename: string; staffname: string }[] }>(`episodes/${episodeId}/allocation`),
    enabled: !!episodeId,
  });

  // Suggest MDT members as co-clinicians when the episode is selected.
  React.useEffect(() => {
    if (!alloc?.mdt?.length || additionalClinicianIds.length > 0) return;
    const suggestedIds = alloc.mdt
      .map((member) => member.staffid)
      .filter((staffId): staffId is string => typeof staffId === 'string' && staffId.length > 0);
    if (suggestedIds.length > 0) {
      setAdditionalClinicianIds(Array.from(new Set(suggestedIds)));
    }
  }, [alloc, additionalClinicianIds.length, setAdditionalClinicianIds]);

  return (
    <>
      <Grid size={{ xs: 12, sm: 6 }}>
        <FormControl fullWidth size="small">
          <InputLabel>Episode</InputLabel>
          <Select value={episodeId} onChange={e => setEpisodeId(e.target.value)} label="Episode">
            <MenuItem value="">— No episode —</MenuItem>
            {(episodes ?? []).map((ep) => <MenuItem key={ep.id} value={ep.id}>{ep.title} ({ep.episodeType})</MenuItem>)}
          </Select>
        </FormControl>
      </Grid>
      {episodeId && alloc?.mdt?.length ? (
        <Grid size={{ xs: 12 }}>
          <Typography variant="caption" color="text.secondary">MDT from episode: {alloc.mdt.map(m => `${m.staffname} (${m.rolename})`).join(', ')}</Typography>
        </Grid>
      ) : null}
    </>
  );
}

// ============ Full Appointment Dialog (with patient search) ============
function NewAppointmentDialog({ open, onClose, flatUnits, staffList }: { open: boolean; onClose: () => void; flatUnits: { id: string; name: string }[]; staffList: { id: string; givenName: string; familyName: string }[] }) {
  const [saving, setSaving] = useState(false);
  const [selectedPatient, setSelectedPatient] = useState<PatientOption | null>(null);
  const selectedPatientId = selectedPatient?.id ?? '';

  const [date, setDate] = useState(new Date().toISOString().split('T')[0]);
  const [startTime, setStartTime] = useState('09:00');
  const [duration, setDuration] = useState(30);
  const [endTime, setEndTime] = useState('09:30');
  const [clinician, setClinician] = useState('');
  const [team, setTeam] = useState('');
  // Multi-specialty: optional override. Server auto-resolves from
  // episode → clinician primary specialty → mental_health when omitted.
  const [specialty, setSpecialty] = useState<SpecialtyType | ''>('');
  const [apptType, setApptType] = useState<AppointmentType>('clinical_review');
  const [mode, setMode] = useState<AppointmentMode>('direct');
  const [telehealthLink, setTelehealthLink] = useState('');
  const [episodeId, setEpisodeId] = useState('');
  const [mbsItem, setMbsItem] = useState('');
  const [additionalClinicianIds, setAdditionalClinicianIds] = useState<string[]>([]);
  const [reminders, setReminders] = useState<string[]>(['1 day before']);
  const [notes, setNotes] = useState('');
  const [sendPatientReminder, setSendPatientReminder] = useState(true);

  React.useEffect(() => {
    const [h, m] = startTime.split(':').map(Number);
    const totalMin = h * 60 + m + duration;
    setEndTime(`${String(Math.floor(totalMin / 60)).padStart(2, '0')}:${String(totalMin % 60).padStart(2, '0')}`);
  }, [startTime, duration]);

  const isTelehealth = mode === 'telehealth' || mode === 'videoconference';
  const handleReminderToggle = (r: string) => setReminders(prev => prev.includes(r) ? prev.filter(x => x !== r) : [...prev, r]);
  const formatStaffName = (staffId: string) => {
    const staff = staffList.find((row) => row.id === staffId);
    return staff ? `${staff.givenName} ${staff.familyName}` : staffId;
  };

  return (
    <Dialog aria-labelledby="dialog-title" open={open} onClose={onClose} maxWidth="md" fullWidth>
      <DialogTitle id="dialog-title" sx={{ fontFamily: 'Albert Sans, sans-serif', fontWeight: 700 }}>New Appointment</DialogTitle>
      <Divider />
      <DialogContent>
        <Grid container spacing={2} sx={{ mt: 0.5 }}>
          {/* Patient search — Shape C: MUI Autocomplete (BUG-447 child 8/15) */}
          <Grid size={{ xs: 12 }}>
            <Typography variant="subtitle2" sx={{ mb: 0.5 }}>Patient *</Typography>
            <PatientSearchAutocomplete value={selectedPatient} onChange={setSelectedPatient} fullWidth />
          </Grid>

          {/* Episode dropdown — loads active episodes for selected patient */}
          {selectedPatientId && (
            <EpisodeAndMdtSelector
              patientId={selectedPatientId}
              episodeId={episodeId}
              setEpisodeId={setEpisodeId}
              additionalClinicianIds={additionalClinicianIds}
              setAdditionalClinicianIds={setAdditionalClinicianIds}
            />
          )}

          <Grid size={{ xs: 12, sm: 6 }}><FormControl fullWidth size="small"><InputLabel>Appointment Type</InputLabel><Select value={apptType} onChange={e => setApptType(e.target.value as AppointmentType)} label="Appointment Type">{APPOINTMENT_TYPE_OPTIONS.map(t => <MenuItem key={t.value} value={t.value}>{t.label}</MenuItem>)}</Select></FormControl></Grid>

          <Grid size={{ xs: 12, sm: 3 }}><TextField label="Date" type="date" fullWidth size="small" value={date} onChange={e => setDate(e.target.value)} slotProps={{ inputLabel: { shrink: true } }} /></Grid>
          <Grid size={{ xs: 6, sm: 3 }}><TextField label="Start Time" type="time" fullWidth size="small" value={startTime} onChange={e => setStartTime(e.target.value)} slotProps={{ inputLabel: { shrink: true } }} /></Grid>
          <Grid size={{ xs: 6, sm: 3 }}><FormControl fullWidth size="small"><InputLabel>Duration</InputLabel><Select value={duration} onChange={e => setDuration(Number(e.target.value))} label="Duration">{DURATIONS.map(d => <MenuItem key={d} value={d}>{d} min</MenuItem>)}</Select></FormControl></Grid>
          <Grid size={{ xs: 6, sm: 3 }}><TextField label="End Time" type="time" fullWidth size="small" value={endTime} onChange={e => setEndTime(e.target.value)} slotProps={{ inputLabel: { shrink: true } }} /></Grid>

          <Grid size={{ xs: 12, sm: 6 }}><FormControl fullWidth size="small"><InputLabel>Mode</InputLabel><Select value={mode} onChange={e => setMode(e.target.value as AppointmentMode)} label="Mode">{APPOINTMENT_MODE_OPTIONS.map(option => <MenuItem key={option.value} value={option.value}>{option.label}</MenuItem>)}</Select></FormControl></Grid>
          {isTelehealth && <Grid size={{ xs: 12, sm: 6 }}><TextField label="Telehealth Link" fullWidth size="small" value={telehealthLink} onChange={e => setTelehealthLink(e.target.value)} placeholder="https://meet.example.com/..." /></Grid>}

          <Grid size={{ xs: 12, sm: 4 }}><FormControl fullWidth size="small"><InputLabel>Clinician</InputLabel><Select value={clinician} onChange={e => setClinician(e.target.value)} label="Clinician"><MenuItem value="">—</MenuItem>{staffList.map(s => <MenuItem key={s.id} value={s.id}>{s.givenName} {s.familyName}</MenuItem>)}</Select></FormControl></Grid>
          <Grid size={{ xs: 12, sm: 4 }}><FormControl fullWidth size="small"><InputLabel>Specialty</InputLabel><Select value={specialty} onChange={e => setSpecialty(e.target.value as SpecialtyType | '')} label="Specialty"><MenuItem value="">— Auto —</MenuItem>{ALL_SPECIALTIES.map(code => <MenuItem key={code} value={code}>{SPECIALTY_DISPLAY[code]}</MenuItem>)}</Select></FormControl></Grid>
          <Grid size={{ xs: 12, sm: 4 }}><FormControl fullWidth size="small"><InputLabel>Team / Unit</InputLabel><Select value={team} onChange={e => setTeam(e.target.value)} label="Team / Unit"><MenuItem value="">—</MenuItem>{flatUnits.map(u => <MenuItem key={u.id} value={u.id}>{u.name}</MenuItem>)}</Select></FormControl></Grid>

          <Grid size={{ xs: 12, sm: 6 }}><FormControl fullWidth size="small"><InputLabel>MBS Item</InputLabel><Select value={mbsItem} onChange={e => setMbsItem(e.target.value)} label="MBS Item"><MenuItem value="">— None —</MenuItem>{MBS_ITEMS.map(m => <MenuItem key={m} value={m}>{m}</MenuItem>)}</Select></FormControl></Grid>
          <Grid size={{ xs: 12, sm: 6 }}>
            <FormControl fullWidth size="small">
              <InputLabel>Additional clinicians</InputLabel>
              <Select
                multiple
                value={additionalClinicianIds}
                onChange={(e) => setAdditionalClinicianIds(typeof e.target.value === 'string' ? e.target.value.split(',') : e.target.value)}
                label="Additional clinicians"
                renderValue={(selected) => (selected as string[]).map(formatStaffName).join(', ')}
              >
                {staffList
                  .filter((staff) => staff.id !== clinician)
                  .map((staff) => (
                    <MenuItem key={staff.id} value={staff.id}>
                      {staff.givenName} {staff.familyName}
                    </MenuItem>
                  ))}
              </Select>
            </FormControl>
          </Grid>

          <Grid size={{ xs: 12 }}>
            <Typography variant="subtitle2" sx={{ mb: 0.5 }}>Reminders</Typography>
            <Box sx={{ display: 'flex', gap: 0.5, flexWrap: 'wrap' }}>
              {REMINDER_OPTIONS.map(r => <Chip key={r} label={r} size="small" variant={reminders.includes(r) ? 'filled' : 'outlined'} onClick={() => handleReminderToggle(r)} sx={{ cursor: 'pointer', ...(reminders.includes(r) ? { bgcolor: '#b8621a', color: '#fff' } : {}) }} />)}
            </Box>
            <FormControlLabel sx={{ mt: 0.5 }} control={<Switch size="small" checked={sendPatientReminder} onChange={(_, v) => setSendPatientReminder(v)} sx={{ '& .Mui-checked': { color: '#b8621a' } }} />}
              label={<Typography variant="caption">Send reminder to patient app</Typography>} />
          </Grid>
          {/* Recurring */}
          <Grid size={{ xs: 12 }}>
            <RecurringSection />
          </Grid>

          <Grid size={{ xs: 12 }}><TextField label="Notes" fullWidth size="small" multiline rows={2} value={notes} onChange={e => setNotes(e.target.value)} /></Grid>
        </Grid>
      </DialogContent>
      <Divider />
      <DialogActions sx={{ px: 3, py: 2 }}>
        <Button onClick={onClose}>Cancel</Button>
        <Button variant="contained" disabled={!selectedPatientId || saving}
          onClick={async () => {
            setSaving(true);
            try {
              const startIso = `${date}T${startTime}:00Z`;
              const endIso = `${date}T${endTime}:00Z`;
              await apiClient.post('appointments', {
                patientId: selectedPatientId,
                clinicianId: clinician || undefined,
                episodeId: episodeId || undefined,
                specialtyCode: specialty || undefined,
                startTime: startIso,
                endTime: endIso,
                type: apptType,
                mode: mode || undefined,
                notes: notes || undefined,
                attendeeStaffIds: additionalClinicianIds.filter((staffId) => staffId !== clinician),
                ...(telehealthLink ? { telehealthDetails: { telehealthLink } } : {}),
              });
              onClose();
            } catch (err: unknown) {
              const msg = getErrorMessage(err, '');
              if (msg.includes('already booked')) {
                alert('This clinician is already booked during the selected time. Please choose a different time or clinician.');
              } else {
                alert(`Failed to create appointment: ${msg}`);
              }
            } finally { setSaving(false); }
          }}
          sx={{ bgcolor: '#b8621a', '&:hover': { bgcolor: '#d6741f' } }}>
          {saving ? <CircularProgress role="progressbar" aria-label="Loading" size={16} sx={{ color: '#fff' }} /> : 'Create Appointment'}
        </Button>
      </DialogActions>
    </Dialog>
  );
}

function RecurringSection() {
  const [isRecurring, setIsRecurring] = useState(false);
  const [recFreq, setRecFreq] = useState('weekly');
  const [recInterval, setRecInterval] = useState(1);
  const [recEnd, setRecEnd] = useState<RecurringEndMode>('after');
  const [recCount, setRecCount] = useState(6);
  const [recEndDate, setRecEndDate] = useState('');

  return (
    <Paper variant="outlined" sx={{ p: 2 }}>
      <FormControlLabel
        control={<Switch size="small" checked={isRecurring} onChange={(_, v) => setIsRecurring(v)} sx={{ '& .Mui-checked': { color: '#327C8D' } }} />}
        label={<Typography variant="subtitle2" fontWeight={600}>Recurring Appointment</Typography>}
      />
      {isRecurring && (
        <Grid container spacing={2} sx={{ mt: 0.5 }}>
          <Grid size={{ xs: 6, sm: 3 }}>
            <FormControl fullWidth size="small"><InputLabel>Frequency</InputLabel>
              <Select value={recFreq} onChange={e => setRecFreq(e.target.value)} label="Frequency">
                <MenuItem value="daily">Daily</MenuItem>
                <MenuItem value="weekly">Weekly</MenuItem>
                <MenuItem value="fortnightly">Fortnightly</MenuItem>
                <MenuItem value="3-weekly">3-Weekly</MenuItem>
                <MenuItem value="4-weekly">4-Weekly</MenuItem>
                <MenuItem value="monthly">Monthly</MenuItem>
                <MenuItem value="6-weekly">6-Weekly</MenuItem>
                <MenuItem value="quarterly">Quarterly</MenuItem>
              </Select>
            </FormControl>
          </Grid>
          <Grid size={{ xs: 6, sm: 3 }}>
            <TextField label="Every" type="number" fullWidth size="small" value={recInterval}
              onChange={e => setRecInterval(Number(e.target.value))} inputProps={{ min: 1 }}
              helperText={recInterval > 1 ? `Every ${recInterval} ${recFreq === 'daily' ? 'days' : recFreq === 'weekly' ? 'weeks' : 'occurrences'}` : ''} />
          </Grid>
          <Grid size={{ xs: 6, sm: 3 }}>
            <FormControl fullWidth size="small"><InputLabel>Ends</InputLabel>
              <Select value={recEnd} onChange={e => setRecEnd(e.target.value as RecurringEndMode)} label="Ends">
                <MenuItem value="never">Never</MenuItem>
                <MenuItem value="after">After X occurrences</MenuItem>
                <MenuItem value="date">On date</MenuItem>
              </Select>
            </FormControl>
          </Grid>
          {recEnd === 'after' && (
            <Grid size={{ xs: 6, sm: 3 }}>
              <TextField label="Occurrences" type="number" fullWidth size="small" value={recCount}
                onChange={e => setRecCount(Number(e.target.value))} inputProps={{ min: 1, max: 52 }} />
            </Grid>
          )}
          {recEnd === 'date' && (
            <Grid size={{ xs: 6, sm: 3 }}>
              <TextField label="End Date" type="date" fullWidth size="small" value={recEndDate}
                onChange={e => setRecEndDate(e.target.value)} slotProps={{ inputLabel: { shrink: true } }} />
            </Grid>
          )}
        </Grid>
      )}
    </Paper>
  );
}

export default AppointmentsPage;
