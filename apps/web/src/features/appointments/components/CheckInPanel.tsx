// apps/web/src/features/appointments/components/CheckInPanel.tsx
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Alert, Box, Button, Stack, TextField, Typography } from '@mui/material';
import { useState } from 'react';
import { appointmentApi } from '../services/appointmentApi';
import { appointmentQueryKeys } from '../hooks/useAppointments';
import type { Appointment, AppointmentStatus } from '../types/appointmentTypes';

interface Props {
  appointment: Appointment;
}

const transitions: AppointmentStatus[] = [
  'confirmed',
  'arrived',
  'in_session',
  'completed',
  'no_show',
];

export const CheckInPanel = ({ appointment }: Props) => {
  const [notes, setNotes] = useState('');
  const queryClient = useQueryClient();

  const mutation = useMutation({
    mutationFn: (status: AppointmentStatus) =>
      appointmentApi.updateStatus(appointment.id, status, notes),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: appointmentQueryKeys.all });
    },
  });

  return (
    <Box>
      <Typography variant="h6" mb={1.5}>
        Check-in workflow
      </Typography>
      {mutation.isError ? (
        <Alert role="alert" severity="error" sx={{ mb: 2 }}>
          {mutation.error instanceof Error
            ? mutation.error.message
            : 'Failed to update appointment status.'}
        </Alert>
      ) : null}
      <TextField
        label="Check-in notes"
        multiline
        minRows={3}
        value={notes}
        onChange={(event) => setNotes(event.target.value)}
        sx={{ mb: 2 }}
      />
      <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
        {transitions.map((status) => (
          <Button
            key={status}
            variant={appointment.status === status ? 'contained' : 'outlined'}
            disabled={mutation.isPending}
            onClick={() => mutation.mutate(status)}
          >
            {status}
          </Button>
        ))}
      </Stack>
    </Box>
  );
};