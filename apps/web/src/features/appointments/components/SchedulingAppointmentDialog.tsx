import {
  Alert,
  Button,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  FormControl,
  Grid,
  InputLabel,
  MenuItem,
  Select,
  TextField,
  Typography,
} from '@mui/material';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import React from 'react';
import {
  ALL_SPECIALTIES,
  SPECIALTY_DISPLAY,
  type AppointmentMode,
  type AppointmentType,
  type CreateAppointmentDTO,
  type SpecialtyType,
} from '@signacare/shared';
import { apiClient } from '../../../shared/services/apiClient';
import { extractListResponse } from '../../../shared/services/extractListResponse';
import { calendarKeys } from '../../calendar/queryKeys';
import { PatientSearchAutocomplete, type PatientOption } from '../../patients/components/PatientSearchAutocomplete';
import { patientAppointmentsKeys, patientsKeys } from '../../patients/queryKeys';
import { appointmentKeys } from '../queryKeys';
import { appointmentApi } from '../services/appointmentApi';

interface StaffLookupRow {
  id: string;
  givenName: string;
  familyName: string;
}

interface EpisodeRow {
  id: string;
  title: string;
  episodeType: string;
  status: string;
}

interface AppointmentDraft {
  attendeeStaffIds?: string[];
  clinicianId: string;
  endTime: string;
  episodeId?: string | null;
  id: string;
  mode?: AppointmentMode | null;
  notes?: string | null;
  patientId: string;
  specialtyCode?: SpecialtyType | null;
  startTime: string;
  telehealthLink?: string | null;
  teamId?: string | null;
  type: AppointmentType;
}

interface SchedulingAppointmentDialogProps {
  editing?: AppointmentDraft | null;
  flatUnits: { id: string; name: string }[];
  initialDraft?: {
    date?: string;
    duration?: number;
    startTime?: string;
  } | null;
  onClose: () => void;
  open: boolean;
  staffList: StaffLookupRow[];
}

const DURATIONS = [15, 20, 30, 45, 60, 90, 120];

const APPOINTMENT_TYPE_OPTIONS: Array<{ value: AppointmentType; label: string }> = [
  { value: 'clinical_review', label: 'Psychiatrist Review' },
  { value: 'follow_up', label: 'Follow-up' },
  { value: 'assessment', label: 'Assessment' },
  { value: 'initial', label: 'Initial Assessment' },
  { value: 'group', label: 'Group Session' },
  { value: 'telehealth', label: 'Telehealth' },
];

const APPOINTMENT_MODE_OPTIONS: Array<{ value: AppointmentMode; label: string }> = [
  { value: 'direct', label: 'Direct' },
  { value: 'telehealth', label: 'Telehealth' },
  { value: 'videoconference', label: 'Videoconference' },
  { value: 'other', label: 'Other' },
];

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

function EpisodeSelector({
  additionalClinicianIds,
  editing,
  episodeId,
  patientId,
  setAdditionalClinicianIds,
  setEpisodeId,
}: {
  additionalClinicianIds: string[];
  editing?: AppointmentDraft | null;
  episodeId: string;
  patientId: string;
  setAdditionalClinicianIds: React.Dispatch<React.SetStateAction<string[]>>;
  setEpisodeId: (value: string) => void;
}) {
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

  React.useEffect(() => {
    if (editing || !alloc?.mdt?.length || additionalClinicianIds.length > 0) return;
    const suggestedIds = alloc.mdt
      .map((member) => member.staffid)
      .filter((staffId): staffId is string => typeof staffId === 'string' && staffId.length > 0);
    if (suggestedIds.length > 0) {
      setAdditionalClinicianIds(Array.from(new Set(suggestedIds)));
    }
  }, [additionalClinicianIds.length, alloc, editing, setAdditionalClinicianIds]);

  return (
    <>
      <Grid size={{ xs: 12, sm: 6 }}>
        <FormControl fullWidth size="small">
          <InputLabel>Episode</InputLabel>
          <Select value={episodeId} onChange={(event) => setEpisodeId(String(event.target.value))} label="Episode">
            <MenuItem value="">— No episode —</MenuItem>
            {(episodes ?? []).map((episode) => (
              <MenuItem key={episode.id} value={episode.id}>
                {episode.title} ({episode.episodeType})
              </MenuItem>
            ))}
          </Select>
        </FormControl>
      </Grid>
      {episodeId && alloc?.mdt?.length ? (
        <Grid size={{ xs: 12 }}>
          <Typography variant="caption" color="text.secondary">
            MDT from episode: {alloc.mdt.map((member) => `${member.staffname} (${member.rolename})`).join(', ')}
          </Typography>
        </Grid>
      ) : null}
    </>
  );
}

