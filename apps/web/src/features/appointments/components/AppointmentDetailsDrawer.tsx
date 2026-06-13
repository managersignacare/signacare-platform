import CloseIcon from '@mui/icons-material/Close';
import EditIcon from '@mui/icons-material/Edit';
import EventBusyIcon from '@mui/icons-material/EventBusy';
import OpenInNewIcon from '@mui/icons-material/OpenInNew';
import {
  Alert,
  Box,
  Button,
  Chip,
  Divider,
  Drawer,
  IconButton,
  Link,
  Stack,
  Typography,
} from '@mui/material';
import { useQueryClient } from '@tanstack/react-query';
import React from 'react';
import type { AppointmentMode, AppointmentResponse, AppointmentStatus } from '@signacare/shared';
import { calendarKeys } from '../../calendar/queryKeys';
import { appointmentKeys } from '../queryKeys';
import { appointmentApi } from '../services/appointmentApi';
import { getAppointmentStatusMeta } from '../types/appointmentTypes';

const ALLOWED_STATUS_ACTIONS: Record<AppointmentStatus, AppointmentStatus[]> = {
  scheduled: ['confirmed', 'arrived', 'cancelled', 'no_show'],
  confirmed: ['arrived', 'cancelled', 'no_show'],
  arrived: ['in_session', 'cancelled', 'no_show'],
  in_session: ['completed', 'cancelled'],
  completed: [],
  cancelled: [],
  no_show: [],
  rescheduled: ['scheduled', 'confirmed'],
};

const STATUS_LABELS: Record<AppointmentStatus, string> = {
  scheduled: 'Mark scheduled',
  confirmed: 'Confirm',
  arrived: 'Mark arrived',
  in_session: 'Start session',
  completed: 'Complete',
  cancelled: 'Cancel',
  no_show: 'Mark no show',
  rescheduled: 'Rescheduled',
};

interface AppointmentDetailsDrawerProps {
  appointment: AppointmentResponse | null;
  onClose: () => void;
  onEdit: (appointment: AppointmentResponse) => void;
  open: boolean;
  staffNamesById?: Record<string, string>;
}

function formatMode(mode?: AppointmentMode | null, telehealthLink?: string | null): string {
  switch (mode) {
    case 'telehealth':
      return 'Telehealth';
    case 'videoconference':
      return 'Videoconference';
    case 'other':
      return 'Other';
    case 'direct':
      return 'Direct';
    default:
      return telehealthLink ? 'Videoconference' : 'Direct';
  }
}

function formatDateTimeRange(appointment: AppointmentResponse): string {
  const start = new Date(appointment.startTime);
  const end = new Date(appointment.endTime);
  return `${start.toLocaleDateString('en-AU', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  })} · ${start.toLocaleTimeString('en-AU', {
    hour: '2-digit',
    minute: '2-digit',
  })}–${end.toLocaleTimeString('en-AU', {
    hour: '2-digit',
    minute: '2-digit',
  })}`;
}

function formatParticipantList(appointment: AppointmentResponse): string {
  const names = appointment.attendeeStaffNames ?? [];
  if (!names.length) return 'None';
  return names.join(', ');
}

