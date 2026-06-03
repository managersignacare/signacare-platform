// apps/web/src/features/appointments/components/WaitlistPanel.tsx
import { Alert, CircularProgress, List, ListItem, ListItemText, Paper, Typography } from '@mui/material';
import { useAppointments } from '../hooks/useAppointments';

export const WaitlistPanel = () => {
  const { data, isLoading, isError, error } = useAppointments({ status: 'waitlisted' });

  if (isLoading) return <CircularProgress role="progressbar" aria-label="Loading" />;
  if (isError)
    return (
      <Alert role="alert" severity="error">
        {error instanceof Error ? error.message : 'Failed to load waitlist.'}
      </Alert>
    );
  if (!data || data.length === 0)
    return <Alert severity="info">No patients are currently on the waitlist.</Alert>;

  return (
    <Paper variant="outlined" sx={{ borderRadius: 3 }}>
      <List>
        {data.map((appointment, index) => (
          <ListItem
            key={appointment.id}
            divider={index !== data.length - 1}
          >
            <ListItemText
              primary={`Patient ${appointment.patientId}`}
              secondary={
                <Typography component="span" variant="body2">
                  {appointment.type}
                </Typography>
              }
            />
          </ListItem>
        ))}
      </List>
    </Paper>
  );
};