// apps/web/src/features/calendar/components/ICalSubscribeCard.tsx
//
// Phase 13 PR3 — surfaces the per-clinician iCal subscription URL,
// a copy-to-clipboard button, and a hard-rotate action that
// invalidates the previous URL immediately. The rotate action is
// behind a confirmation dialog because every subscriber currently
// using the old URL will start 401'ing within seconds.

import React, { useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Dialog,
  DialogActions,
  DialogContent,
  DialogContentText,
  DialogTitle,
  IconButton,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import RefreshIcon from '@mui/icons-material/Refresh';
import { useQuery } from '@tanstack/react-query';
import { calendarApi, type CalendarSubscriptionInfo } from '../services/calendarApi';
import { calendarKeys } from '../queryKeys';
import { useRotateIcalToken } from '../hooks/useCalendarPreferences';

interface ICalSubscribeCardProps {
  onRefreshCalendar?: () => void;
}

export const ICalSubscribeCard: React.FC<ICalSubscribeCardProps> = ({
  onRefreshCalendar,
}) => {
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const rotate = useRotateIcalToken();

  const sub = useQuery<CalendarSubscriptionInfo>({
    queryKey: calendarKeys.ical(),
    queryFn: () => calendarApi.getIcalSubscriptionUrl(),
    staleTime: 5 * 60_000,
  });

  const url = sub.data?.url ?? '';

  const copy = async () => {
    if (!url) return;
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* ignore */
    }
  };

  return (
    <Card variant="outlined">
      <CardContent>
        <Typography variant="subtitle1" gutterBottom>
          External Calendar Sync
        </Typography>
        <Typography variant="body2" color="text.secondary" mb={2}>
          Sync setup starts here. Add this URL to Outlook, Google Calendar, or Apple
          Calendar to see your Signacare appointments and time blocks in the same place.
        </Typography>

        <Stack direction="row" spacing={1} alignItems="center">
          <TextField
            value={url}
            fullWidth
            size="small"
            InputProps={{ readOnly: true }}
            placeholder={sub.isLoading ? 'Loading…' : ''}
          />
          <IconButton aria-label="Copy URL" onClick={copy} disabled={!url}>
            <ContentCopyIcon />
          </IconButton>
        </Stack>
        {copied && (
          <Alert severity="success" sx={{ mt: 1 }}>
            Copied to clipboard
          </Alert>
        )}

        <Box mt={2}>
          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1}>
            <Button
              size="small"
              variant="outlined"
              startIcon={<RefreshIcon />}
              onClick={() => {
                void sub.refetch();
                onRefreshCalendar?.();
              }}
            >
              Refresh sync status
            </Button>
            <Button
              size="small"
              color="warning"
              startIcon={<RefreshIcon />}
              onClick={() => setConfirmOpen(true)}
            >
              Rotate token
            </Button>
          </Stack>
        </Box>
      </CardContent>

      <Dialog open={confirmOpen} onClose={() => setConfirmOpen(false)}>
        <DialogTitle>Rotate iCal token?</DialogTitle>
        <DialogContent>
          <DialogContentText>
            Anyone currently subscribed to your old URL will stop receiving
            updates within seconds. You will need to copy the new URL and
            re-add it to your calendar app.
          </DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setConfirmOpen(false)}>Cancel</Button>
          <Button
            color="warning"
            variant="contained"
            disabled={rotate.isPending}
            onClick={async () => {
              await rotate.mutateAsync();
              setConfirmOpen(false);
            }}
          >
            Rotate
          </Button>
        </DialogActions>
      </Dialog>
    </Card>
  );
};
