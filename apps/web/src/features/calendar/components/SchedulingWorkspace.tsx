import AddIcon from '@mui/icons-material/Add';
import CalendarMonthIcon from '@mui/icons-material/CalendarMonth';
import ChevronLeftIcon from '@mui/icons-material/ChevronLeft';
import ChevronRightIcon from '@mui/icons-material/ChevronRight';
import RefreshIcon from '@mui/icons-material/Refresh';
import TodayIcon from '@mui/icons-material/Today';
import ViewDayIcon from '@mui/icons-material/ViewDay';
import ViewListIcon from '@mui/icons-material/ViewList';
import ViewWeekIcon from '@mui/icons-material/ViewWeek';
import {
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
  Container,
  FormControl,
  InputLabel,
  MenuItem,
  Paper,
  Select,
  Stack,
  Tab,
  Tabs,
  TextField,
  ToggleButton,
  ToggleButtonGroup,
  Tooltip,
  Typography,
} from '@mui/material';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ALL_SPECIALTIES,
  SPECIALTY_DISPLAY,
  type AppointmentStatus,
  type AppointmentResponse,
  type SpecialtyType,
} from '@signacare/shared';
import React from 'react';
import { useCurrentUser } from '../../auth/hooks/useCurrentUser';
import { apiClient } from '../../../shared/services/apiClient';
import { PatientSearchAutocomplete, type PatientOption } from '../../patients/components/PatientSearchAutocomplete';
import { patientAppointmentsKeys, patientsKeys } from '../../patients/queryKeys';
import { useOrgTree } from '../../org-settings/hooks/useOrgSettings';
import type { OrgUnit } from '../../org-settings/services/orgSettingsApi';
import { staffSettingsApi } from '../../staff-settings/services/staffSettingsApi';
import { staffSettingsKeys } from '../../staff-settings/queryKeys';
import { SchedulingAppointmentDialog } from '../../appointments/components/SchedulingAppointmentDialog';
import { AppointmentDetailsDrawer } from '../../appointments/components/AppointmentDetailsDrawer';
import { appointmentKeys } from '../../appointments/queryKeys';
import { appointmentApi } from '../../appointments/services/appointmentApi';
import { AppointmentCalendar } from '../../appointments/components/AppointmentCalendar';
import { calendarKeys } from '../queryKeys';
import { calendarApi } from '../services/calendarApi';
import {
  useCalendarPreferences,
  useUpdateCalendarPreferences,
} from '../hooks/useCalendarPreferences';
import { useCalendarBlocks } from '../hooks/useCalendarBlocks';
import { useTodayView } from '../hooks/useTodayView';
import { TimeBlockingRulesDialog } from './TimeBlockingRulesDialog';
import { ICalSubscribeCard } from './ICalSubscribeCard';
import {
  getAvailabilitySummaryForDate,
  matchesSchedulingSearch,
} from './schedulingWorkspaceSupport';
import {
  appointmentModeLabel,
  buildRescheduledTimes,
  DayWeekGrid,
  type DragSlot,
  ListView,
  type AppointmentSummary,
} from './SchedulingWorkspaceCalendarViews';
import { TodayContactsView } from './TodayContactsView';

type CalendarScope = 'mine' | 'team' | 'clinic';
type CalendarView = 'month' | 'day' | 'workweek' | 'week' | 'list';
type WorkspaceTab = 'calendar' | 'contacts' | 'dna';
interface StaffLookupRow {
  id: string;
  givenName: string;
  familyName: string;
}
interface SchedulingWorkspaceProps {
  routeLabel?: string;
}
interface AppointmentDraftSeed {
  date?: string;
  duration?: number;
  startTime?: string;
}

const SLOT_OPTIONS = [15, 20, 30, 45, 60] as const;
const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'];
const ALLDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const APPOINTMENT_STATUS_OPTIONS: AppointmentStatus[] = [
  'scheduled',
  'confirmed',
  'arrived',
  'in_session',
  'completed',
  'cancelled',
  'no_show',
  'rescheduled',
];

const APPOINTMENT_TYPE_LABELS: Record<string, string> = {
  assessment: 'Assessment',
  clinical_review: 'Psychiatrist Review',
  follow_up: 'Follow-up',
  group: 'Group Session',
  initial: 'Initial Assessment',
  telehealth: 'Telehealth',
};

