import { useEffect, useState } from 'react';
import {
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  FormControl,
  FormControlLabel,
  Grid,
  InputLabel,
  MenuItem,
  Select,
  Switch,
  TextField,
  Typography,
  Chip,
} from '@mui/material';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { type AppointmentMode, type AppointmentType } from '@signacare/shared';
import { apiClient } from '../../../../../shared/services/apiClient';
import { appointmentKeys } from '../../../../appointments/queryKeys';
import { calendarKeys } from '../../../../calendar/queryKeys';
import { episodesKeys, patientAppointmentsKeys, patientsKeys } from '../../../queryKeys';
import type { OrgUnit } from '../../../../org-settings/services/orgSettingsApi';
import { PatientSearchAutocomplete, type PatientOption } from '../../PatientSearchAutocomplete';

interface EpisodeSummary {
  id: string;
  title: string;
  episodeType: string;
  status: string;
}

interface EditableAppointment {
  // Appointments do not carry a user-editable title — the display title
  // shown on cells is derived from APPT_TYPE_LABELS[type] (see
  // AppointmentsTab.tsx:147). The dialog body intentionally does not
  // expose a Title input; the dialog-contract test in
  // NewAppointmentDialog.dialogContract.test.ts pins this absence so
  // the legacy interface bloat never sneaks back in.
  id: string;
  date: string;
  startTime: string;
  endTime: string;
  clinicianId?: string | null;
  teamId?: string | null;
  type: string;
  modeValue?: AppointmentMode | null;
  attendeeStaffIds?: string[];
  notes?: string | null;
}

const APPOINTMENT_TYPE_OPTIONS: Array<{ value: AppointmentType; label: string }> = [
  { value: 'clinical_review', label: 'Psychiatrist Review' },
  { value: 'follow_up', label: 'Follow-up' },
  { value: 'assessment', label: 'Assessment' },
  { value: 'initial', label: 'Initial Assessment' },
  { value: 'group', label: 'Group Session' },
  { value: 'telehealth', label: 'Telehealth' },
];

const MBS_ITEMS = [
  '291 — Consultation (< 45 min)',
  '293 — Consultation (> 45 min)',
  '296 — Group therapy',
  '2710 — Telepsychiatry',
  '2712 — Telepsychiatry (> 45 min)',
  '2713 — Review (< 15 min)',
  '80010 — Focused Psychological Strategy (short)',
  '80110 — Focused Psychological Strategy (standard)',
  'None — No MBS item',
];

const REMINDER_OPTIONS = ['1 hour before', '2 hours before', '1 day before', '2 days before', '1 week before'];

const APPOINTMENT_MODE_OPTIONS: Array<{ value: AppointmentMode; label: string }> = [
  { value: 'direct', label: 'Direct' },
  { value: 'telehealth', label: 'Telehealth' },
  { value: 'videoconference', label: 'Videoconference' },
  { value: 'other', label: 'Other' },
];

export function flattenUnits(nodes: OrgUnit[]): { id: string; name: string }[] {
  const r: { id: string; name: string }[] = [];
  function w(l: OrgUnit[], d: number) {
    for (const n of l) {
      r.push({ id: n.id, name: '\u00A0'.repeat(d * 2) + n.name });
      if (n.children?.length) w(n.children, d + 1);
    }
  }
  w(nodes, 0);
  return r;
}