export function SchedulingAppointmentDialog({
  editing,
  flatUnits,
  initialDraft,
  onClose,
  open,
  staffList,
}: SchedulingAppointmentDialogProps) {
  const queryClient = useQueryClient();
  const isEditing = Boolean(editing);
  const [selectedPatient, setSelectedPatient] = React.useState<PatientOption | null>(null);
  const [date, setDate] = React.useState(new Date().toISOString().split('T')[0]);
  const [startTime, setStartTime] = React.useState('09:00');
  const [duration, setDuration] = React.useState(30);
  const [endTime, setEndTime] = React.useState('09:30');
  const [clinician, setClinician] = React.useState('');
  const [team, setTeam] = React.useState('');
  const [specialty, setSpecialty] = React.useState<SpecialtyType | ''>('');
  const [appointmentType, setAppointmentType] = React.useState<AppointmentType>('clinical_review');
  const [mode, setMode] = React.useState<AppointmentMode>('direct');
  const [telehealthLink, setTelehealthLink] = React.useState('');
  const [episodeId, setEpisodeId] = React.useState('');
  const [additionalClinicianIds, setAdditionalClinicianIds] = React.useState<string[]>([]);
  const [notes, setNotes] = React.useState('');
  const [saving, setSaving] = React.useState(false);
  const [saveError, setSaveError] = React.useState('');

  const effectivePatientId = editing?.patientId ?? selectedPatient?.id ?? '';

  const patientSummary = useQuery({
    queryKey: appointmentKeys.dialogPatient(editing?.patientId ?? ''),
    queryFn: () => apiClient.get<{ givenName?: string; familyName?: string; emrNumber?: string }>(`patients/${editing?.patientId}`),
    enabled: Boolean(editing?.patientId),
    staleTime: 60_000,
  });

  React.useEffect(() => {
    if (editing) {
      const start = new Date(editing.startTime);
      const end = new Date(editing.endTime);
      const durationMinutes = Math.max(15, Math.round((end.getTime() - start.getTime()) / 60_000));
      setSelectedPatient(null);
      setDate(start.toISOString().slice(0, 10));
      setStartTime(start.toISOString().slice(11, 16));
      setDuration(durationMinutes);
      setEndTime(end.toISOString().slice(11, 16));
      setClinician(editing.clinicianId ?? '');
      setTeam(editing.teamId ?? '');
      setSpecialty(editing.specialtyCode ?? '');
      setAppointmentType(editing.type);
      setMode(editing.mode ?? 'direct');
      setTelehealthLink(editing.telehealthLink ?? '');
      setEpisodeId(editing.episodeId ?? '');
      setAdditionalClinicianIds(editing.attendeeStaffIds ?? []);
      setNotes(editing.notes ?? '');
      setSaveError('');
      return;
    }

    setSelectedPatient(null);
    const nextDate = initialDraft?.date ?? new Date().toISOString().split('T')[0];
    const nextStartTime = initialDraft?.startTime ?? '09:00';
    const nextDuration = initialDraft?.duration ?? 30;
    const [hours, minutes] = nextStartTime.split(':').map(Number);
    const totalMinutes = hours * 60 + minutes + nextDuration;
    setDate(nextDate);
    setStartTime(nextStartTime);
    setDuration(nextDuration);
    setEndTime(
      `${String(Math.floor(totalMinutes / 60)).padStart(2, '0')}:${String(totalMinutes % 60).padStart(2, '0')}`,
    );
    setClinician('');
    setTeam('');
    setSpecialty('');
    setAppointmentType('clinical_review');
    setMode('direct');
    setTelehealthLink('');
    setEpisodeId('');
    setAdditionalClinicianIds([]);
    setNotes('');
    setSaveError('');
  }, [editing, initialDraft, open]);

  React.useEffect(() => {
    const [hours, minutes] = startTime.split(':').map(Number);
    const totalMinutes = hours * 60 + minutes + duration;
    setEndTime(
      `${String(Math.floor(totalMinutes / 60)).padStart(2, '0')}:${String(totalMinutes % 60).padStart(2, '0')}`,
    );
  }, [duration, startTime]);

  const isTelehealth = mode === 'telehealth' || mode === 'videoconference';

  const formatStaffName = (staffId: string) => {
    const staff = staffList.find((row) => row.id === staffId);
    return staff ? `${staff.givenName} ${staff.familyName}` : staffId;
  };

  const invalidateSchedulingQueries = async (patientId: string) => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: appointmentKeys.all }),
      queryClient.invalidateQueries({ queryKey: calendarKeys.all }),
      queryClient.invalidateQueries({ queryKey: patientsKeys.appointments(patientId) }),
      queryClient.invalidateQueries({ queryKey: patientAppointmentsKeys.byPatient(patientId) }),
    ]);
  };

  const handleSave = async () => {
    if (!effectivePatientId) {
      setSaveError('Select a patient before saving.');
      return;
    }

    setSaving(true);
    setSaveError('');
    const startIso = `${date}T${startTime}:00Z`;
    const endIso = `${date}T${endTime}:00Z`;

    try {
      if (editing) {
        await appointmentApi.update(editing.id, {
          attendeeStaffIds: additionalClinicianIds.filter((staffId) => staffId !== clinician),
          clinicianId: clinician || undefined,
          endTime: endIso,
          episodeId: episodeId || null,
          mode: mode || undefined,
          notes: notes || undefined,
          startTime: startIso,
          telehealthDetails: telehealthLink ? { telehealthLink } : undefined,
          type: appointmentType,
        });
      } else {
        const payload: CreateAppointmentDTO & { teamId?: string } = {
          attendeeStaffIds: additionalClinicianIds.filter((staffId) => staffId !== clinician),
          clinicianId: clinician || undefined,
          endTime: endIso,
          episodeId: episodeId || undefined,
          mode: mode || undefined,
          notes: notes || undefined,
          patientId: effectivePatientId,
          specialtyCode: specialty || undefined,
          startTime: startIso,
          teamId: team || undefined,
          telehealthDetails: telehealthLink ? { telehealthLink } : undefined,
          type: appointmentType,
        };
        await appointmentApi.create(payload);
      }
      await invalidateSchedulingQueries(effectivePatientId);
      onClose();
    } catch (err: unknown) {
      const message = getErrorMessage(err, 'Failed to save appointment.');
      setSaveError(message);
    } finally {
      setSaving(false);
    }
  };

  const editingPatientName = (() => {
    if (!editing) return '';
    const payload = patientSummary.data;
    const name = `${payload?.givenName ?? ''} ${payload?.familyName ?? ''}`.trim();
    return name || editing.patientId;
  })();

  return (
    <Dialog aria-labelledby="dialog-title" open={open} onClose={onClose} maxWidth="md" fullWidth>
      <DialogTitle id="dialog-title" sx={{ fontFamily: 'Albert Sans, sans-serif', fontWeight: 700 }}>
        {isEditing ? 'Edit Appointment' : 'New Appointment'}
      </DialogTitle>
      <Divider />
      <DialogContent>
        <Grid container spacing={2} sx={{ mt: 0.5 }}>
          {!isEditing ? (
            <Grid size={{ xs: 12 }}>
              <Typography variant="subtitle2" sx={{ mb: 0.5 }}>
                Patient *
              </Typography>
              <PatientSearchAutocomplete value={selectedPatient} onChange={setSelectedPatient} fullWidth />
            </Grid>
          ) : (
            <Grid size={{ xs: 12 }}>
              <Alert severity="info">
                Editing appointment for {editingPatientName}
              </Alert>
            </Grid>
          )}

          {effectivePatientId ? (
            <EpisodeSelector
              additionalClinicianIds={additionalClinicianIds}
              editing={editing}
              episodeId={episodeId}
              patientId={effectivePatientId}
              setAdditionalClinicianIds={setAdditionalClinicianIds}
              setEpisodeId={setEpisodeId}
            />
          ) : null}

          <Grid size={{ xs: 12, sm: 6 }}>
            <FormControl fullWidth size="small">
              <InputLabel>Appointment Type</InputLabel>
              <Select value={appointmentType} onChange={(event) => setAppointmentType(event.target.value as AppointmentType)} label="Appointment Type">
                {APPOINTMENT_TYPE_OPTIONS.map((option) => (
                  <MenuItem key={option.value} value={option.value}>
                    {option.label}
                  </MenuItem>
                ))}
              </Select>
            </FormControl>
          </Grid>

          <Grid size={{ xs: 12, sm: 3 }}>
            <TextField label="Date" type="date" fullWidth size="small" value={date} onChange={(event) => setDate(event.target.value)} slotProps={{ inputLabel: { shrink: true } }} />
          </Grid>
          <Grid size={{ xs: 6, sm: 3 }}>
            <TextField label="Start Time" type="time" fullWidth size="small" value={startTime} onChange={(event) => setStartTime(event.target.value)} slotProps={{ inputLabel: { shrink: true } }} />
          </Grid>
          <Grid size={{ xs: 6, sm: 3 }}>
            <FormControl fullWidth size="small">
              <InputLabel>Duration</InputLabel>
              <Select value={duration} onChange={(event) => setDuration(Number(event.target.value))} label="Duration">
                {DURATIONS.map((option) => (
                  <MenuItem key={option} value={option}>
                    {option} min
                  </MenuItem>
                ))}
              </Select>
            </FormControl>
          </Grid>
          <Grid size={{ xs: 6, sm: 3 }}>
            <TextField label="End Time" type="time" fullWidth size="small" value={endTime} onChange={(event) => setEndTime(event.target.value)} slotProps={{ inputLabel: { shrink: true } }} />
          </Grid>

          <Grid size={{ xs: 12, sm: 6 }}>
            <FormControl fullWidth size="small">
              <InputLabel>Mode</InputLabel>
              <Select value={mode} onChange={(event) => setMode(event.target.value as AppointmentMode)} label="Mode">
                {APPOINTMENT_MODE_OPTIONS.map((option) => (
                  <MenuItem key={option.value} value={option.value}>
                    {option.label}
                  </MenuItem>
                ))}
              </Select>
            </FormControl>
          </Grid>
          {isTelehealth ? (
            <Grid size={{ xs: 12, sm: 6 }}>
              <TextField label="Telehealth Link" fullWidth size="small" value={telehealthLink} onChange={(event) => setTelehealthLink(event.target.value)} placeholder="https://meet.example.com/..." />
            </Grid>
          ) : null}

          <Grid size={{ xs: 12, sm: isEditing ? 6 : 4 }}>
            <FormControl fullWidth size="small">
              <InputLabel>Clinician</InputLabel>
              <Select value={clinician} onChange={(event) => setClinician(event.target.value)} label="Clinician">
                <MenuItem value="">—</MenuItem>
                {staffList.map((staff) => (
                  <MenuItem key={staff.id} value={staff.id}>
                    {staff.givenName} {staff.familyName}
                  </MenuItem>
                ))}
              </Select>
            </FormControl>
          </Grid>

          {!isEditing ? (
            <>
              <Grid size={{ xs: 12, sm: 4 }}>
                <FormControl fullWidth size="small">
                  <InputLabel>Specialty</InputLabel>
                  <Select value={specialty} onChange={(event) => setSpecialty(event.target.value as SpecialtyType | '')} label="Specialty">
                    <MenuItem value="">— Auto —</MenuItem>
                    {ALL_SPECIALTIES.map((code) => (
                      <MenuItem key={code} value={code}>
                        {SPECIALTY_DISPLAY[code]}
                      </MenuItem>
                    ))}
                  </Select>
                </FormControl>
              </Grid>
              <Grid size={{ xs: 12, sm: 4 }}>
                <FormControl fullWidth size="small">
                  <InputLabel>Team / Unit</InputLabel>
                  <Select value={team} onChange={(event) => setTeam(event.target.value)} label="Team / Unit">
                    <MenuItem value="">—</MenuItem>
                    {flatUnits.map((unit) => (
                      <MenuItem key={unit.id} value={unit.id}>
                        {unit.name}
                      </MenuItem>
                    ))}
                  </Select>
                </FormControl>
              </Grid>
            </>
          ) : null}

          <Grid size={{ xs: 12, sm: isEditing ? 6 : 12 }}>
            <FormControl fullWidth size="small">
              <InputLabel>Additional clinicians</InputLabel>
              <Select
                multiple
                value={additionalClinicianIds}
                onChange={(event) => setAdditionalClinicianIds(typeof event.target.value === 'string' ? event.target.value.split(',') : event.target.value)}
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
            <TextField label="Notes" fullWidth size="small" multiline rows={3} value={notes} onChange={(event) => setNotes(event.target.value)} />
          </Grid>

          {saveError ? (
            <Grid size={{ xs: 12 }}>
              <Alert severity="error">{saveError}</Alert>
            </Grid>
          ) : null}
        </Grid>
      </DialogContent>
      <Divider />
      <DialogActions sx={{ px: 3, py: 2 }}>
        <Button onClick={onClose}>Cancel</Button>
        <Button
          variant="contained"
          disabled={!effectivePatientId || saving}
          onClick={handleSave}
          sx={{ bgcolor: '#b8621a', '&:hover': { bgcolor: '#d6741f' } }}
        >
          {saving ? <CircularProgress role="progressbar" aria-label="Loading" size={16} sx={{ color: '#fff' }} /> : isEditing ? 'Save Changes' : 'Create Appointment'}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
