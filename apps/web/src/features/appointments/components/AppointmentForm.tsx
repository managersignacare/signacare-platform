// apps/web/src/features/appointments/components/AppointmentForm.tsx
import { zodResolver } from '@hookform/resolvers/zod';
import {
  Alert,
  Box,
  Button,
  Checkbox,
  FormControlLabel,
  FormGroup,
  Grid,
  MenuItem,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { CreateAppointmentDTO as CreateAppointmentSchema } from '@signacare/shared';
import { Controller, useForm } from 'react-hook-form';
import { apiClient } from '../../../shared/services/apiClient';
import { useCreateAppointment, useCreateRecurringAppointment } from '../hooks/useCreateAppointment';
import { appointmentKeys } from '../queryKeys';
import type { CreateAppointment } from '../types/appointmentTypes';

const DOW_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

interface Props {
  onSuccess?: () => void;
}

// Phase 13 PR5 — UUID validator for the additional-clinicians field.
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface AppointmentMode { id: string; name: string; isActive: boolean }

interface AppointmentMutationErrorLike {
  code?: string;
  status?: number;
  message?: string;
  response?: {
    data?: {
      code?: string;
      error?: string;
    };
  };
}

const asAppointmentMutationError = (error: unknown): AppointmentMutationErrorLike =>
  (error && typeof error === 'object' ? error : {}) as AppointmentMutationErrorLike;

const getAppointmentMutationMessage = (error: unknown): string => {
  const parsed = asAppointmentMutationError(error);
  return parsed.response?.data?.error ?? parsed.message ?? 'Failed to create appointment.';
};

const isAppointmentConflict = (error: unknown): boolean => {
  const parsed = asAppointmentMutationError(error);
  const code = parsed.response?.data?.code ?? parsed.code;
  const status = parsed.status;
  const message = (parsed.response?.data?.error ?? parsed.message ?? '').toLowerCase();
  return code === 'APPOINTMENT_CONFLICT' || status === 409 || message.includes('already booked');
};

export const AppointmentForm = ({ onSuccess }: Props) => {
  const { data: appointmentModes } = useQuery({
    queryKey: appointmentKeys.staffSettingsAppointmentModes(),
    queryFn: () => apiClient.get<{ modes: AppointmentMode[] }>('staff-settings/appointment-modes').then(r => r.modes ?? []),
    staleTime: 5 * 60 * 1000,
  });
  const { mutate, isPending, isError, error } = useCreateAppointment();
  const recurringMut = useCreateRecurringAppointment();
  const [recurring, setRecurring] = useState(false);
  const [recurrenceRule, setRecurrenceRule] = useState<'daily' | 'weekly' | 'fortnightly' | 'monthly'>('weekly');
  const [daysOfWeek, setDaysOfWeek] = useState<number[]>([]);
  const [recurrenceEndDate, setRecurrenceEndDate] = useState<string>('');
  // Phase 13 PR5 — additional clinicians (co_clinicians). Comma- or
  // whitespace-separated UUIDs. Empty = single-clinician booking
  // (the default existing path).
  const [attendeesRaw, setAttendeesRaw] = useState<string>('');
  const attendeeIds = attendeesRaw
    .split(/[\s,]+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  const attendeesValid = attendeeIds.every((id) => UUID_RE.test(id));
  const toggleDay = (dow: number) =>
    setDaysOfWeek((cur) => (cur.includes(dow) ? cur.filter((d) => d !== dow) : [...cur, dow].sort()));
  const {
    control,
    handleSubmit,
    watch,
    formState: { errors },
  } = useForm<CreateAppointment>({
    resolver: zodResolver(CreateAppointmentSchema),
    defaultValues: {
      patientId: '',
      episodeId: '',
      clinicianId: '',
      type: 'initial',
      startTime: new Date().toISOString(),
      endTime: new Date().toISOString(),
      notes: '',
    },
  });
  const appointmentConflict = isAppointmentConflict(error);
  const appointmentErrorMessage = getAppointmentMutationMessage(error);

  const isTelehealth = watch('type') === 'telehealth';
  const onSubmit = (values: CreateAppointment) => {
    // datetime-local inputs produce "YYYY-MM-DDTHH:MM" — append seconds+timezone for ISO 8601
    const normalise = (dt: string) => {
      if (dt && !dt.includes('Z') && !dt.includes('+')) {
        return dt.length === 16 ? dt + ':00Z' : dt + 'Z'; // "2026-03-30T14:30" → "2026-03-30T14:30:00Z"
      }
      return dt;
    };
    const payload = {
      ...values,
      startTime: normalise(values.startTime),
      endTime: normalise(values.endTime),
      episodeId: values.episodeId || undefined, // empty string → undefined (avoids UUID validation failure)
      // Phase 13 PR5 — pipe additional clinician ids through to the
      // backend so each gets an appointment_attendees row with
      // role='co_clinician'. Omitted when empty so single-clinician
      // bookings keep their existing payload shape.
      ...(attendeeIds.length > 0 ? { attendeeStaffIds: attendeeIds } : {}),
    };
    if (recurring && recurrenceEndDate) {
      const weekday = (recurrenceRule === 'weekly' || recurrenceRule === 'fortnightly');
      recurringMut.mutate(
        {
          ...(payload as CreateAppointment),
          recurrenceRule,
          recurrenceEndDate,
          daysOfWeek: weekday && daysOfWeek.length > 0 ? daysOfWeek : undefined,
        },
        { onSuccess: () => onSuccess?.() },
      );
    } else {
      mutate(payload as CreateAppointment, { onSuccess: () => onSuccess?.() });
    }
  };

  return (
    <Box component="form" onSubmit={handleSubmit(onSubmit)}>
      <Stack spacing={2.5}>
        {isError ? (
          <Alert severity={appointmentConflict ? 'warning' : 'error'}>
            {appointmentConflict
              ? 'This clinician is already booked during the selected time slot. Please choose a different time or clinician.'
              : appointmentErrorMessage}
          </Alert>
        ) : null}
        <Grid container spacing={2}>
          <Grid>
            <Controller
              name="patientId"
              control={control}
              render={({ field }) => (
                <TextField
                  {...field}
                  label="Patient ID"
                  error={Boolean(errors.patientId)}
                  helperText={errors.patientId?.message}
                />
              )}
            />
          </Grid>
          <Grid>
            <Controller
              name="episodeId"
              control={control}
              render={({ field }) => (
                <TextField
                  {...field}
                  label="Episode ID"
                  error={Boolean(errors.episodeId)}
                  helperText={errors.episodeId?.message}
                />
              )}
            />
          </Grid>
          <Grid>
            <Controller
              name="clinicianId"
              control={control}
              render={({ field }) => (
                <TextField
                  {...field}
                  label="Clinician ID"
                  error={Boolean(errors.clinicianId)}
                  helperText={errors.clinicianId?.message}
                />
              )}
            />
          </Grid>
          <Grid>
            <Controller
              name="type"
              control={control}
              render={({ field }) => (
                <TextField
                  {...field}
                  select
                  label="Appointment type"
                  error={Boolean(errors.type)}
                  helperText={errors.type?.message}
                >
                  {(appointmentModes && appointmentModes.length > 0
                    ? appointmentModes.filter(m => m.isActive)
                    : [{ id: 'initial', name: 'Initial' }, { id: 'follow_up', name: 'Follow up' }, { id: 'assessment', name: 'Assessment' }, { id: 'telehealth', name: 'Telehealth' }, { id: 'group', name: 'Group' }, { id: 'clinical_review', name: 'Clinical review' }]
                  ).map(m => (
                    <MenuItem key={m.id ?? m.name} value={m.name}>{m.name}</MenuItem>
                  ))}
                </TextField>
              )}
            />
          </Grid>
          <Grid>
            <Controller
              name="startTime"
              control={control}
              render={({ field }) => (
                <TextField
                  {...field}
                  type="datetime-local"
                  label="Start time"
                  InputLabelProps={{ shrink: true }}
                  error={Boolean(errors.startTime)}
                  helperText={errors.startTime?.message}
                />
              )}
            />
          </Grid>
          <Grid>
            <Controller
              name="endTime"
              control={control}
              render={({ field }) => (
                <TextField
                  {...field}
                  type="datetime-local"
                  label="End time"
                  InputLabelProps={{ shrink: true }}
                  error={Boolean(errors.endTime)}
                  helperText={errors.endTime?.message}
                />
              )}
            />
          </Grid>
          {isTelehealth ? (
            <Grid>
              <Controller
                name="telehealthDetails.telehealthLink"
                control={control}
                render={({ field }) => (
                  <TextField
                    {...field}
                    label="Telehealth link"
                    error={Boolean(errors.telehealthDetails?.telehealthLink)}
                    helperText={errors.telehealthDetails?.telehealthLink?.message}
                  />
                )}
              />
            </Grid>
          ) : null}
          <Grid>
            <Controller
              name="notes"
              control={control}
              render={({ field }) => (
                <TextField
                  {...field}
                  label="Appointment notes"
                  multiline
                  minRows={3}
                  error={Boolean(errors.notes)}
                  helperText={errors.notes?.message}
                />
              )}
            />
          </Grid>
          {/* Phase 13 PR5 — additional clinicians (co_clinicians).
              Comma- or whitespace-separated UUIDs. Each becomes an
              appointment_attendees row with role='co_clinician'. */}
          <Grid>
            <TextField
              fullWidth
              label="Additional clinicians (optional)"
              placeholder="staff UUIDs separated by spaces or commas"
              value={attendeesRaw}
              onChange={(e) => setAttendeesRaw(e.target.value)}
              error={attendeeIds.length > 0 && !attendeesValid}
              helperText={
                attendeeIds.length > 0 && !attendeesValid
                  ? 'One or more values is not a valid UUID'
                  : 'Each id becomes a co-clinician on the appointment. Overlap detection runs against every attendee.'
              }
            />
          </Grid>
        </Grid>

        {/* Recurrence */}
        <Box sx={{ pt: 1, borderTop: '1px solid #eee' }}>
          <FormControlLabel
            control={<Checkbox checked={recurring} onChange={(e) => setRecurring(e.target.checked)} />}
            label="Recurring"
          />
          {recurring && (
            <Stack spacing={1.5} sx={{ mt: 1 }}>
              <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5}>
                <TextField
                  select
                  size="small"
                  label="Recurrence"
                  value={recurrenceRule}
                  onChange={(e) => setRecurrenceRule(e.target.value as typeof recurrenceRule)}
                  sx={{ minWidth: 160 }}
                >
                  <MenuItem value="daily">Daily</MenuItem>
                  <MenuItem value="weekly">Weekly</MenuItem>
                  <MenuItem value="fortnightly">Fortnightly</MenuItem>
                  <MenuItem value="monthly">Monthly</MenuItem>
                </TextField>
                <TextField
                  size="small"
                  type="date"
                  label="End date"
                  InputLabelProps={{ shrink: true }}
                  value={recurrenceEndDate}
                  onChange={(e) => setRecurrenceEndDate(e.target.value)}
                />
              </Stack>
              {(recurrenceRule === 'weekly' || recurrenceRule === 'fortnightly') && (
                <Box>
                  <Typography variant="caption" color="text.secondary">
                    Days of the week (optional — defaults to the start-time weekday)
                  </Typography>
                  <FormGroup row>
                    {DOW_LABELS.map((label, idx) => (
                      <FormControlLabel
                        key={label}
                        control={<Checkbox size="small" checked={daysOfWeek.includes(idx)} onChange={() => toggleDay(idx)} />}
                        label={label}
                      />
                    ))}
                  </FormGroup>
                </Box>
              )}
            </Stack>
          )}
        </Box>

        <Stack direction="row" justifyContent="flex-end">
          <Button
            type="submit"
            variant="contained"
            disabled={isPending || recurringMut.isPending || (recurring && !recurrenceEndDate) || (attendeeIds.length > 0 && !attendeesValid)}
            sx={{ backgroundColor: '#327C8D', '&:hover': { backgroundColor: '#2a6977' } }}
          >
            {recurring ? 'Create recurring appointments' : 'Create appointment'}
          </Button>
        </Stack>
      </Stack>
    </Box>
  );
};