export function NewAppointmentDialog({
  open,
  onClose,
  flatUnits,
  staffList,
  patientId,
  editing,
}: {
  open: boolean;
  onClose: () => void;
  flatUnits: { id: string; name: string }[];
  staffList: { id: string; givenName: string; familyName: string }[];
  patientId?: string;
  editing?: EditableAppointment | null;
}) {
  const activeEpisodes = useQuery({
    queryKey: episodesKeys.active(patientId ?? ''),
    queryFn: () => apiClient.get<{ data: EpisodeSummary[] }>(`episodes/patient/${patientId}`).then(r => r.data?.filter(e => e.status === 'open') ?? []),
    enabled: !!patientId,
  });

  const [selectedPatient, setSelectedPatient] = useState<PatientOption | null>(null);
  const selectedPatientId = selectedPatient?.id ?? '';
  const [date, setDate] = useState(new Date().toISOString().split('T')[0]);
  const [startTime, setStartTime] = useState('09:00');
  const [duration, setDuration] = useState(30);
  const [endTime, setEndTime] = useState('09:30');
  const [clinician, setClinician] = useState('');
  const [team, setTeam] = useState('');
  const [apptType, setApptType] = useState<AppointmentType>('clinical_review');
  const [mode, setMode] = useState<AppointmentMode>('direct');
  const [telehealthLink, setTelehealthLink] = useState('');
  const [episodeId, setEpisodeId] = useState('');
  const [mbsItem, setMbsItem] = useState('');
  const [additionalClinicianIds, setAdditionalClinicianIds] = useState<string[]>([]);
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

  useEffect(() => {
    if (editing && open) {
      setDate(editing.date || new Date().toISOString().split('T')[0]);
      setStartTime(editing.startTime || '09:00');
      setEndTime(editing.endTime || '09:30');
      setClinician(editing.clinicianId ?? '');
      setTeam(editing.teamId ?? '');
      setApptType((editing.type as AppointmentType) || 'clinical_review');
      setMode(editing.modeValue ?? 'direct');
      setAdditionalClinicianIds(editing.attendeeStaffIds ?? []);
      setNotes(editing.notes || '');
    }
  }, [editing, open]);

  useEffect(() => {
    const [h, m] = (startTime ?? '00:00').split(':').map(Number);
    const totalMin = h * 60 + m + duration;
    const eh = Math.floor(totalMin / 60);
    const em = totalMin % 60;
    setEndTime(`${String(eh).padStart(2, '0')}:${String(em).padStart(2, '0')}`);
  }, [startTime, duration]);

  const isTelehealth = mode === 'telehealth' || mode === 'videoconference';
  const formatStaffName = (staffId: string) => {
    const staff = staffList.find((row) => row.id === staffId);
    return staff ? `${staff.givenName} ${staff.familyName}` : staffId;
  };
  const handleReminderToggle = (reminder: string) => {
    setReminders(prev => prev.includes(reminder) ? prev.filter(r => r !== reminder) : [...prev, reminder]);
  };

  return (
    <Dialog aria-labelledby="dialog-title" open={open} onClose={onClose} maxWidth="md" fullWidth>
      <DialogTitle id="dialog-title" sx={{ fontFamily: 'Albert Sans, sans-serif', fontWeight: 700 }}>{editing ? 'Edit Appointment' : 'New Appointment'}</DialogTitle>
      <Divider />
      <DialogContent>
        <Grid container spacing={2} sx={{ mt: 0.5 }}>
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
              <Select value={apptType} onChange={e => setApptType(e.target.value as AppointmentType)} label="Appointment Type">
                {APPOINTMENT_TYPE_OPTIONS.map(t => <MenuItem key={t.value} value={t.value}>{t.label}</MenuItem>)}
              </Select>
            </FormControl>
          </Grid>

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
                {[15, 20, 30, 45, 60, 90, 120].map(d => <MenuItem key={d} value={d}>{d} min</MenuItem>)}
              </Select>
            </FormControl>
          </Grid>
          <Grid size={{ xs: 6, sm: 3 }}>
            <TextField label="End Time" type="time" fullWidth size="small" value={endTime} onChange={e => setEndTime(e.target.value)} slotProps={{ inputLabel: { shrink: true } }} />
          </Grid>

          <Grid size={{ xs: 12, sm: 6 }}>
            <FormControl fullWidth size="small">
              <InputLabel>Mode</InputLabel>
              <Select value={mode} onChange={e => setMode(e.target.value as AppointmentMode)} label="Mode">
                {APPOINTMENT_MODE_OPTIONS.map(option => <MenuItem key={option.value} value={option.value}>{option.label}</MenuItem>)}
              </Select>
            </FormControl>
          </Grid>

          {isTelehealth && (
            <Grid size={{ xs: 12, sm: 6 }}>
              <TextField label="Telehealth Link" fullWidth size="small" value={telehealthLink} onChange={e => setTelehealthLink(e.target.value)} placeholder="https://meet.example.com/..." />
            </Grid>
          )}

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

          <Grid size={{ xs: 12, sm: 6 }}>
            <FormControl fullWidth size="small">
              <InputLabel>MBS Item</InputLabel>
              <Select value={mbsItem} onChange={e => setMbsItem(e.target.value)} label="MBS Item">
                <MenuItem value="">— None —</MenuItem>
                {MBS_ITEMS.map(m => <MenuItem key={m} value={m}>{m}</MenuItem>)}
              </Select>
            </FormControl>
          </Grid>

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

          <Grid size={{ xs: 12 }}>
            <TextField label="Notes" fullWidth size="small" multiline rows={2} value={notes} onChange={e => setNotes(e.target.value)} />
          </Grid>

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
        <Button variant="contained" disabled={savingAppt}
          onClick={async () => {
            setSavingAppt(true);
            try {
              const pid = selectedPatientId || patientId;
              const startIso = `${date}T${startTime || '09:00'}:00`;
              const endIso = `${date}T${endTime || '09:30'}:00`;
              const isRecurring = !editing && recurrence !== 'none';
              const method = editing ? apiClient.patch : apiClient.post;
              const url = editing ? `appointments/${editing.id}` : isRecurring ? 'appointments/recurring' : 'appointments';

              if (editing) {
                await method(url, {
                  clinicianId: clinician || undefined,
                  startTime: startIso,
                  endTime: endIso,
                  type: apptType || 'follow_up',
                  mode,
                  episodeId: episodeId || null,
                  notes: notes || undefined,
                  attendeeStaffIds: additionalClinicianIds.filter((staffId) => staffId !== clinician),
                  ...(telehealthLink ? {
                    telehealthDetails: {
                      telehealthLink,
                      telehealthProvider: undefined,
                      telehealthPasscode: undefined,
                    },
                  } : {}),
                });
              } else {
                await method(url, {
                  patientId: pid,
                  clinicianId: clinician || undefined,
                  startTime: startIso,
                  endTime: endIso,
                  type: apptType || 'follow_up',
                  mode,
                  episodeId: episodeId || undefined,
                  notes: notes || undefined,
                  attendeeStaffIds: additionalClinicianIds.filter((staffId) => staffId !== clinician),
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
              qc.invalidateQueries({ queryKey: appointmentKeys.all });
              qc.invalidateQueries({ queryKey: patientAppointmentsKeys.all });
              qc.invalidateQueries({ queryKey: patientsKeys.appointments(pid ?? '') });
              qc.invalidateQueries({ queryKey: calendarKeys.todayAll() });
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
          {savingAppt ? 'Creating...' : editing ? 'Save Appointment' : 'Create Appointment'}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