function flattenUnits(nodes: OrgUnit[]): { id: string; name: string }[] {
  const rows: { id: string; name: string }[] = [];

  function walk(branches: OrgUnit[], depth: number) {
    for (const branch of branches) {
      rows.push({
        id: branch.id,
        name: '\u00A0'.repeat(depth * 2) + branch.name,
      });
      if (branch.children?.length) {
        walk(branch.children, depth + 1);
      }
    }
  }

  walk(nodes, 0);
  return rows;
}

function monthBounds(isoDate: string): { from: string; monthDate: Date; to: string } {
  const monthDate = new Date(`${isoDate}T00:00:00`);
  const first = new Date(monthDate.getFullYear(), monthDate.getMonth(), 1);
  const last = new Date(monthDate.getFullYear(), monthDate.getMonth() + 1, 0);
  const toIso = (value: Date) => value.toISOString().slice(0, 10);
  return { from: toIso(first), to: toIso(last), monthDate };
}

function rangeBounds(view: CalendarView, currentDate: Date): { from: string; monthDate: Date; to: string } {
  if (view === 'month') {
    return monthBounds(currentDate.toISOString().slice(0, 10));
  }

  if (view === 'day' || view === 'list') {
    const iso = currentDate.toISOString().slice(0, 10);
    return { from: iso, to: iso, monthDate: new Date(currentDate.getFullYear(), currentDate.getMonth(), 1) };
  }

  const dates = getWeekDates(currentDate, view === 'week');
  return {
    from: dates[0].toISOString().slice(0, 10),
    to: dates[dates.length - 1].toISOString().slice(0, 10),
    monthDate: new Date(currentDate.getFullYear(), currentDate.getMonth(), 1),
  };
}

function getWeekDates(date: Date, includeWeekend: boolean): Date[] {
  const value = new Date(date);
  const day = value.getDay();
  const diff = value.getDate() - day + (day === 0 ? -6 : 1);
  const monday = new Date(value.setDate(diff));
  return Array.from({ length: includeWeekend ? 7 : 5 }, (_, index) => {
    const next = new Date(monday);
    next.setDate(monday.getDate() + index);
    return next;
  });
}

function formatRangeDate(date: Date): string {
  return date.toLocaleDateString('en-AU', { day: '2-digit', month: 'short' });
}


