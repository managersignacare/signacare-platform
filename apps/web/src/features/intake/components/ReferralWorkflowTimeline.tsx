import {
  Alert,
  CircularProgress,
  List,
  ListItem,
  ListItemText,
  Paper,
  Stack,
  Typography,
} from '@mui/material';
import { useReferralWorkflowEvents } from '../hooks/useReferral';

interface Props {
  referralId: string;
}

export const ReferralWorkflowTimeline = ({ referralId }: Props) => {
  const { data, isLoading, isError, error } = useReferralWorkflowEvents(referralId);

  if (isLoading) {
    return <CircularProgress role="progressbar" aria-label="Loading" size={24} />;
  }

  if (isError) {
    return <Alert role="alert" severity="error">{error instanceof Error ? error.message : 'Failed to load workflow.'}</Alert>;
  }

  if (!data || data.length === 0) {
    return <Alert severity="info">No workflow events recorded yet.</Alert>;
  }

  return (
    <Paper variant="outlined" sx={{ borderRadius: 3 }}>
      <List>
        {data.map((event, index) => (
          <ListItem
            key={event.id}
            divider={index !== data.length - 1}
            alignItems="flex-start"
            sx={{ py: 1.5 }}
          >
            <ListItemText
              primary={
                <Stack direction="row" justifyContent="space-between" spacing={2}>
                  <Typography fontWeight={700}>{event.eventType}</Typography>
                  <Typography variant="body2" color="text.secondary">
                    {new Date(event.createdAt).toLocaleString()}
                  </Typography>
                </Stack>
              }
              secondary={
                <Stack spacing={0.5} mt={0.5}>
                  <Typography variant="body2" color="text.secondary">
                    By {event.createdByStaffName || 'System'}
                  </Typography>
                  {event.notes ? <Typography variant="body2">{event.notes}</Typography> : null}
                </Stack>
              }
            />
          </ListItem>
        ))}
      </List>
    </Paper>
  );
};
