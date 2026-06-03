import React, { useState } from 'react';
import {
  Alert, Box, Button, Chip, CircularProgress,
  Divider, FormControl, Grid, InputLabel, MenuItem,
  Paper, Select, Tab, Tabs, TextField, Typography,
} from '@mui/material';
import PersonAddIcon from '@mui/icons-material/PersonAdd';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import PhoneIcon from '@mui/icons-material/Phone';
import AccessTimeIcon from '@mui/icons-material/AccessTime';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '../../../shared/services/apiClient';
import { useAuthStore } from '../../../shared/store/authStore';
import { canAccessPermission } from '../../../shared/utils/frontendAccessPolicy';
import { PatientSearchAutocomplete, type PatientOption } from '../../patients/components/PatientSearchAutocomplete';
import { receptionistKeys } from '../queryKeys';
import {
  fmtTime,
  today,
  STATUS_CHIP,
  type AppointmentRow,
  type AppointmentsResponse,
  type StaffLookupRow,
  type StaffLookupResponse,
  type PhoneTriageCallRow,
  type PhoneTriageResponse,
  type WaitlistPositionRow,
  type WaitlistPositionsResponse,
  type BulkReminderResponse,
  type CheckInOutstandingResponse,
  toAppointmentRows,
  toStaffRows,
  toPhoneTriageRows,
  toWaitlistRows,
  normalizeOutstanding,
} from './receptionistPageSupport';
/* ─── main ─── */
export default function ReceptionistPage(): React.ReactElement {
  const [tab, setTab] = useState(0);
  return (
    <Box sx={{ p: { xs: 2, md: 3 }, bgcolor: '#FBF8F5', minHeight: '100vh' }}>
      {/* Header */}
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 3 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
          <PersonAddIcon sx={{ color: '#327C8D', fontSize: 28 }} />
          <Box>
            <Typography variant="h5" fontWeight={700} fontFamily="Albert Sans, sans-serif" color="#3D484B">Reception</Typography>
            <Typography variant="body2" color="text.secondary">Patient check-in, scheduling, and phone triage</Typography>
          </Box>
        </Box>
      </Box>
      <Tabs aria-label="Navigation tabs" value={tab} onChange={(_, v) => setTab(v)} sx={{ mb: 3, '& .MuiTab-root': { textTransform: 'none', fontWeight: 600 } }}>
        <Tab label="Today's Schedule" />
        <Tab label="Check-in" />
        <Tab label="Phone Triage" />
        <Tab label="Waitlist" />
        <Tab label="SMS Reminders" />
      </Tabs>
      {tab === 0 && <ScheduleTab />}
      {tab === 1 && <CheckInTab />}
      {tab === 2 && <PhoneTriageTab />}
      {tab === 3 && <WaitlistTab />}
      {tab === 4 && <SmsRemindersTab />}
    </Box>
  );
}
/* ─── Today's Schedule ─── */
function ScheduleTab() {
  const { data, isLoading, error } = useQuery<AppointmentsResponse>({
    queryKey: receptionistKeys.schedule(today()),
    queryFn: async (): Promise<AppointmentsResponse> => {
      try {
        return await apiClient.get<AppointmentsResponse>('appointments', { date: today() });
      } catch (err) {
        console.warn('ReceptionistPage: query failed', err);
        return [];
      }
    },
  });
  const appointments = toAppointmentRows(data);
  const grouped: Record<string, AppointmentRow[]> = {};
  appointments.forEach((a: AppointmentRow) => {
    const clinician = a.clinicianName ?? a.clinician ?? 'Unassigned';
    if (!grouped[clinician]) grouped[clinician] = [];
    grouped[clinician].push(a);
  });
  if (isLoading) return <CircularProgress role="progressbar" aria-label="Loading" sx={{ display: 'block', mx: 'auto', mt: 4 }} />;
  if (error) return <Alert role="alert" severity="error" sx={{ mt: 2 }}>Failed to load schedule</Alert>;
  return (
    <Box>
      {Object.keys(grouped).length === 0 && (
        <Typography color="text.secondary" sx={{ py: 4, textAlign: 'center' }}>No appointments today</Typography>
      )}
      {Object.entries(grouped).map(([clinician, appts]) => (
        <Paper key={clinician} variant="outlined" sx={{ mb: 2, p: 2 }}>
          <Typography variant="subtitle1" fontWeight={700} color="#327C8D" sx={{ mb: 1, fontFamily: 'Albert Sans, sans-serif' }}>
            {clinician}
          </Typography>
          <Divider sx={{ mb: 1.5 }} />
          {appts.sort((a, b) => (a.startTime ?? a.time ?? '').localeCompare(b.startTime ?? b.time ?? '')).map((appt: AppointmentRow, i: number) => {
            const status = appt.status ?? 'scheduled';
            const sc = STATUS_CHIP[status] ?? STATUS_CHIP.scheduled;
            return (
              <Box key={appt.id ?? i} sx={{ display: 'flex', alignItems: 'center', gap: 2, py: 0.75, borderBottom: i < appts.length - 1 ? '1px solid #eee' : 'none' }}>
                <Typography variant="body2" fontWeight={600} sx={{ minWidth: 55, color: '#3D484B' }}>
                  {fmtTime(appt.startTime ?? appt.time ?? '')}
                </Typography>
                <Typography variant="body2" sx={{ flex: 1, color: '#3D484B' }}>
                  {appt.patientDisplayName ?? appt.patientName ?? 'Patient'}
                </Typography>
                <Chip label={appt.type ?? appt.appointmentType ?? 'Appointment'} size="small" sx={{ bgcolor: '#E8F5F7', color: '#327C8D', fontWeight: 500, fontSize: 11 }} />
                <Chip label={status} size="small" sx={{ bgcolor: sc.bg, color: sc.color, fontWeight: 600, fontSize: 11, textTransform: 'capitalize' }} />
              </Box>
            );
          })}
        </Paper>
      ))}
    </Box>
  );
}
/* ─── Check-in (with clinician arrival notification) ─── */
function CheckInTab() {
  const qc = useQueryClient();
  const [filter, setFilter] = useState<'all' | 'waiting' | 'arrived'>('all');
  const [selectedOutstandingAppointmentId, setSelectedOutstandingAppointmentId] = useState<string | null>(null);
  const { data, isLoading, error } = useQuery<AppointmentsResponse>({
    queryKey: receptionistKeys.checkinAppointments(today()),
    queryFn: async (): Promise<AppointmentsResponse> => {
      try {
        return await apiClient.get<AppointmentsResponse>('appointments', { date: today() });
      } catch (err) {
        console.warn('ReceptionistPage: query failed', err);
        return [];
      }
    },
  });
  const {
    data: outstandingData,
    isLoading: isOutstandingLoading,
    error: outstandingError,
  } = useQuery<CheckInOutstandingResponse>({
    queryKey: selectedOutstandingAppointmentId
      ? receptionistKeys.checkinOutstanding(selectedOutstandingAppointmentId)
      : receptionistKeys.checkinOutstanding('none'),
    enabled: Boolean(selectedOutstandingAppointmentId),
    queryFn: () =>
      apiClient.get<CheckInOutstandingResponse>(
        `appointments/${selectedOutstandingAppointmentId}/check-in-outstanding`,
      ),
  });
  const checkInMut = useMutation({
    mutationFn: async (appt: AppointmentRow) => {
      await apiClient.post(`appointments/${appt.id}/check-in`, {});
      if (appt.clinician_id ?? appt.clinicianId) {
        await apiClient.post('notifications', {
          recipientStaffId: appt.clinician_id ?? appt.clinicianId,
          type: 'patient-arrived',
          title: 'Patient Arrived',
          body: `${appt.patientDisplayName ?? appt.patientName ?? 'Patient'} has checked in for their ${fmtTime(appt.startTime ?? appt.start_time ?? '')} appointment`,
          priority: 'normal',
          link: appt.patientId ? `/patients/${appt.patientId}` : undefined,
        }).catch((err) => { console.warn('ReceptionistPage: check-in notification failed (non-blocking)', err); });
      }
    },
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: receptionistKeys.checkinAppointmentsAll() });
      await qc.invalidateQueries({ queryKey: receptionistKeys.checkinOutstandingAll() });
    },
  });
  const appointments = toAppointmentRows(data);
  const filtered = appointments.filter(a => {
    if (filter === 'waiting') return a.status === 'scheduled' || a.status === 'confirmed';
    if (filter === 'arrived') return a.status === 'arrived' || a.status === 'checked-in';
    return true;
  });
  const waitingCount = appointments.filter(a => a.status === 'scheduled' || a.status === 'confirmed').length;
  const arrivedCount = appointments.filter(a => a.status === 'arrived' || a.status === 'checked-in').length;
  if (isLoading) return <CircularProgress role="progressbar" aria-label="Loading" sx={{ display: 'block', mx: 'auto', mt: 4 }} />;
  if (error) return <Alert role="alert" severity="error" sx={{ mt: 2 }}>Failed to load appointments</Alert>;
  return (
    <Box>
      {/* Summary bar */}
      <Box sx={{ display: 'flex', gap: 1.5, mb: 2 }}>
        <Chip label={`All (${appointments.length})`} onClick={() => setFilter('all')}
          variant={filter === 'all' ? 'filled' : 'outlined'} sx={{ cursor: 'pointer', fontWeight: 600, ...(filter === 'all' ? { bgcolor: '#327C8D', color: '#fff' } : {}) }} />
        <Chip label={`Waiting (${waitingCount})`} onClick={() => setFilter('waiting')}
          variant={filter === 'waiting' ? 'filled' : 'outlined'} sx={{ cursor: 'pointer', fontWeight: 600, ...(filter === 'waiting' ? { bgcolor: '#b8621a', color: '#fff' } : {}) }} />
        <Chip label={`Arrived (${arrivedCount})`} onClick={() => setFilter('arrived')}
          variant={filter === 'arrived' ? 'filled' : 'outlined'} sx={{ cursor: 'pointer', fontWeight: 600, ...(filter === 'arrived' ? { bgcolor: '#2E7D32', color: '#fff' } : {}) }} />
      </Box>
      {selectedOutstandingAppointmentId && (
        <Paper variant="outlined" sx={{ mb: 2, p: 1.5 }}>
          <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 1, flexWrap: 'wrap' }}>
            <Typography variant="subtitle2" sx={{ color: '#3D484B', fontWeight: 700 }}>
              Outstanding Items
            </Typography>
            <Button
              size="small"
              onClick={() => setSelectedOutstandingAppointmentId(null)}
              sx={{ textTransform: 'none', color: '#327C8D' }}
            >
              Hide
            </Button>
          </Box>
          {isOutstandingLoading && <Typography variant="caption" color="text.secondary">Loading outstanding items…</Typography>}
          {outstandingError && !isOutstandingLoading && (
            <Alert severity="warning" sx={{ mt: 1 }}>
              Could not load outstanding items for this appointment.
            </Alert>
          )}
          {!isOutstandingLoading && !outstandingError && (
            <Box sx={{ mt: 1, display: 'flex', gap: 1, flexWrap: 'wrap' }}>
              {(() => {
                const out = normalizeOutstanding(outstandingData?.outstanding);
                return (
                  <>
                    <Chip label={`Total: ${out.total}`} size="small" sx={{ fontWeight: 700, bgcolor: '#E8F5F7', color: '#327C8D' }} />
                    <Chip label={`Invoices: ${out.invoices}`} size="small" variant="outlined" />
                    <Chip label={`Flags: ${out.flags}`} size="small" variant="outlined" />
                    <Chip label={`Referrals: ${out.referrals}`} size="small" variant="outlined" />
                    <Chip label={`Docs: ${out.documents}`} size="small" variant="outlined" />
                  </>
                );
              })()}
            </Box>
          )}
        </Paper>
      )}
      <Paper variant="outlined">
        {filtered.length === 0 && (
          <Typography color="text.secondary" sx={{ py: 4, textAlign: 'center' }}>No appointments matching filter</Typography>
        )}
        {filtered.map((appt: AppointmentRow, i: number) => {
          const status = appt.status ?? 'scheduled';
          const isCheckedIn = status === 'arrived' || status === 'checked-in' || status === 'completed';
          return (
            <Box key={appt.id ?? i} sx={{ display: 'flex', alignItems: 'center', gap: 2, p: 2, borderBottom: '1px solid #eee' }}>
              <AccessTimeIcon sx={{ color: isCheckedIn ? '#2E7D32' : '#999', fontSize: 20 }} />
              <Typography variant="body2" fontWeight={600} sx={{ minWidth: 55 }}>
                {fmtTime(appt.startTime ?? appt.start_time ?? appt.time ?? '')}
              </Typography>
              <Box sx={{ flex: 1 }}>
                <Typography variant="body2" fontWeight={600}>{appt.patientDisplayName ?? appt.patientName ?? 'Patient'}</Typography>
                <Typography variant="caption" color="text.secondary">{appt.clinicianName ?? appt.clinicianName ?? ''}</Typography>
              </Box>
              <Chip label={appt.type ?? appt.appointment_type ?? 'Appt'} size="small" sx={{ bgcolor: '#E8F5F7', color: '#327C8D', fontSize: 11 }} />
              <Button
                size="small"
                variant="text"
                onClick={() => setSelectedOutstandingAppointmentId((prev) => prev === appt.id ? null : (appt.id ?? null))}
                sx={{ textTransform: 'none', fontSize: 12, color: '#327C8D', minWidth: 0, px: 1 }}
                disabled={!appt.id}
              >
                Outstanding
              </Button>
              {isCheckedIn ? (
                <Chip icon={<CheckCircleIcon />} label="Arrived" size="small" color="success" variant="outlined" />
              ) : (
                <Button size="small" variant="contained" startIcon={<CheckCircleIcon />}
                  disabled={checkInMut.isPending}
                  onClick={() => appt.id && checkInMut.mutate(appt)}
                  sx={{ bgcolor: '#2E7D32', textTransform: 'none', fontSize: 12, '&:hover': { bgcolor: '#1B5E20' } }}>
                  Check In
                </Button>
              )}
            </Box>
          );
        })}
      </Paper>
    </Box>
  );
}
/* ─── Phone Triage ─── */
function PhoneTriageTab() {
  const qc = useQueryClient();
  const user = useAuthStore((s) => s.user);
  const canWriteClinicalNotes = canAccessPermission(user, 'note:create');
  const [form, setForm] = useState({
    callerName: '', callerPhone: '', callerRelationship: '',
    patientId: '', patientSearch: '',
    urgency: 'routine' as string, reasonForCall: '', receptionistSummary: '',
    actionTaken: '', outcome: '', assignedToId: '',
  });
  const [selectedReceptionPatient, setSelectedReceptionPatient] = useState<PatientOption | null>(null);
  const [expandedCallId, setExpandedCallId] = useState<string | null>(null);
  const { data, isLoading } = useQuery<PhoneTriageResponse>({
    queryKey: receptionistKeys.phoneTriage(),
    queryFn: async (): Promise<PhoneTriageResponse> => {
      try {
        return await apiClient.get<PhoneTriageResponse>('phone-triage');
      } catch (err) {
        console.warn('ReceptionistPage: query failed', err);
        return [];
      }
    },
  });
  const { data: staffData } = useQuery<StaffLookupResponse>({
    queryKey: receptionistKeys.staffLookup(),
    queryFn: async (): Promise<StaffLookupResponse> => {
      try {
        return await apiClient.get<StaffLookupResponse>('staff/lookup');
      } catch (err) {
        console.warn('ReceptionistPage: query failed', err);
        return [];
      }
    },
  });
  const staffList = toStaffRows(staffData);
  const saveMut = useMutation({
    mutationFn: async (d: typeof form) => {
      const triage = await apiClient.post<{ id?: string }>('phone-triage', {
        callerName: d.callerName, callerPhone: d.callerPhone,
        callerRelationship: d.callerRelationship,
        patientId: d.patientId || undefined,
        urgency: d.urgency, reasonForCall: d.reasonForCall,
        receptionistSummary: d.receptionistSummary, actionTaken: d.actionTaken,
        assignedToId: d.assignedToId || undefined,
      });
      if (d.assignedToId && d.outcome === 'message-taken') {
        await apiClient.post('tasks', {
          title: `Phone message from ${d.callerName}`,
          description: `Reason: ${d.reasonForCall}\nSummary: ${d.receptionistSummary}\nCaller: ${d.callerName} ${d.callerPhone}`,
          assignedToId: d.assignedToId,
          patientId: d.patientId || undefined,
          priority: d.urgency === 'urgent' ? 'high' : d.urgency === 'semi-urgent' ? 'medium' : 'low',
        }).catch((err) => { console.warn('ReceptionistPage: phone triage task creation failed (non-blocking)', err); });
      }
      if (d.patientId && d.receptionistSummary && canWriteClinicalNotes) {
        await apiClient.post(`patients/${d.patientId}/notes`, {
          noteType: 'phone',
          content: `Phone Triage — ${d.callerName} (${d.callerRelationship || 'N/A'})\n` +
            `Urgency: ${d.urgency}\nReason: ${d.reasonForCall}\n` +
            `Summary: ${d.receptionistSummary}\nAction: ${d.actionTaken || 'None'}\nOutcome: ${d.outcome || 'N/A'}`,
        }).catch((err) => { console.warn('ReceptionistPage: phone triage note creation failed (non-blocking)', err); });
      }
      return triage;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: receptionistKeys.phoneTriage() });
      qc.invalidateQueries({ queryKey: receptionistKeys.tasks() });
      setForm({
        callerName: '', callerPhone: '', callerRelationship: '',
        patientId: '', patientSearch: '',
        urgency: 'routine', reasonForCall: '', receptionistSummary: '',
        actionTaken: '', outcome: '', assignedToId: '',
      });
      setSelectedReceptionPatient(null);
    },
  });
  const calls = toPhoneTriageRows(data);
  const URGENCY_COLORS: Record<string, string> = { urgent: '#D32F2F', 'semi-urgent': '#b8621a', routine: '#2E7D32' };
  return (
    <Grid container spacing={3}>
      {/* Form */}
      <Grid size={{ xs: 12, md: 5 }}>
        <Paper variant="outlined" sx={{ p: 2.5 }}>
          <Typography variant="subtitle1" fontWeight={700} color="#3D484B" sx={{ mb: 2, fontFamily: 'Albert Sans, sans-serif' }}>
            <PhoneIcon sx={{ fontSize: 18, mr: 0.5, verticalAlign: 'text-bottom', color: '#327C8D' }} />
            New Phone Call
          </Typography>
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5 }}>
            <TextField label="Caller Name *" size="small" fullWidth value={form.callerName}
              onChange={(e) => setForm(p => ({ ...p, callerName: e.target.value }))} />
            <Box sx={{ display: 'flex', gap: 1 }}>
              <TextField label="Caller Phone" size="small" fullWidth value={form.callerPhone}
                onChange={(e) => setForm(p => ({ ...p, callerPhone: e.target.value }))} />
              <TextField label="Relationship" size="small" fullWidth value={form.callerRelationship}
                onChange={(e) => setForm(p => ({ ...p, callerRelationship: e.target.value }))}
                placeholder="e.g. Self, Parent, Carer" />
            </Box>
            {/* Patient Search — Shape C: shared MUI Autocomplete (BUG-447 child 14/15) */}
            <Box>
              <Typography variant="caption" color="text.secondary" sx={{ mb: 0.5, display: 'block' }}>Patient</Typography>
              <PatientSearchAutocomplete
                value={selectedReceptionPatient}
                onChange={(p) => {
                  setSelectedReceptionPatient(p);
                  if (p) {
                    setForm(f => ({ ...f, patientId: p.id, patientSearch: `${p.givenName} ${p.familyName} (${p.emrNumber})` }));
                  } else {
                    setForm(f => ({ ...f, patientId: '', patientSearch: '' }));
                  }
                }}
                placeholder="Type patient name or MRN..."
                fullWidth
              />
            </Box>
            {/* Urgency */}
            <Box>
              <Typography variant="caption" color="text.secondary" sx={{ mb: 0.5, display: 'block' }}>Urgency</Typography>
              <Box sx={{ display: 'flex', gap: 1 }}>
                {(['urgent', 'semi-urgent', 'routine'] as const).map(u => (
                  <Chip key={u} label={u.replace('-', ' ')} size="small"
                    onClick={() => setForm(p => ({ ...p, urgency: u }))}
                    sx={{
                      bgcolor: form.urgency === u ? URGENCY_COLORS[u] : '#eee',
                      color: form.urgency === u ? '#fff' : '#555',
                      fontWeight: 600, cursor: 'pointer', textTransform: 'capitalize',
                    }} />
                ))}
              </Box>
            </Box>
            <TextField label="Reason for Call *" size="small" fullWidth multiline rows={2} value={form.reasonForCall}
              onChange={(e) => setForm(p => ({ ...p, reasonForCall: e.target.value }))} />
            <TextField label="Summary / Action" size="small" fullWidth multiline rows={2} value={form.receptionistSummary}
              onChange={(e) => setForm(p => ({ ...p, receptionistSummary: e.target.value }))}
              helperText="Administrative summary only. Clinical risk assessment is entered by a nurse." />
            {/* Assign to Staff */}
            <FormControl size="small" fullWidth>
              <InputLabel>Assign to Staff</InputLabel>
              <Select label="Assign to Staff" value={form.assignedToId} onChange={(e) => setForm(p => ({ ...p, assignedToId: e.target.value }))}>
                <MenuItem value="">— None —</MenuItem>
                {staffList.map((s: StaffLookupRow) => (
                  <MenuItem key={s.id} value={s.id}>{s.givenName} {s.familyName}</MenuItem>
                ))}
              </Select>
            </FormControl>
            {/* Outcome */}
            <FormControl size="small" fullWidth>
              <InputLabel>Outcome</InputLabel>
              <Select label="Outcome" value={form.outcome} onChange={(e) => setForm(p => ({ ...p, outcome: e.target.value }))}>
                <MenuItem value="advice-given">Advice Given</MenuItem>
                <MenuItem value="appointment-booked">Appointment Booked</MenuItem>
                <MenuItem value="message-taken">Message Taken (creates task)</MenuItem>
                <MenuItem value="transferred">Transferred to Clinician</MenuItem>
                <MenuItem value="emergency">Emergency Referral</MenuItem>
                <MenuItem value="callback-arranged">Callback Arranged</MenuItem>
              </Select>
            </FormControl>
            {form.outcome === 'message-taken' && !form.assignedToId && (
              <Alert role="alert" severity="warning" sx={{ fontSize: 11 }}>Select a staff member to create a task in their task list</Alert>
            )}
            {saveMut.isError && <Alert role="alert" severity="error">Failed to save call</Alert>}
            {saveMut.isSuccess && <Alert severity="success" sx={{ fontSize: 11 }}>Call saved. {form.outcome === 'message-taken' && form.assignedToId ? 'Task created.' : ''} {form.patientId ? 'Note added to patient record.' : ''}</Alert>}
            <Button variant="contained" disabled={saveMut.isPending || !form.callerName || !form.reasonForCall}
              onClick={() => saveMut.mutate(form)}
              sx={{ bgcolor: '#327C8D', textTransform: 'none', '&:hover': { bgcolor: '#286A78' } }}>
              {saveMut.isPending ? <CircularProgress role="progressbar" aria-label="Loading" size={20} /> : 'Save Call'}
            </Button>
          </Box>
        </Paper>
      </Grid>
      {/* Past calls */}
      <Grid size={{ xs: 12, md: 7 }}>
        <Paper variant="outlined" sx={{ p: 2.5 }}>
          <Typography variant="subtitle1" fontWeight={700} color="#3D484B" sx={{ mb: 2, fontFamily: 'Albert Sans, sans-serif' }}>
            Recent Calls
          </Typography>
          {isLoading && <CircularProgress role="progressbar" aria-label="Loading" size={24} />}
          {calls.length === 0 && !isLoading && (
            <Typography color="text.secondary" variant="body2" sx={{ py: 2, textAlign: 'center' }}>No calls recorded</Typography>
          )}
          {calls.slice(0, 20).map((c: PhoneTriageCallRow, i: number) => {
            const isExp = expandedCallId === (c.id ?? `c-${i}`);
            return (
            <Box key={c.id ?? i} sx={{ borderBottom: '1px solid #eee' }}>
              <Box
                role="button"
                tabIndex={0}
                aria-expanded={isExp}
                aria-label={`Call from ${c.caller_name ?? c.callerName ?? 'Unknown'} — ${isExp ? 'collapse' : 'expand'} details`}
                onClick={() => setExpandedCallId(isExp ? null : (c.id ?? `c-${i}`))}
                onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setExpandedCallId(isExp ? null : (c.id ?? `c-${i}`)); } }}
                sx={{ display: 'flex', alignItems: 'center', gap: 1.5, py: 1, cursor: 'pointer', '&:hover': { bgcolor: '#FAFAFA' }, '&:focus-visible': { outline: '2px solid #327C8D', outlineOffset: -2 } }}>
                <Chip label={c.urgency ?? 'routine'} size="small" sx={{
                  bgcolor: URGENCY_COLORS[c.urgency ?? 'routine'] ?? '#2E7D32', color: '#fff', fontWeight: 600, fontSize: 10, minWidth: 60, textTransform: 'capitalize',
                }} />
                <Box sx={{ flex: 1 }}>
                  <Typography variant="body2" fontWeight={600} sx={{ fontSize: 12 }}>{c.caller_name ?? c.callerName ?? 'Unknown'}</Typography>
                  <Typography variant="caption" color="text.secondary" sx={{ fontSize: 11 }}>{c.reason_for_call ?? c.reason ?? ''}</Typography>
                </Box>
                {c.assigned_to_id && <Chip label="Assigned" size="small" sx={{ fontSize: 9, height: 18, bgcolor: '#E8F5F7', color: '#327C8D' }} />}
                <Chip label={c.outcome ?? c.status ?? '-'} size="small" variant="outlined" sx={{ fontSize: 9, textTransform: 'capitalize' }} />
                <Typography variant="caption" color="text.secondary" sx={{ fontSize: 10 }}>
                  {c.createdAt ?? c.createdAt ? new Date(c.createdAt ?? c.createdAt).toLocaleString('en-AU', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : ''}
                </Typography>
              </Box>
              {isExp && (
                <Box sx={{ pl: 2, pb: 1.5, pt: 0.5, bgcolor: '#FAFAFA', borderRadius: 1, mb: 0.5 }}>
                  {c.caller_phone && <Typography variant="caption" display="block"><strong>Phone:</strong> {c.caller_phone}</Typography>}
                  {c.caller_relationship && <Typography variant="caption" display="block"><strong>Relationship:</strong> {c.caller_relationship}</Typography>}
                  {(c.receptionist_summary ?? c.receptionistSummary ?? c.triage_notes) && <Typography variant="caption" display="block"><strong>Summary:</strong> {c.receptionist_summary ?? c.receptionistSummary ?? c.triage_notes}</Typography>}
                  {(c.action_taken ?? c.actionTaken) && <Typography variant="caption" display="block"><strong>Action:</strong> {c.action_taken ?? c.actionTaken}</Typography>}
                  {c.outcome && <Typography variant="caption" display="block"><strong>Outcome:</strong> {c.outcome}</Typography>}
                </Box>
              )}
            </Box>
            );
          })}
        </Paper>
      </Grid>
    </Grid>
  );
}
/* ─── Waitlist with position + estimated wait ─── */
function WaitlistTab() {
  const { data, isLoading, error } = useQuery<WaitlistPositionsResponse>({
    queryKey: receptionistKeys.waitlistPositions(),
    queryFn: async (): Promise<WaitlistPositionsResponse> => {
      try {
        return await apiClient.get<WaitlistPositionsResponse>('waitlist/positions');
      } catch (err) {
        console.warn('ReceptionistPage: query failed', err);
        return [];
      }
    },
  });
  const positions = toWaitlistRows(data);
  const AVG_APPT_MINS = 30; // average appointment duration for wait estimate
  if (isLoading) return <CircularProgress role="progressbar" aria-label="Loading" sx={{ display: 'block', mx: 'auto', mt: 4 }} />;
  if (error) return <Alert role="alert" severity="error" sx={{ mt: 2 }}>Failed to load waitlist</Alert>;
  return (
    <Box>
      {positions.length > 0 && (
        <Alert severity="info" sx={{ mb: 2, fontSize: 12 }}>
          {positions.length} patient{positions.length > 1 ? 's' : ''} on waitlist. Estimated wait based on ~{AVG_APPT_MINS} min average appointment.
        </Alert>
      )}
      {positions.length === 0 && (
        <Typography color="text.secondary" sx={{ py: 4, textAlign: 'center' }}>Waitlist is empty</Typography>
      )}
      {positions.map((p: WaitlistPositionRow, i: number) => {
        const pos = p.position ?? i + 1;
        const waitMins = pos * AVG_APPT_MINS;
        const estWait = p.estimatedWait ?? (waitMins < 60 ? `~${waitMins} min` : `~${Math.floor(waitMins / 60)}h ${waitMins % 60}m`);
        const addedDate = p.addedAt ?? p.createdAt;
        const daysWaiting = addedDate ? Math.floor((Date.now() - new Date(addedDate).getTime()) / 86400000) : null;
        return (
          <Paper key={p.id ?? i} variant="outlined" sx={{ display: 'flex', alignItems: 'center', gap: 2, p: 2, mb: 1.5 }}>
            <Box sx={{
              width: 40, height: 40, borderRadius: '50%', bgcolor: '#327C8D', color: '#fff',
              display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700, fontSize: 16,
              fontFamily: 'Albert Sans, sans-serif',
            }}>
              {pos}
            </Box>
            <Box sx={{ flex: 1 }}>
              <Typography variant="body2" fontWeight={600} color="#3D484B">
                {p.given_name ?? p.patientDisplayName ?? p.patientName ?? 'Patient'} {p.family_name ?? ''}
              </Typography>
              <Typography variant="caption" color="text.secondary">
                {p.emr_number ? `${p.emr_number} | ` : ''}{p.reason ?? p.type ?? 'Waiting'}
                {daysWaiting != null ? ` | Added ${daysWaiting === 0 ? 'today' : `${daysWaiting}d ago`}` : ''}
              </Typography>
            </Box>
            <Chip icon={<AccessTimeIcon />} label={estWait} size="small"
              sx={{ bgcolor: '#FFF3E0', color: '#b8621a', fontWeight: 600, fontSize: 11 }} />
            <Chip label={p.priority ?? p.urgency ?? 'routine'} size="small" sx={{
              bgcolor: (p.priority ?? p.urgency) === 'urgent' ? '#FDECEA' : (p.priority ?? p.urgency) === 'high' ? '#FFF3E0' : '#E8F5E9',
              color: (p.priority ?? p.urgency) === 'urgent' ? '#D32F2F' : (p.priority ?? p.urgency) === 'high' ? '#b8621a' : '#2E7D32',
              fontWeight: 600, fontSize: 11, textTransform: 'capitalize',
            }} />
          </Paper>
        );
      })}
    </Box>
  );
}
/**
 * BUG-445 — pure helpers extracted for testability. The component
 * delegates all result-shape decisions to these so unit tests can
 * exercise the production code path without a DOM environment (the
 * web project's vitest runs without jsdom per `apps/web/vitest.config.ts`).
 */
