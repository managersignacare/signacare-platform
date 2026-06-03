// apps/web/src/features/calendar/pages/CalendarPage.tsx
//
// Phase 13 PR3 — main calendar page for the logged-in clinician.
//
// Layout:
//   ┌─────────────────────────────────────────────┬─────────────────┐
//   │ Working week grid (paint blocks)             │ Today           │
//   │                                              │  - appointments │
//   │ Slot granularity selector                    │  - contacts     │
//   │                                              │  - DNAs         │
//   │ iCal subscribe card                          │                 │
//   └─────────────────────────────────────────────┴─────────────────┘
//
// Single page, no tabs — keeps the surface tight. The patient detail
// booking flow already covers per-patient appointment creation; this
// page is the clinician's calendar control surface, not a second
// booking dialog.

import React, { useState } from 'react';
import {
  Alert,
  Box,
  CircularProgress,
  Container,
  FormControl,
  InputLabel,
  MenuItem,
  Select,
  Stack,
  Typography,
} from '@mui/material';
import { useCurrentUser } from '../../auth/hooks/useCurrentUser';
import { useCalendarBlocks } from '../hooks/useCalendarBlocks';
import {
  useCalendarPreferences,
  useUpdateCalendarPreferences,
} from '../hooks/useCalendarPreferences';
import { useTodayView } from '../hooks/useTodayView';
import { AvailabilityGridEditor } from '../components/AvailabilityGridEditor';
import { TodayContactsView } from '../components/TodayContactsView';
import { ICalSubscribeCard } from '../components/ICalSubscribeCard';

const SLOT_OPTIONS = [15, 20, 30, 45, 60] as const;

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

const CalendarPage: React.FC = () => {
  const { data: me, isLoading: meLoading } = useCurrentUser();
  const blocks = useCalendarBlocks();
  const prefs = useCalendarPreferences();
  const updatePrefs = useUpdateCalendarPreferences();
  const [date, setDate] = useState<string>(todayIso());
  const today = useTodayView({ date });

  if (meLoading || !me) {
    return (
      <Box display="flex" justifyContent="center" mt={6}>
        <CircularProgress />
      </Box>
    );
  }

  const slotMinutes = prefs.data?.slotMinutes ?? 30;

  return (
    <Container maxWidth="xl" sx={{ py: 3 }}>
      <Stack direction="row" alignItems="center" mb={2} spacing={2}>
        <Typography variant="h5" sx={{ flex: 1 }}>
          My Calendar
        </Typography>
        <FormControl size="small" sx={{ minWidth: 140 }}>
          <InputLabel>Slot length</InputLabel>
          <Select
            value={slotMinutes}
            label="Slot length"
            onChange={(e) =>
              updatePrefs.mutate({
                slotMinutes: Number(e.target.value) as 15 | 20 | 30 | 45 | 60,
              })
            }
          >
            {SLOT_OPTIONS.map((opt) => (
              <MenuItem key={opt} value={opt}>
                {opt} min
              </MenuItem>
            ))}
          </Select>
        </FormControl>
        <input
          type="date"
          value={date}
          onChange={(e) => setDate(e.target.value)}
          style={{ padding: 6, fontSize: 14 }}
          aria-label="Selected date"
        />
      </Stack>

      {(blocks.error || prefs.error || today.error) && (
        <Alert severity="error" sx={{ mb: 2 }}>
          Failed to load calendar data. Try refreshing.
        </Alert>
      )}

      <Box
        sx={{
          display: 'grid',
          gridTemplateColumns: { xs: '1fr', lg: '2fr 1fr' },
          gap: 3,
        }}
      >
        <Box>
          {prefs.data && blocks.data ? (
            <Stack spacing={3}>
              <AvailabilityGridEditor
                blocks={blocks.data}
                preferences={prefs.data}
              />
              <ICalSubscribeCard />
            </Stack>
          ) : (
            <Box display="flex" justifyContent="center" py={6}>
              <CircularProgress />
            </Box>
          )}
        </Box>
        <Box>
          {today.data ? (
            <TodayContactsView data={today.data} />
          ) : (
            <Box display="flex" justifyContent="center" py={6}>
              <CircularProgress />
            </Box>
          )}
        </Box>
      </Box>
    </Container>
  );
};

export default CalendarPage;
