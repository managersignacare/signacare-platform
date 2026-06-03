// apps/web/src/features/appointments/components/AppointmentCard.tsx
import { Alert, Button, Card, CardContent, Chip, Divider, Link, Stack, Typography } from '@mui/material';
import VideocamIcon from '@mui/icons-material/Videocam';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import React from 'react';
import { apiClient } from '../../../shared/services/apiClient';
import { appointmentKeys } from '../queryKeys';
import type { Appointment } from '../types/appointmentTypes';
import { getAppointmentStatusMeta } from '../types/appointmentTypes';

interface Props {
  appointment: Appointment;
}

export const AppointmentCard = ({ appointment }: Props) => {
  const meta = getAppointmentStatusMeta(appointment.status);
  const qc = useQueryClient();
  const [localLink, setLocalLink] = React.useState<string | null>(
    appointment.telehealthLink ?? null,
  );

  // Generate a Jitsi room for this appointment. Idempotent server-
  // side — re-calling returns the existing URL so a second click
  // drops the clinician into the same room as the first.
  const generateMut = useMutation({
    mutationFn: () =>
      apiClient.post<{ url: string; created: boolean }>(
        `telehealth/appointments/${appointment.id}/room`,
        {},
      ),
    onSuccess: (data) => {
      setLocalLink(data.url);
      qc.invalidateQueries({ queryKey: appointmentKeys.all });
      window.open(data.url, '_blank', 'noreferrer');
    },
  });

  return (
    <Card variant="outlined" sx={{ borderRadius: 3 }}>
      <CardContent>
        <Stack direction="row" justifyContent="space-between" alignItems="flex-start" mb={2}>
          <Stack spacing={0.5}>
            <Typography variant="h6">{appointment.type}</Typography>
            <Typography variant="body2" color="text.secondary">
              Patient {appointment.patientId}
            </Typography>
          </Stack>
          <Chip size="small" label={meta.label} color={meta.color} />
        </Stack>
        <Divider sx={{ mb: 2 }} />
        <Stack spacing={1}>
          <Typography>
            {new Date(appointment.startTime).toLocaleString()} –{' '}
            {new Date(appointment.endTime).toLocaleTimeString()}
          </Typography>
          <Typography color="text.secondary">
            Clinician {appointment.clinicianId}
          </Typography>
          <Typography color="text.secondary">
            Location {appointment.notes ?? 'Not specified'}
          </Typography>

          {/* Telehealth — join existing room or generate one on demand. */}
          {localLink ? (
            <Stack direction="row" spacing={1} alignItems="center">
              <Button
                variant="contained"
                color="primary"
                size="small"
                startIcon={<VideocamIcon />}
                href={localLink}
                target="_blank"
                rel="noreferrer"
              >
                Join video call
              </Button>
              <Link href={localLink} target="_blank" rel="noreferrer" variant="body2">
                Open link
              </Link>
            </Stack>
          ) : (
            <Button
              variant="outlined"
              color="primary"
              size="small"
              startIcon={<VideocamIcon />}
              disabled={generateMut.isPending}
              onClick={() => generateMut.mutate()}
            >
              {generateMut.isPending ? 'Creating room…' : 'Start video call'}
            </Button>
          )}
          {generateMut.isError && (
            <Alert severity="error">
              Could not create the video room:{' '}
              {generateMut.error instanceof Error ? generateMut.error.message : String(generateMut.error)}
            </Alert>
          )}

          {appointment.notes ? <Typography>{appointment.notes}</Typography> : null}
        </Stack>
      </CardContent>
    </Card>
  );
};