export type BulkSmsResult = {
  sent: number;
  failed: number;
  message?: string;
};
export function computeBulkResult(
  res: { sentCount?: number; sent?: number; failedCount?: number; failed?: number },
  withPhoneCount: number,
): BulkSmsResult {
  return {
    sent: res.sentCount ?? res.sent ?? withPhoneCount,
    failed: res.failedCount ?? res.failed ?? 0,
  };
}
export function computeBulkResultOnError(
  err: unknown,
  withPhoneCount: number,
): BulkSmsResult {
  const errMsg = err instanceof Error ? err.message : String(err);
  return {
    sent: 0,
    failed: withPhoneCount,
    message: `Failed to send reminders: ${errMsg}`,
  };
}
export function bulkResultSeverity(result: BulkSmsResult): 'error' | 'success' {
  return result.failed > 0 ? 'error' : 'success';
}
/* ─── SMS Reminders ─── */
function SmsRemindersTab() {
  const [sending, setSending] = useState(false);
  const [result, setResult] = useState<{ sent: number; failed: number; message?: string } | null>(null);
  const targetDate = new Date(Date.now() + 86400000).toISOString().slice(0, 10); // tomorrow
  const { data: apptData, isLoading } = useQuery<AppointmentsResponse>({
    queryKey: receptionistKeys.smsReminderAppts(targetDate),
    queryFn: async (): Promise<AppointmentsResponse> => {
      try {
        return await apiClient.get<AppointmentsResponse>('appointments', { date: targetDate });
      } catch (err) {
        console.warn('ReceptionistPage: query failed', err);
        return [];
      }
    },
  });
  const appointments = toAppointmentRows(apptData);
  const withPhone = appointments.filter((a: AppointmentRow) => a.patientPhone ?? a.patient_phone);
  const sendBulkReminders = async () => {
    setSending(true); setResult(null);
    try {
      const res = await apiClient.post<BulkReminderResponse>('patient-outreach/bulk-reminder', {
        date: targetDate,
        messageTemplate: 'Reminder: You have an appointment at {clinic} on {date} at {time}.',
        totalRecipients: withPhone.length,
      });
      setResult(computeBulkResult(res, withPhone.length));
    } catch (err) {
      setResult(computeBulkResultOnError(err, withPhone.length));
      console.warn('ReceptionistPage: bulk-reminder send failed', { kind: 'bulk_sms_send_failed', err });
    }
    setSending(false);
  };
  return (
    <Box>
      <Paper variant="outlined" sx={{ p: 2.5, mb: 3 }}>
        <Typography variant="subtitle1" fontWeight={700} color="#3D484B" sx={{ mb: 1, fontFamily: 'Albert Sans, sans-serif' }}>
          Tomorrow's Appointment Reminders
        </Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          Send SMS reminders to patients with appointments on <strong>{new Date(targetDate).toLocaleDateString('en-AU', { weekday: 'long', day: 'numeric', month: 'long' })}</strong>
        </Typography>
        {isLoading && <CircularProgress role="progressbar" aria-label="Loading" size={24} />}
        {!isLoading && (
          <Box sx={{ display: 'flex', gap: 2, alignItems: 'center', mb: 2 }}>
            <Chip label={`${appointments.length} appointments`} sx={{ fontWeight: 600 }} />
            <Chip label={`${withPhone.length} with phone`} sx={{ fontWeight: 600, bgcolor: '#E8F5E9', color: '#2E7D32' }} />
            <Chip label={`${appointments.length - withPhone.length} missing phone`} sx={{ fontWeight: 600, bgcolor: appointments.length - withPhone.length > 0 ? '#FFF3E0' : '#E8F5E9', color: appointments.length - withPhone.length > 0 ? '#b8621a' : '#2E7D32' }} />
          </Box>
        )}
        <Button variant="contained" disabled={sending || withPhone.length === 0}
          onClick={sendBulkReminders}
          sx={{ bgcolor: '#327C8D', textTransform: 'none', '&:hover': { bgcolor: '#286A78' } }}>
          {sending ? <CircularProgress role="progressbar" aria-label="Loading" size={20} sx={{ color: '#fff', mr: 1 }} /> : null}
          {sending ? 'Sending...' : `Send ${withPhone.length} Reminders`}
        </Button>
        {result && (
          <Alert severity={result.failed > 0 ? 'error' : 'success'} sx={{ mt: 2, fontSize: 12 }}>
            {result.sent > 0 ? `${result.sent} reminders sent.` : null}
            {result.failed > 0 ? ` ${result.failed} failed to send.` : ''}
            {result.message ? ` ${result.message}` : ''}
          </Alert>
        )}
      </Paper>
      {/* Preview list */}
      {appointments.length > 0 && (
        <Paper variant="outlined" sx={{ p: 2.5 }}>
          <Typography variant="subtitle2" fontWeight={700} color="#3D484B" sx={{ mb: 1.5 }}>
            Appointment Preview — {new Date(targetDate).toLocaleDateString('en-AU', { weekday: 'short', day: 'numeric', month: 'short' })}
          </Typography>
          {appointments.slice(0, 20).map((a: AppointmentRow, i: number) => (
            <Box key={a.id ?? i} sx={{ display: 'flex', alignItems: 'center', gap: 1.5, py: 0.75, borderBottom: '1px solid #eee' }}>
              <Typography variant="body2" fontWeight={600} sx={{ minWidth: 50, fontSize: 12 }}>
                {fmtTime(a.startTime ?? a.start_time ?? '')}
              </Typography>
              <Typography variant="body2" sx={{ flex: 1, fontSize: 12 }}>
                {a.patientDisplayName ?? a.patientName ?? 'Patient'}
              </Typography>
              <Typography variant="caption" color="text.secondary" sx={{ fontSize: 11 }}>
                {a.clinicianName ?? a.clinicianName ?? ''}
              </Typography>
              {(a.patientPhone ?? a.patient_phone) ? (
                <Chip label="Has phone" size="small" sx={{ fontSize: 9, height: 18, bgcolor: '#E8F5E9', color: '#2E7D32' }} />
              ) : (
                <Chip label="No phone" size="small" sx={{ fontSize: 9, height: 18, bgcolor: '#FFF3E0', color: '#b8621a' }} />
              )}
            </Box>
          ))}
        </Paper>
      )}
    </Box>
  );
}