export function AppointmentDetailsDrawer({
  appointment,
  onClose,
  onEdit,
  open,
  staffNamesById = {},
}: AppointmentDetailsDrawerProps) {
  const queryClient = useQueryClient();
  const [savingStatus, setSavingStatus] = React.useState<AppointmentStatus | null>(null);
  const [statusError, setStatusError] = React.useState('');

  React.useEffect(() => {
    if (!open) {
      setSavingStatus(null);
      setStatusError('');
    }
  }, [open]);

  if (!appointment) {
    return null;
  }

  const statusMeta = getAppointmentStatusMeta(appointment.status);
  const availableActions = ALLOWED_STATUS_ACTIONS[appointment.status] ?? [];

  const invalidateQueries = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: appointmentKeys.all }),
      queryClient.invalidateQueries({ queryKey: calendarKeys.all }),
      queryClient.invalidateQueries({ queryKey: ['patient-appointments', appointment.patientId] }),
      queryClient.invalidateQueries({ queryKey: ['appointments', appointment.patientId] }),
    ]);
  };

  const handleStatusAction = async (nextStatus: AppointmentStatus) => {
    setSavingStatus(nextStatus);
    setStatusError('');
    try {
      await appointmentApi.updateStatus(appointment.id, nextStatus);
      await invalidateQueries();
      onClose();
    } catch (error) {
      setStatusError(error instanceof Error ? error.message : 'Failed to update appointment status.');
    } finally {
      setSavingStatus(null);
    }
  };

  const primaryClinicianLabel = staffNamesById[appointment.clinicianId] ?? appointment.clinicianId;

  return (
    <Drawer
      anchor="right"
      open={open}
      onClose={onClose}
      PaperProps={{ sx: { width: { xs: '100%', sm: 440 } } }}
    >
      <Stack sx={{ height: '100%' }}>
        <Stack direction="row" alignItems="center" spacing={1} sx={{ px: 2, py: 1.5 }}>
          <Box sx={{ flex: 1 }}>
            <Typography variant="overline" color="text.secondary">
              Appointment
            </Typography>
            <Typography variant="h6" fontWeight={700}>
              {appointment.type.replace(/_/g, ' ')}
            </Typography>
          </Box>
          <IconButton aria-label="Close appointment details" onClick={onClose}>
            <CloseIcon />
          </IconButton>
        </Stack>
        <Divider />

        <Stack spacing={2} sx={{ p: 2, overflowY: 'auto', flex: 1 }}>
          <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap>
            <Chip label={statusMeta.label} color={statusMeta.color} />
            <Chip label={formatMode(appointment.mode, appointment.telehealthLink)} variant="outlined" />
            {appointment.teamName ? <Chip label={appointment.teamName} variant="outlined" /> : null}
          </Stack>

          <Box>
            <Typography variant="subtitle2" gutterBottom>Date & time</Typography>
            <Typography variant="body2" color="text.secondary">
              {formatDateTimeRange(appointment)}
            </Typography>
          </Box>

          <Box>
            <Typography variant="subtitle2" gutterBottom>Assignment</Typography>
            <Typography variant="body2" color="text.secondary">
              Primary clinician: {primaryClinicianLabel}
            </Typography>
            <Typography variant="body2" color="text.secondary">
              Additional clinicians: {formatParticipantList(appointment)}
            </Typography>
            {appointment.specialtyCode ? (
              <Typography variant="body2" color="text.secondary">
                Specialty: {appointment.specialtyCode}
              </Typography>
            ) : null}
          </Box>

          {appointment.telehealthLink ? (
            <Box>
              <Typography variant="subtitle2" gutterBottom>Telehealth</Typography>
              <Link href={appointment.telehealthLink} target="_blank" rel="noreferrer" underline="hover">
                Open meeting link
              </Link>
              {appointment.telehealthProvider ? (
                <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
                  Provider: {appointment.telehealthProvider}
                </Typography>
              ) : null}
            </Box>
          ) : null}

          <Box>
            <Typography variant="subtitle2" gutterBottom>Patient & episode</Typography>
            <Typography variant="body2" color="text.secondary">
              Patient ID: {appointment.patientId}
            </Typography>
            <Typography variant="body2" color="text.secondary">
              Episode ID: {appointment.episodeId ?? 'Not linked'}
            </Typography>
          </Box>

          <Box>
            <Typography variant="subtitle2" gutterBottom>Notes</Typography>
            <Typography variant="body2" color="text.secondary">
              {appointment.notes?.trim() || 'No appointment notes recorded.'}
            </Typography>
          </Box>

          <Box>
            <Typography variant="subtitle2" gutterBottom>Sync & reminders</Typography>
            <Typography variant="body2" color="text.secondary">
              Reminder scheduled: {appointment.reminderScheduled ? 'Yes' : 'No'}
            </Typography>
            <Typography variant="body2" color="text.secondary">
              Reminder sent: {appointment.reminderSent ? 'Yes' : 'No'}
            </Typography>
            <Typography variant="body2" color="text.secondary">
              Outlook sync: {appointment.outlookEventId ? 'Linked' : 'Not linked'}
            </Typography>
          </Box>

          {statusError ? <Alert severity="error">{statusError}</Alert> : null}

          <Stack spacing={1}>
            <Button
              variant="contained"
              startIcon={<EditIcon />}
              onClick={() => onEdit(appointment)}
              sx={{ bgcolor: '#b8621a', '&:hover': { bgcolor: '#d6741f' } }}
            >
              Edit details or reschedule
            </Button>
            {appointment.telehealthLink ? (
              <Button
                variant="outlined"
                startIcon={<OpenInNewIcon />}
                component="a"
                href={appointment.telehealthLink}
                target="_blank"
                rel="noreferrer"
              >
                Launch telehealth
              </Button>
            ) : null}
          </Stack>

          {availableActions.length ? (
            <Box>
              <Typography variant="subtitle2" gutterBottom>Workflow actions</Typography>
              <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
                {availableActions.map((nextStatus) => (
                  <Button
                    key={nextStatus}
                    variant={nextStatus === 'cancelled' || nextStatus === 'no_show' ? 'outlined' : 'contained'}
                    color={nextStatus === 'cancelled' || nextStatus === 'no_show' ? 'inherit' : 'primary'}
                    startIcon={nextStatus === 'cancelled' ? <EventBusyIcon /> : undefined}
                    disabled={Boolean(savingStatus)}
                    onClick={() => void handleStatusAction(nextStatus)}
                  >
                    {savingStatus === nextStatus ? 'Saving…' : STATUS_LABELS[nextStatus]}
                  </Button>
                ))}
              </Stack>
            </Box>
          ) : null}
        </Stack>
      </Stack>
    </Drawer>
  );
}
