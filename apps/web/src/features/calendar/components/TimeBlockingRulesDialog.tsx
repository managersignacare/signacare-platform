import React from 'react';
import {
  Alert,
  Dialog,
  DialogContent,
  DialogTitle,
  Stack,
  Typography,
} from '@mui/material';
import type {
  AvailabilityBlock,
  CalendarPreferences,
} from '@signacare/shared';
import { AvailabilityGridEditor } from './AvailabilityGridEditor';

interface TimeBlockingRulesDialogProps {
  blocks: AvailabilityBlock[] | undefined;
  open: boolean;
  preferences: CalendarPreferences | undefined;
  onClose: () => void;
}

export function TimeBlockingRulesDialog({
  blocks,
  open,
  preferences,
  onClose,
}: TimeBlockingRulesDialogProps): React.ReactElement {
  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="lg">
      <DialogTitle>Manage time blocking</DialogTitle>
      <DialogContent dividers>
        {preferences && blocks ? (
          <Stack spacing={1.5}>
            <Typography variant="body2" color="text.secondary">
              These rules drive the coloured availability overlays in the main calendar, so booked work and protected time remain in one live scheduling surface.
            </Typography>
            <AvailabilityGridEditor blocks={blocks} preferences={preferences} />
          </Stack>
        ) : (
          <Alert severity="warning">
            Time blocking is temporarily unavailable. Refresh to retry.
          </Alert>
        )}
      </DialogContent>
    </Dialog>
  );
}
