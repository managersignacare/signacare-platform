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
  Paper,
  Select,
  Stack,
  ToggleButton,
  ToggleButtonGroup,
  Typography,
} from '@mui/material';
import { useQuery } from '@tanstack/react-query';
import { useCurrentUser } from '../../auth/hooks/useCurrentUser';
import { AppointmentCalendar } from '../../appointments/components/AppointmentCalendar';
import { appointmentApi } from '../../appointments/services/appointmentApi';
import { appointmentKeys } from '../../appointments/queryKeys';
import { useCalendarBlocks } from '../hooks/useCalendarBlocks';
import {
  useCalendarPreferences,
  useUpdateCalendarPreferences,
} from '../hooks/useCalendarPreferences';
import { useTodayView } from '../hooks/useTodayView';
import { AvailabilityGridEditor } from '../components/AvailabilityGridEditor';
import { TodayContactsView } from '../components/TodayContactsView';
import { ICalSubscribeCard } from '../components/ICalSubscribeCard';
import { staffSettingsApi } from '../../staff-settings/services/staffSettingsApi';
import { staffSettingsKeys } from '../../staff-settings/queryKeys';

const SLOT_OPTIONS = [15, 20, 30, 45, 60] as const;

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

function monthBounds(isoDate: string): { from: string; to: string; monthDate: Date } {
  const monthDate = new Date(`${isoDate}T00:00:00`);
  const first = new Date(monthDate.getFullYear(), monthDate.getMonth(), 1);
  const last = new Date(monthDate.getFullYear(), monthDate.getMonth() + 1, 0);
  const toIso = (value: Date) => value.toISOString().slice(0, 10);
  return { from: toIso(first), to: toIso(last), monthDate };
}

const CalendarPage: React.FC = () => {
  const { data: me, isLoading: meLoading } = useCurrentUser();
  const blocks = useCalendarBlocks();
  const prefs = useCalendarPreferences();
  const updatePrefs = useUpdateCalendarPreferences();
  const [date, setDate] = useState<string>(todayIso());
  const [scope, setScope] = useState<'mine' | 'team'>('mine');
  const today = useTodayView({ date });
  const { from, to, monthDate } = monthBounds(date);

  const teamAssignments = useQuery({
    queryKey: staffSettingsKeys.teamAssignments(me?.id),
    queryFn: () => staffSettingsApi.getTeamAssignments(me?.id),
    enabled: Boolean(me?.id),
    staleTime: 60_000,
  });
  const activeTeams = (teamAssignments.data ?? []).filter((assignment) => assignment.isActive);
  const [selectedTeamId, setSelectedTeamId] = useState<string>('');

  const myMonthlyAppointments = useQuery({
    queryKey: appointmentKeys.list({ clinicianId: me?.id, from, to, limit: '200' }),
    queryFn: () =>
      appointmentApi.list({
        clinicianId: me?.id,
        from: `${from}T00:00:00.000Z`,
        to: `${to}T23:59:59.999Z`,
        limit: '200',
      }),
    enabled: Boolean(me?.id),
    staleTime: 30_000,
  });

  const clinicMonthlyAppointments = useQuery({
    queryKey: appointmentKeys.list({ from, to, limit: '200', offset: '0' }),
    queryFn: () =>
      appointmentApi.list({
        from: `${from}T00:00:00.000Z`,
        to: `${to}T23:59:59.999Z`,
        limit: '200',
        offset: '0',
      }),
    enabled: scope === 'team',
    staleTime: 30_000,
  });

  const displayedAppointments = scope === 'mine'
    ? (myMonthlyAppointments.data ?? [])
    : (clinicMonthlyAppointments.data ?? []).filter((appointment) => {
      const effectiveTeamId = selectedTeamId || activeTeams[0]?.orgUnitId;
      return effectiveTeamId ? appointment.teamId === effectiveTeamId : false;
    });

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
              <Paper variant="outlined" sx={{ p: 2.5, borderRadius: 2 }}>
                <Stack spacing={2}>
                  <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5} alignItems={{ xs: 'flex-start', sm: 'center' }}>
                    <Typography variant="h6" sx={{ flex: 1 }}>
                      Scheduled Appointments
                    </Typography>
                    <ToggleButtonGroup
                      size="small"
                      exclusive
                      value={scope}
                      onChange={(_, value: 'mine' | 'team' | null) => {
                        if (value) setScope(value);
                      }}
                    >
                      <ToggleButton value="mine">Mine</ToggleButton>
                      <ToggleButton value="team">My Team</ToggleButton>
                    </ToggleButtonGroup>
                    {scope === 'team' ? (
                      <FormControl size="small" sx={{ minWidth: 220 }}>
                        <InputLabel>Team</InputLabel>
                        <Select
                          value={selectedTeamId || activeTeams[0]?.orgUnitId || ''}
                          label="Team"
                          onChange={(e) => setSelectedTeamId(String(e.target.value))}
                        >
                          {activeTeams.map((assignment) => (
                            <MenuItem key={assignment.id} value={assignment.orgUnitId}>
                              {assignment.orgUnitName}
                            </MenuItem>
                          ))}
                        </Select>
                      </FormControl>
                    ) : null}
                  </Stack>
                  {(scope === 'mine' ? myMonthlyAppointments.isLoading : clinicMonthlyAppointments.isLoading) ? (
                    <Box display="flex" justifyContent="center" py={4}>
                      <CircularProgress />
                    </Box>
                  ) : (
                    <AppointmentCalendar
                      appointments={displayedAppointments}
                      month={monthDate}
                    />
                  )}
                </Stack>
              </Paper>
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