export function SchedulingWorkspace({
  routeLabel = 'My Calendar',
}: SchedulingWorkspaceProps) {
  const queryClient = useQueryClient();
  const { data: me, isLoading: meLoading } = useCurrentUser();
  const { data: tree } = useOrgTree();
  const { data: staffList = [] } = useQuery({
    queryKey: appointmentKeys.staffLookup(),
    queryFn: () => apiClient.get<StaffLookupRow[]>('staff/lookup'),
    staleTime: 5 * 60_000,
  });
  const flatUnits = React.useMemo(() => (tree ? flattenUnits(tree) : []), [tree]);
  const staffNamesById = React.useMemo(
    () =>
      Object.fromEntries(
        staffList.map((staff: StaffLookupRow) => [staff.id, `${staff.givenName} ${staff.familyName}`]),
      ),
    [staffList],
  );

  const [view, setView] = React.useState<CalendarView>('workweek');
  const [workspaceTab, setWorkspaceTab] = React.useState<WorkspaceTab>('calendar');
  const [currentDate, setCurrentDate] = React.useState(new Date());
  const [scope, setScope] = React.useState<CalendarScope>('mine');
  const [teamFilter, setTeamFilter] = React.useState('');
  const [clinicianFilter, setClinicianFilter] = React.useState('');
  const [specialtyFilter, setSpecialtyFilter] = React.useState<SpecialtyType | ''>('');
  const [statusFilter, setStatusFilter] = React.useState<AppointmentStatus | ''>('');
  const [searchTerm, setSearchTerm] = React.useState('');
  const [patientFilter, setPatientFilter] = React.useState<PatientOption | null>(null);
  const [dialogOpen, setDialogOpen] = React.useState(false);
  const [dialogSeed, setDialogSeed] = React.useState<AppointmentDraftSeed | null>(null);
  const [drawerOpen, setDrawerOpen] = React.useState(false);
  const [editingAppointment, setEditingAppointment] = React.useState<AppointmentResponse | null>(null);
  const [selectedAppointment, setSelectedAppointment] = React.useState<AppointmentResponse | null>(null);
  const [draggingAppointmentId, setDraggingAppointmentId] = React.useState<string | null>(null);
  const [dropTargetSlot, setDropTargetSlot] = React.useState<DragSlot | null>(null);
  const [rescheduleError, setRescheduleError] = React.useState('');
  const [reschedulingAppointmentId, setReschedulingAppointmentId] = React.useState<string | null>(null);
  const [timeBlockingDialogOpen, setTimeBlockingDialogOpen] = React.useState(false);
  const syncCardRef = React.useRef<HTMLDivElement | null>(null);

  const prefs = useCalendarPreferences();
  const updatePrefs = useUpdateCalendarPreferences();
  const blocks = useCalendarBlocks();
  const todayDate = currentDate.toISOString().slice(0, 10);
  const todayScopeRequiresClinicianSelection = scope !== 'mine' && !clinicianFilter;
  const todayClinicianId = scope === 'mine'
    ? me?.id
    : clinicianFilter || undefined;
  const today = useTodayView({
    clinicianId: todayClinicianId,
    date: todayDate,
    enabled: !todayScopeRequiresClinicianSelection,
  });
  const { from, monthDate, to } = React.useMemo(() => rangeBounds(view, currentDate), [currentDate, view]);

  const teamAssignments = useQuery({
    queryKey: staffSettingsKeys.teamAssignments(me?.id),
    queryFn: () => staffSettingsApi.getTeamAssignments(me?.id),
    enabled: Boolean(me?.id),
    staleTime: 60_000,
  });
  const activeTeams = React.useMemo(
    () => (teamAssignments.data ?? []).filter((assignment) => assignment.isActive),
    [teamAssignments.data],
  );

  const appointmentsQuery = useQuery({
    queryKey: calendarKeys.appointments({
      from,
      patientId: patientFilter?.id ?? '',
      to,
      limit: '300',
    }),
    queryFn: () =>
      calendarApi
        .listAppointments({
          from: `${from}T00:00:00.000Z`,
          limit: '300',
          patientId: patientFilter?.id ?? undefined,
          to: `${to}T23:59:59.999Z`,
        })
        .then((response) => response.appointments),
    enabled: Boolean(me?.id),
    staleTime: 30_000,
  });

  const scopeTeamId = teamFilter || activeTeams[0]?.orgUnitId || '';

  const summaries = React.useMemo<AppointmentSummary[]>(() => {
    return (appointmentsQuery.data ?? []).map((appointment) => {
      const start = new Date(appointment.startTime);
      const end = new Date(appointment.endTime);
      const clinician = staffList.find((staff: StaffLookupRow) => staff.id === appointment.clinicianId);
      return {
        clinicianId: appointment.clinicianId,
        clinicianName: clinician ? `${clinician.givenName} ${clinician.familyName}` : appointment.clinicianId,
        date: appointment.startTime.slice(0, 10),
        endTimeLabel: end.toLocaleTimeString('en-AU', { hour: '2-digit', minute: '2-digit', hour12: false }),
        modeLabel: appointmentModeLabel(appointment.mode, appointment.telehealthLink),
        raw: appointment,
        startHour: start.getHours(),
        startTimeLabel: start.toLocaleTimeString('en-AU', { hour: '2-digit', minute: '2-digit', hour12: false }),
        teamId: appointment.teamId ?? null,
        teamName: appointment.teamName ?? '',
        title: APPOINTMENT_TYPE_LABELS[appointment.type] ?? appointment.type,
      };
    });
  }, [appointmentsQuery.data, staffList]);

  const filteredAppointments = React.useMemo(() => {
    return summaries.filter((appointment) => {
      if (!me?.id) return false;

      if (scope === 'mine') {
        const attendeeIds = appointment.raw.attendeeStaffIds ?? [];
        if (appointment.clinicianId !== me.id && !attendeeIds.includes(me.id)) {
          return false;
        }
      }

      if (scope === 'team' && scopeTeamId && appointment.teamId !== scopeTeamId) {
        return false;
      }

      if (clinicianFilter && appointment.clinicianId !== clinicianFilter) {
        return false;
      }

      if (specialtyFilter && appointment.raw.specialtyCode !== specialtyFilter) {
        return false;
      }

      if (statusFilter && appointment.raw.status !== statusFilter) {
        return false;
      }

      if (!matchesSchedulingSearch({
        title: appointment.title,
        clinicianName: appointment.clinicianName,
        teamName: appointment.teamName,
        modeLabel: appointment.modeLabel,
        status: appointment.raw.status,
        patientId: appointment.raw.patientId,
        attendeeStaffNames: appointment.raw.attendeeStaffNames,
      }, searchTerm)) {
        return false;
      }

      return true;
    });
  }, [clinicianFilter, me?.id, scope, scopeTeamId, searchTerm, specialtyFilter, statusFilter, summaries]);

  const displayedRawAppointments = React.useMemo(
    () => filteredAppointments.map((appointment) => appointment.raw),
    [filteredAppointments],
  );

  const weekDates = React.useMemo(
    () => getWeekDates(currentDate, view === 'week'),
    [currentDate, view],
  );

  const handleOpenNew = (seed?: AppointmentDraftSeed) => {
    setDrawerOpen(false);
    setSelectedAppointment(null);
    setEditingAppointment(null);
    setDialogSeed(seed ?? null);
    setDialogOpen(true);
  };

  const handleSelectAppointment = (appointment: AppointmentResponse) => {
    setRescheduleError('');
    setSelectedAppointment(appointment);
    setDrawerOpen(true);
  };

  const handleEditAppointment = (appointment: AppointmentResponse) => {
    setDrawerOpen(false);
    setSelectedAppointment(null);
    setDialogSeed(null);
    setEditingAppointment(appointment);
    setDialogOpen(true);
  };

  const invalidateSchedulingQueries = async (patientId: string) => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: appointmentKeys.all }),
      queryClient.invalidateQueries({ queryKey: calendarKeys.all }),
      queryClient.invalidateQueries({ queryKey: patientsKeys.appointments(patientId) }),
      queryClient.invalidateQueries({ queryKey: patientAppointmentsKeys.byPatient(patientId) }),
    ]);
  };

  const handleDragStartAppointment = (appointment: AppointmentResponse) => {
    setRescheduleError('');
    setDraggingAppointmentId(appointment.id);
  };

  const handleDragEndAppointment = () => {
    setDraggingAppointmentId(null);
    setDropTargetSlot(null);
  };

  const handleDropAppointment = async (
    appointment: AppointmentResponse,
    date: string,
    startTime?: string,
  ) => {
    const nextTimes = buildRescheduledTimes(appointment, date, startTime);
    if (
      nextTimes.startTime === appointment.startTime &&
      nextTimes.endTime === appointment.endTime
    ) {
      handleDragEndAppointment();
      return;
    }

    setRescheduleError('');
    setReschedulingAppointmentId(appointment.id);
    setDropTargetSlot(startTime ? `${date}|${startTime}` as DragSlot : null);

    try {
      const updated = await appointmentApi.update(appointment.id, nextTimes);
      await invalidateSchedulingQueries(appointment.patientId);
      setSelectedAppointment((current) => (current?.id === updated.id ? updated : current));
    } catch (error) {
      setRescheduleError(
        error instanceof Error
          ? error.message
          : 'Failed to reschedule the appointment.',
      );
    } finally {
      setReschedulingAppointmentId(null);
      handleDragEndAppointment();
    }
  };

  const slotMinutes = prefs.data?.slotMinutes ?? 30;
  const appointmentsLoadFailed = Boolean(appointmentsQuery.error);
  const timeBlockingLoadFailed = Boolean(blocks.error || prefs.error);
  const todayViewLoadFailed = Boolean(today.error);
  const activeAvailabilityBlocks = React.useMemo(
    () => blocks.data ?? [],
    [blocks.data],
  );

  const refreshCalendarWorkspace = React.useCallback(() => {
    void Promise.all([
      queryClient.invalidateQueries({ queryKey: calendarKeys.all }),
      queryClient.invalidateQueries({ queryKey: appointmentKeys.all }),
    ]);
  }, [queryClient]);

  const scrollToSyncSetup = React.useCallback(() => {
    syncCardRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, []);

  if (meLoading || !me) {
    return (
      <Box display="flex" justifyContent="center" mt={6}>
        <CircularProgress />
      </Box>
    );
  }

  return (
    <Container maxWidth="xl" sx={{ py: 3 }}>
      <Stack direction={{ xs: 'column', md: 'row' }} alignItems={{ xs: 'flex-start', md: 'center' }} spacing={2} mb={2}>
        <Box sx={{ flex: 1 }}>
          <Typography variant="h5" sx={{ fontWeight: 700 }}>
            {routeLabel}
          </Typography>
          <Typography variant="body2" color="text.secondary">
            One scheduling surface for clinician, team, and clinic appointments, with time blocking shown as availability overlays and explicit external calendar sync controls.
          </Typography>
        </Box>
        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1}>
          <Button
            startIcon={<RefreshIcon />}
            variant="outlined"
            onClick={refreshCalendarWorkspace}
            sx={{ textTransform: 'none' }}
          >
            Refresh Calendar
          </Button>
          <Button
            startIcon={<CalendarMonthIcon />}
            variant="outlined"
            onClick={scrollToSyncSetup}
            sx={{ textTransform: 'none' }}
          >
            Sync Setup
          </Button>
          <Button
            variant="outlined"
            onClick={() => setTimeBlockingDialogOpen(true)}
            sx={{ textTransform: 'none' }}
          >
            Manage Time Blocking
          </Button>
          <Button
            startIcon={<AddIcon />}
            variant="contained"
            onClick={() => handleOpenNew()}
            sx={{ bgcolor: '#b8621a', '&:hover': { bgcolor: '#d6741f' } }}
          >
            New Appointment
          </Button>
        </Stack>
      </Stack>

      {appointmentsLoadFailed ? (
        <Alert severity="error" sx={{ mb: 2 }}>
          Failed to load appointments. Try refreshing.
        </Alert>
      ) : null}

      <Paper variant="outlined" sx={{ mb: 2, borderRadius: 2 }}>
        <Tabs
          value={workspaceTab}
          onChange={(_, value: WorkspaceTab) => setWorkspaceTab(value)}
          variant="scrollable"
          scrollButtons="auto"
        >
          <Tab value="calendar" label="Calendar" />
          <Tab value="contacts" label="Contacts" />
          <Tab value="dna" label="DNA" />
        </Tabs>
      </Paper>

      {workspaceTab === 'calendar' ? (
        <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', xl: '2fr 1fr' }, gap: 3 }}>
        <Stack spacing={2.5}>
          <Paper variant="outlined" sx={{ p: 2, borderRadius: 2 }}>
            <Stack spacing={2}>
              <Stack direction={{ xs: 'column', lg: 'row' }} spacing={1.5} alignItems={{ xs: 'flex-start', lg: 'center' }}>
                <Stack direction="row" spacing={1} alignItems="center" sx={{ flexWrap: 'wrap' }}>
                  <Button size="small" variant="outlined" onClick={() => setCurrentDate(new Date())} startIcon={<TodayIcon />} sx={{ textTransform: 'none' }}>
                    Today
                  </Button>
                  <Button size="small" variant="text" onClick={() => setCurrentDate((current) => {
                    const next = new Date(current);
                    next.setDate(next.getDate() - (view === 'day' ? 1 : view === 'month' ? 30 : 7));
                    return next;
                  })}>
                    <ChevronLeftIcon fontSize="small" />
                  </Button>
                  <Button size="small" variant="text" onClick={() => setCurrentDate((current) => {
                    const next = new Date(current);
                    next.setDate(next.getDate() + (view === 'day' ? 1 : view === 'month' ? 30 : 7));
                    return next;
                  })}>
                    <ChevronRightIcon fontSize="small" />
                  </Button>
                  <Typography variant="subtitle1" fontWeight={600}>
                    {view === 'day'
                      ? currentDate.toLocaleDateString('en-AU', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })
                      : view === 'month'
                        ? monthDate.toLocaleDateString('en-AU', { month: 'long', year: 'numeric' })
                        : `${formatRangeDate(weekDates[0])} — ${formatRangeDate(weekDates[weekDates.length - 1])} ${weekDates[0].getFullYear()}`}
                  </Typography>
                </Stack>

                <Box sx={{ flex: 1 }} />

                <FormControl size="small" sx={{ minWidth: 140 }}>
                  <InputLabel>Slot length</InputLabel>
                  <Select
                    value={slotMinutes}
                    label="Slot length"
                    onChange={(event) => updatePrefs.mutate({ slotMinutes: Number(event.target.value) as 15 | 20 | 30 | 45 | 60 })}
                  >
                    {SLOT_OPTIONS.map((option) => (
                      <MenuItem key={option} value={option}>
                        {option} min
                      </MenuItem>
                    ))}
                  </Select>
                </FormControl>
                <TextField
                  type="date"
                  size="small"
                  value={currentDate.toISOString().slice(0, 10)}
                  onChange={(event: React.ChangeEvent<HTMLInputElement>) => setCurrentDate(new Date(`${event.target.value}T00:00:00`))}
                  inputProps={{ 'aria-label': 'Selected date' }}
                />
              </Stack>

              <Stack direction={{ xs: 'column', lg: 'row' }} spacing={1.5} alignItems={{ xs: 'flex-start', lg: 'center' }}>
                <ToggleButtonGroup
                  size="small"
                  exclusive
                  value={view}
                  onChange={(_, value: CalendarView | null) => {
                    if (value) setView(value);
                  }}
                >
                  <ToggleButton value="month"><Tooltip title="Month"><CalendarMonthIcon fontSize="small" /></Tooltip></ToggleButton>
                  <ToggleButton value="day"><Tooltip title="Day"><ViewDayIcon fontSize="small" /></Tooltip></ToggleButton>
                  <ToggleButton value="workweek"><Tooltip title="Work Week"><CalendarMonthIcon fontSize="small" /></Tooltip></ToggleButton>
                  <ToggleButton value="week"><Tooltip title="Full Week"><ViewWeekIcon fontSize="small" /></Tooltip></ToggleButton>
                  <ToggleButton value="list"><Tooltip title="List"><ViewListIcon fontSize="small" /></Tooltip></ToggleButton>
                </ToggleButtonGroup>

                <ToggleButtonGroup
                  size="small"
                  exclusive
                  value={scope}
                  onChange={(_, value: CalendarScope | null) => {
                    if (value) setScope(value);
                  }}
                >
                  <ToggleButton value="mine">My appointments</ToggleButton>
                  <ToggleButton value="team">Team view</ToggleButton>
                  <ToggleButton value="clinic">Clinic view</ToggleButton>
                </ToggleButtonGroup>
              </Stack>

              <Stack direction={{ xs: 'column', lg: 'row' }} spacing={1} alignItems={{ xs: 'flex-start', lg: 'center' }}>
                <Chip size="small" label="Green = available time block" sx={{ bgcolor: '#E8F5E9', color: '#2E7D32' }} />
                <Chip size="small" label="Yellow = tentative / protected time" sx={{ bgcolor: '#FFF8E1', color: '#8A5A00' }} />
                <Chip size="small" label="Red = unavailable / leave" sx={{ bgcolor: '#FFEBEE', color: '#C62828' }} />
              </Stack>

              <Stack direction={{ xs: 'column', lg: 'row' }} spacing={1.5}>
                <PatientSearchAutocomplete
                  value={patientFilter}
                  onChange={setPatientFilter}
                  placeholder="Search patient…"
                  sx={{ minWidth: 220 }}
                />
                <FormControl size="small" sx={{ minWidth: 180 }}>
                  <InputLabel>Clinician</InputLabel>
                  <Select value={clinicianFilter} onChange={(event) => setClinicianFilter(event.target.value)} label="Clinician">
                    <MenuItem value="">All clinicians</MenuItem>
                    {staffList.map((staff: StaffLookupRow) => (
                      <MenuItem key={staff.id} value={staff.id}>
                        {staff.givenName} {staff.familyName}
                      </MenuItem>
                    ))}
                  </Select>
                </FormControl>
                <FormControl size="small" sx={{ minWidth: 180 }}>
                  <InputLabel>Team</InputLabel>
                  <Select value={teamFilter} onChange={(event) => setTeamFilter(event.target.value)} label="Team">
                    <MenuItem value="">All teams</MenuItem>
                    {(scope === 'team' ? activeTeams.map((assignment) => ({ id: assignment.orgUnitId, name: assignment.orgUnitName })) : flatUnits).map((unit) => (
                      <MenuItem key={unit.id} value={unit.id}>
                        {unit.name}
                      </MenuItem>
                    ))}
                  </Select>
                </FormControl>
                <FormControl size="small" sx={{ minWidth: 180 }}>
                  <InputLabel>Specialty</InputLabel>
                  <Select value={specialtyFilter} onChange={(event) => setSpecialtyFilter(event.target.value as SpecialtyType | '')} label="Specialty">
                    <MenuItem value="">All specialties</MenuItem>
                    {ALL_SPECIALTIES.map((code) => (
                      <MenuItem key={code} value={code}>
                        {SPECIALTY_DISPLAY[code]}
                      </MenuItem>
                    ))}
                  </Select>
                </FormControl>
                <FormControl size="small" sx={{ minWidth: 180 }}>
                  <InputLabel>Status</InputLabel>
                  <Select
                    value={statusFilter}
                    onChange={(event) =>
                      setStatusFilter(event.target.value as AppointmentStatus | '')
                    }
                    label="Status"
                  >
                    <MenuItem value="">All statuses</MenuItem>
                    {APPOINTMENT_STATUS_OPTIONS.map((status) => (
                      <MenuItem key={status} value={status}>
                        {status.replace(/_/g, ' ')}
                      </MenuItem>
                    ))}
                  </Select>
                </FormControl>
                <TextField
                  size="small"
                  label="Search"
                  placeholder="Title, clinician, patient, attendee…"
                  value={searchTerm}
                  onChange={(event) => setSearchTerm(event.target.value)}
                  sx={{ minWidth: 240 }}
                />
              </Stack>
            </Stack>
          </Paper>

          {rescheduleError ? (
            <Alert severity="error">{rescheduleError}</Alert>
          ) : null}

          {reschedulingAppointmentId ? (
            <Alert severity="info">
              Rescheduling appointment…
            </Alert>
          ) : null}

          {appointmentsQuery.isLoading ? (
            <Box display="flex" justifyContent="center" py={6}>
              <CircularProgress />
            </Box>
          ) : view === 'list' ? (
            <ListView appointments={filteredAppointments} onSelect={handleSelectAppointment} />
          ) : view === 'month' ? (
            <AppointmentCalendar
              appointments={displayedRawAppointments}
              getAvailabilitySummary={(day) => getAvailabilitySummaryForDate(
                activeAvailabilityBlocks,
                day.toISOString().slice(0, 10),
              )}
              month={monthDate}
              onDropAppointment={(appointment, day) =>
                handleDropAppointment(appointment, day.toISOString().slice(0, 10))
              }
              onSelectAppointment={handleSelectAppointment}
              onSelectDay={(day) => handleOpenNew({ date: day.toISOString().slice(0, 10) })}
            />
          ) : view === 'day' ? (
            <DayWeekGrid
              appointments={filteredAppointments}
              availabilityBlocks={activeAvailabilityBlocks}
              dates={[currentDate]}
              dayLabels={[currentDate.toLocaleDateString('en-AU', { weekday: 'short' })]}
              draggingAppointmentId={draggingAppointmentId}
              dropTargetSlot={dropTargetSlot}
              slotMinutes={slotMinutes}
              onCreateSlot={(date, startTime) => handleOpenNew({ date, startTime })}
              onDragHoverSlot={setDropTargetSlot}
              onDragEndAppointment={handleDragEndAppointment}
              onDragStartAppointment={handleDragStartAppointment}
              onDropAppointment={handleDropAppointment}
              onSelect={handleSelectAppointment}
            />
          ) : (
            <DayWeekGrid
              appointments={filteredAppointments}
              availabilityBlocks={activeAvailabilityBlocks}
              dates={weekDates}
              dayLabels={view === 'week' ? ALLDAYS : WEEKDAYS}
              draggingAppointmentId={draggingAppointmentId}
              dropTargetSlot={dropTargetSlot}
              slotMinutes={slotMinutes}
              onCreateSlot={(date, startTime) => handleOpenNew({ date, startTime })}
              onDragHoverSlot={setDropTargetSlot}
              onDragEndAppointment={handleDragEndAppointment}
              onDragStartAppointment={handleDragStartAppointment}
              onDropAppointment={handleDropAppointment}
              onSelect={handleSelectAppointment}
            />
          )}

          {timeBlockingLoadFailed ? (
            <Alert severity="warning" sx={{ mt: 1 }}>
              Appointments are loaded, but time blocking is temporarily unavailable. Refresh to retry.
            </Alert>
          ) : prefs.data && blocks.data ? (
            <Alert severity="info" sx={{ mt: 1 }}>
              Time blocking is integrated into the calendar above as green, yellow, and red overlays. Use
              <strong> Manage Time Blocking</strong> to adjust those rules without switching to a second calendar surface.
            </Alert>
          ) : null}
        </Stack>

        <Stack spacing={2.5}>
          {todayScopeRequiresClinicianSelection ? (
        <Alert severity="info">
          Select a clinician to review contacts and DNA while using team or clinic calendar scope.
        </Alert>
          ) : todayViewLoadFailed ? (
            <Alert severity="warning">
              Today&apos;s contacts and workload summary are temporarily unavailable. Your appointment calendar is still available.
            </Alert>
      ) : today.data ? <TodayContactsView data={today.data} /> : <Box display="flex" justifyContent="center" py={6}><CircularProgress /></Box>}
          <Box ref={syncCardRef}>
            <ICalSubscribeCard onRefreshCalendar={refreshCalendarWorkspace} />
          </Box>
        </Stack>
        </Box>
      ) : workspaceTab === 'contacts' ? (
        todayScopeRequiresClinicianSelection ? (
          <Alert severity="info">
            Select a clinician to review contacts while using team or clinic calendar scope.
          </Alert>
        ) : todayViewLoadFailed ? (
          <Alert severity="warning">
            Today&apos;s contacts and workload summary are temporarily unavailable. Refresh to retry.
          </Alert>
        ) : today.data ? (
          <Stack spacing={2}>
            <Paper variant="outlined" sx={{ p: 2, borderRadius: 2 }}>
              <Typography variant="h6" sx={{ fontWeight: 700 }}>
                Contacts for {today.data.clinicianName || 'this clinician'}
              </Typography>
              <Typography variant="body2" color="text.secondary">
                {today.data.date}
              </Typography>
            </Paper>
            <TodayContactsView data={today.data} mode="contacts" />
          </Stack>
        ) : (
          <Box display="flex" justifyContent="center" py={6}>
            <CircularProgress />
          </Box>
        )
      ) : todayScopeRequiresClinicianSelection ? (
        <Alert severity="info">
          Select a clinician to review DNA activity while using team or clinic calendar scope.
        </Alert>
      ) : todayViewLoadFailed ? (
        <Alert severity="warning">
          DNA activity is temporarily unavailable. Refresh to retry.
        </Alert>
      ) : today.data ? (
        <Stack spacing={2}>
          <Paper variant="outlined" sx={{ p: 2, borderRadius: 2 }}>
            <Typography variant="h6" sx={{ fontWeight: 700 }}>
              DNA activity for {today.data.clinicianName || 'this clinician'}
            </Typography>
            <Typography variant="body2" color="text.secondary">
              {today.data.date}
            </Typography>
          </Paper>
          <TodayContactsView data={today.data} mode="dna" />
        </Stack>
      ) : (
        <Box display="flex" justifyContent="center" py={6}>
          <CircularProgress />
        </Box>
      )}

      <SchedulingAppointmentDialog
        open={dialogOpen}
        onClose={() => {
          setDialogOpen(false);
          setEditingAppointment(null);
          setDialogSeed(null);
        }}
        editing={editingAppointment}
        flatUnits={flatUnits}
        initialDraft={dialogSeed}
        staffList={staffList}
      />
      <AppointmentDetailsDrawer
        appointment={selectedAppointment}
        open={drawerOpen}
        onClose={() => {
          setDrawerOpen(false);
          setSelectedAppointment(null);
        }}
        onEdit={handleEditAppointment}
        staffNamesById={staffNamesById}
      />
      <TimeBlockingRulesDialog
        blocks={blocks.data}
        open={timeBlockingDialogOpen}
        preferences={prefs.data}
        onClose={() => setTimeBlockingDialogOpen(false)}
      />
    </Container>
  );
}
