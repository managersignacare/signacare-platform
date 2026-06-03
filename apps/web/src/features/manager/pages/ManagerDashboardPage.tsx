import React from 'react';
import {
  Alert, Box, Chip, CircularProgress, Grid, LinearProgress, Paper, Tooltip, Typography,
} from '@mui/material';
import AssessmentIcon from '@mui/icons-material/Assessment';
import PeopleIcon from '@mui/icons-material/People';
import TrendingUpIcon from '@mui/icons-material/TrendingUp';
import WarningAmberIcon from '@mui/icons-material/WarningAmber';
import HotelIcon from '@mui/icons-material/Hotel';
import CalendarMonthIcon from '@mui/icons-material/CalendarMonth';
import EventBusyIcon from '@mui/icons-material/EventBusy';
import { useQuery } from '@tanstack/react-query';
import { apiClient } from '../../../shared/services/apiClient';
import { useAuthStore } from '../../../shared/store/authStore';
import { managerKeys } from '../queryKeys';

const fmtDate = (iso: string) => {
  try { return new Date(iso).toLocaleDateString('en-AU', { day: '2-digit', month: 'short' }); } catch { return iso; }
};

interface ContactsKpiClinicianRow {
  contacts_this_period?: number
  contactsThisPeriod?: number
  target?: number
  rag_status?: string
  clinician_id?: string
  id?: string
  clinicianName?: string
  name?: string
}

interface ContactsKpiResponse {
  clinicians?: ContactsKpiClinicianRow[]
  data?: ContactsKpiClinicianRow[]
  target?: number
}

interface CaseloadRow {
  clinician_id?: string
  id?: string
  clinicianName?: string
  name?: string
  patient_count?: number
  patientCount?: number
  patients?: number
  max_caseload?: number
  maxCaseload?: number
  max?: number
  caseload_status?: string
}

interface CaseloadReportResponse {
  clinicians?: CaseloadRow[]
  data?: CaseloadRow[]
}

interface DnaRateRow {
  clinician_id?: string
  clinicianName?: string
  name?: string
  dna_rate_pct?: number | string
  dnaRatePct?: number | string
  total_appointments?: number
  totalAppointments?: number
  dna_count?: number
  dnaCount?: number
}

interface DnaRateResponse {
  data?: DnaRateRow[]
  weeks?: DnaRateRow[]
}

interface BedOccupancyDayRow {
  date?: string
  occupancyPercent?: number
  percentage?: number
  occupancy?: number
}

interface BedOccupancyResponse {
  days?: BedOccupancyDayRow[]
  data?: BedOccupancyDayRow[]
}

interface StaffLeaveRow {
  startDate?: string
  start?: string
  endDate?: string
  end?: string
  staffName?: string
  name?: string
  leave_type?: string
  type?: string
}

interface StaffLeaveResponse {
  leave?: StaffLeaveRow[]
  data?: StaffLeaveRow[]
}

interface WorkloadCaseloadExceededRow {
  id?: string
  name?: string
  patient_count?: number
  max_caseload?: number
  severity?: string
}

interface WorkloadOverdueContactsRow {
  id?: string
  name?: string
  overdue_patients?: number
  severity?: string
}

interface WorkloadAlertRow {
  id?: string
  type?: string
  message?: string
  staffName?: string
  name?: string
  severity?: string
  description?: string
  reason?: string
  patient_count?: number
  max_caseload?: number
  overdue_patients?: number
}

interface WorkloadAlertsPayload {
  caseloadExceeded?: WorkloadCaseloadExceededRow[]
  overdueContacts?: WorkloadOverdueContactsRow[]
}

interface WorkloadAlertsResponse {
  data?: WorkloadAlertsPayload | WorkloadAlertRow[]
  alerts?: WorkloadAlertRow[]
}

export default function ManagerDashboardPage(): React.ReactElement {
  const user = useAuthStore((s) => s.user);
  const isAdmin = user?.role === 'admin' || user?.role === 'superadmin';

  if (!isAdmin) {
    return (
      <Box p={3}>
        <Alert role="alert" severity="error">
          Access denied. Only administrators can access the Manager Dashboard.
        </Alert>
      </Box>
    );
  }

  return (
    <Box sx={{ p: { xs: 2, md: 3 }, bgcolor: '#FBF8F5', minHeight: '100vh' }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, mb: 3 }}>
        <AssessmentIcon sx={{ color: '#327C8D', fontSize: 28 }} />
        <Box>
          <Typography variant="h5" fontWeight={700} fontFamily="Albert Sans, sans-serif" color="#3D484B">Manager Dashboard</Typography>
          <Typography variant="body2" color="text.secondary">KPIs, caseload reports, DNA rates, bed occupancy, staff leave, and workload alerts</Typography>
        </Box>
      </Box>

      <Grid container spacing={3}>
        <Grid size={{ xs: 12, lg: 8 }}>
          <ContactsKpiCard />
        </Grid>
        <Grid size={{ xs: 12, lg: 4 }}>
          <WorkloadAlertsCard />
        </Grid>
        <Grid size={{ xs: 12, lg: 6 }}>
          <CaseloadReportCard />
        </Grid>
        <Grid size={{ xs: 12, lg: 6 }}>
          <DnaRateCard />
        </Grid>
        <Grid size={{ xs: 12, lg: 7 }}>
          <BedOccupancyCard />
        </Grid>
        <Grid size={{ xs: 12, lg: 5 }}>
          <StaffLeaveCalendarCard />
        </Grid>
      </Grid>
    </Box>
  );
}

/* ─── Contacts KPI ─── */
function ContactsKpiCard() {
  const { data, isLoading, error } = useQuery<ContactsKpiResponse>({
    queryKey: managerKeys.contactsKpi(),
    queryFn: async (): Promise<ContactsKpiResponse> => {
      try {
        return await apiClient.get<ContactsKpiResponse>('reports/contacts-kpi')
      } catch {
        return { clinicians: [], data: [], target: 80 }
      }
    },
  });

  const clinicians: ContactsKpiClinicianRow[] = data?.clinicians ?? data?.data ?? [];
  const target = data?.target ?? 80;

  if (error) return <Paper variant="outlined" sx={{ p: 2.5 }}><Alert role="alert" severity="error">Failed to load Contacts KPI</Alert></Paper>;

  return (
    <Paper variant="outlined" sx={{ p: 2.5 }}>
      <Typography variant="subtitle1" fontWeight={700} color="#3D484B" sx={{ mb: 2, fontFamily: 'Albert Sans, sans-serif' }}>
        <TrendingUpIcon sx={{ fontSize: 18, mr: 0.5, verticalAlign: 'text-bottom', color: '#327C8D' }} />
        Contacts KPI by Clinician
      </Typography>
      {isLoading && <CircularProgress role="progressbar" aria-label="Loading" size={24} />}
      {clinicians.length === 0 && !isLoading && (
        <Typography variant="body2" color="text.secondary" sx={{ py: 2, textAlign: 'center' }}>No contact data available</Typography>
      )}
      {clinicians.map((c, i: number) => {
        const contacts = c.contacts_this_period ?? c.contactsThisPeriod ?? 0;
        const tgt = c.target ?? target;
        const pct = tgt > 0 ? Math.round((contacts / tgt) * 100) : 0;
        const color = c.rag_status === 'green' || pct >= 80 ? '#2E7D32' : c.rag_status === 'amber' || pct >= 60 ? '#b8621a' : '#D32F2F';
        const ragLabel = c.rag_status ?? (pct >= 80 ? 'Green' : pct >= 60 ? 'Amber' : 'Red');
        return (
          <Box key={c.clinician_id ?? c.id ?? i} sx={{ mb: 1.5 }}>
            <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 0.5 }}>
              <Typography variant="body2" fontWeight={600} color="#3D484B" sx={{ fontSize: 13 }}>
                {c.clinicianName ?? c.name ?? c.clinicianName ?? `Clinician ${i + 1}`}
              </Typography>
              <Box sx={{ display: 'flex', gap: 1, alignItems: 'center' }}>
                <Chip label={ragLabel} size="small" sx={{ bgcolor: color, color: '#fff', fontWeight: 700, fontSize: 10, height: 20 }} />
                <Typography variant="caption" fontWeight={700} color={color}>{pct}%</Typography>
              </Box>
            </Box>
            <Box sx={{ position: 'relative' }}>
              <LinearProgress variant="determinate" value={Math.min(pct, 100)}
                sx={{
                  height: 20, borderRadius: 1, bgcolor: '#F0F0F0',
                  '& .MuiLinearProgress-bar': { bgcolor: color, borderRadius: 1 },
                }} />
              {/* Target line */}
              <Box sx={{
                position: 'absolute', left: `${target}%`, top: 0, bottom: 0, width: 2,
                bgcolor: '#3D484B', zIndex: 1,
              }} />
            </Box>
          </Box>
        );
      })}
      {clinicians.length > 0 && (
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mt: 1 }}>
          <Box sx={{ width: 16, height: 2, bgcolor: '#3D484B' }} />
          <Typography variant="caption" color="text.secondary">Target: {target}%</Typography>
        </Box>
      )}
    </Paper>
  );
}

/* ─── Caseload Report ─── */
function CaseloadReportCard() {
  const { data, isLoading, error } = useQuery<CaseloadReportResponse>({
    queryKey: managerKeys.caseload(),
    queryFn: async (): Promise<CaseloadReportResponse> => {
      try {
        return await apiClient.get<CaseloadReportResponse>('reports/staff-caseload')
      } catch {
        return { clinicians: [], data: [] }
      }
    },
  });

  const clinicians: CaseloadRow[] = data?.clinicians ?? data?.data ?? [];

  if (error) return <Paper variant="outlined" sx={{ p: 2.5 }}><Alert role="alert" severity="error">Failed to load caseload report</Alert></Paper>;

  return (
    <Paper variant="outlined" sx={{ p: 2.5 }}>
      <Typography variant="subtitle1" fontWeight={700} color="#3D484B" sx={{ mb: 2, fontFamily: 'Albert Sans, sans-serif' }}>
        <PeopleIcon sx={{ fontSize: 18, mr: 0.5, verticalAlign: 'text-bottom', color: '#327C8D' }} />
        Caseload Report
      </Typography>
      {isLoading && <CircularProgress role="progressbar" aria-label="Loading" size={24} />}
      {clinicians.length === 0 && !isLoading && (
        <Typography variant="body2" color="text.secondary" sx={{ py: 2, textAlign: 'center' }}>No caseload data available</Typography>
      )}
      {clinicians.length > 0 && (
        <Box sx={{ overflow: 'auto' }}>
          {/* Header */}
          <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 80px 80px 80px 70px', gap: 1, pb: 1, borderBottom: '2px solid #327C8D' }}>
            {['Clinician', 'Patients', 'Max', '% Used', 'RAG'].map(h => (
              <Typography key={h} variant="caption" fontWeight={700} color="#327C8D" sx={{ fontSize: 11 }}>{h}</Typography>
            ))}
          </Box>
          {clinicians.map((c, i: number) => {
            const patients = c.patient_count ?? c.patientCount ?? c.patients ?? 0;
            const max = c.max_caseload ?? c.maxCaseload ?? c.max ?? 35;
            const pct = max > 0 ? Math.round((patients / max) * 100) : 0;
            const color = c.caseload_status === 'over' || pct >= 95 ? '#D32F2F' : c.caseload_status === 'near' || pct >= 80 ? '#b8621a' : '#2E7D32';
            const ragLabel = c.caseload_status === 'over' ? 'Red' : c.caseload_status === 'near' ? 'Amber' : pct >= 95 ? 'Red' : pct >= 80 ? 'Amber' : 'Green';
            return (
              <Box key={c.clinician_id ?? c.id ?? i} sx={{ display: 'grid', gridTemplateColumns: '1fr 80px 80px 80px 70px', gap: 1, py: 1, borderBottom: '1px solid #eee', alignItems: 'center' }}>
                <Typography variant="body2" fontWeight={600} color="#3D484B" sx={{ fontSize: 12 }}>{c.clinicianName ?? c.name ?? c.clinicianName}</Typography>
                <Typography variant="body2" color="#3D484B" sx={{ fontSize: 12 }}>{patients}</Typography>
                <Typography variant="body2" color="text.secondary" sx={{ fontSize: 12 }}>{max}</Typography>
                <Typography variant="body2" fontWeight={600} color={color} sx={{ fontSize: 12 }}>{pct}%</Typography>
                <Chip label={ragLabel} size="small" sx={{ bgcolor: color, color: '#fff', fontWeight: 700, fontSize: 9, height: 20 }} />
              </Box>
            );
          })}
        </Box>
      )}
    </Paper>
  );
}

/* ─── DNA Rate ─── */
function DnaRateCard() {
  const { data, isLoading, error } = useQuery<DnaRateResponse>({
    queryKey: managerKeys.dnaRate(),
    queryFn: async (): Promise<DnaRateResponse> => {
      try {
        return await apiClient.get<DnaRateResponse>('reports/dna-rates')
      } catch {
        return { weeks: [], data: [] }
      }
    },
  });

  const rows: DnaRateRow[] = data?.data ?? data?.weeks ?? [];

  if (error) return <Paper variant="outlined" sx={{ p: 2.5 }}><Alert role="alert" severity="error">Failed to load DNA rates</Alert></Paper>;

  return (
    <Paper variant="outlined" sx={{ p: 2.5 }}>
      <Typography variant="subtitle1" fontWeight={700} color="#3D484B" sx={{ mb: 2, fontFamily: 'Albert Sans, sans-serif' }}>
        <EventBusyIcon sx={{ fontSize: 18, mr: 0.5, verticalAlign: 'text-bottom', color: '#b8621a' }} />
        DNA / No-Show Rates by Clinician
      </Typography>
      {isLoading && <CircularProgress role="progressbar" aria-label="Loading" size={24} />}

      {rows.length === 0 && !isLoading && (
        <Typography variant="body2" color="text.secondary" sx={{ py: 2, textAlign: 'center' }}>No DNA data available</Typography>
      )}

      {rows.length > 0 && (
        <Box>
          <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 90px 70px 80px', gap: 1, pb: 1, borderBottom: '2px solid #b8621a' }}>
            {['Clinician', 'Appointments', 'DNAs', 'Rate'].map(h => (
              <Typography key={h} variant="caption" fontWeight={700} color="#b8621a" sx={{ fontSize: 11 }}>{h}</Typography>
            ))}
          </Box>
          {rows.map((r, i: number) => {
            const rate = Number(r.dna_rate_pct ?? r.dnaRatePct ?? 0);
            const color = rate > 15 ? '#D32F2F' : rate > 8 ? '#b8621a' : '#2E7D32';
            return (
              <Box key={r.clinician_id ?? i} sx={{ display: 'grid', gridTemplateColumns: '1fr 90px 70px 80px', gap: 1, py: 1, borderBottom: '1px solid #eee', alignItems: 'center' }}>
                <Typography variant="body2" fontWeight={600} color="#3D484B" sx={{ fontSize: 12 }}>{r.clinicianName ?? r.name}</Typography>
                <Typography variant="body2" color="#3D484B" sx={{ fontSize: 12 }}>{r.total_appointments ?? r.totalAppointments ?? 0}</Typography>
                <Typography variant="body2" color={color} fontWeight={600} sx={{ fontSize: 12 }}>{r.dna_count ?? r.dnaCount ?? 0}</Typography>
                <Chip label={`${rate}%`} size="small" sx={{ bgcolor: color, color: '#fff', fontWeight: 700, fontSize: 10, height: 20 }} />
              </Box>
            );
          })}
        </Box>
      )}
    </Paper>
  );
}

/* ─── Bed Occupancy ─── */
function BedOccupancyCard() {
  const { data, isLoading, error } = useQuery<BedOccupancyResponse>({
    queryKey: managerKeys.bedOccupancy(),
    queryFn: async (): Promise<BedOccupancyResponse> => {
      try {
        return await apiClient.get<BedOccupancyResponse>('reports/bed-occupancy-trend')
      } catch {
        return { days: [], data: [] }
      }
    },
  });

  const days: BedOccupancyDayRow[] = data?.days ?? data?.data ?? [];
  const firstDayDate = days[0]?.date;
  const lastDayDate = days[days.length - 1]?.date;

  if (error) return <Paper variant="outlined" sx={{ p: 2.5 }}><Alert role="alert" severity="error">Failed to load bed occupancy</Alert></Paper>;

  return (
    <Paper variant="outlined" sx={{ p: 2.5 }}>
      <Typography variant="subtitle1" fontWeight={700} color="#3D484B" sx={{ mb: 2, fontFamily: 'Albert Sans, sans-serif' }}>
        <HotelIcon sx={{ fontSize: 18, mr: 0.5, verticalAlign: 'text-bottom', color: '#327C8D' }} />
        Bed Occupancy - Last 30 Days
      </Typography>
      {isLoading && <CircularProgress role="progressbar" aria-label="Loading" size={24} />}

      {days.length === 0 && !isLoading && (
        <Typography variant="body2" color="text.secondary" sx={{ py: 2, textAlign: 'center' }}>No occupancy data available</Typography>
      )}

      {days.length > 0 && (
        <>
          {/* Area chart simulation */}
          <Box sx={{ position: 'relative', height: 140, mb: 1, display: 'flex', alignItems: 'flex-end' }}>
            {days.slice(-30).map((d, i: number) => {
              const pct = d.occupancyPercent ?? d.percentage ?? d.occupancy ?? 0;
              const color = pct >= 95 ? '#D32F2F' : pct >= 85 ? '#b8621a' : '#327C8D';
              return (
                <Tooltip key={i} title={`${d.date ? fmtDate(d.date) : `Day ${i + 1}`}: ${pct}%`}>
                  <Box sx={{
                    flex: 1, height: `${Math.max(pct, 2)}%`, bgcolor: color, opacity: 0.75,
                    borderRadius: i === 0 ? '2px 0 0 0' : i === days.length - 1 ? '0 2px 0 0' : 0,
                    transition: 'height 0.3s',
                  }} />
                </Tooltip>
              );
            })}
          </Box>
          {/* X-axis labels */}
          <Box sx={{ display: 'flex', justifyContent: 'space-between' }}>
            {days.length > 0 && <Typography variant="caption" color="text.secondary">{typeof firstDayDate === 'string' ? fmtDate(firstDayDate) : ''}</Typography>}
            {days.length > 1 && <Typography variant="caption" color="text.secondary">{typeof lastDayDate === 'string' ? fmtDate(lastDayDate) : ''}</Typography>}
          </Box>
          {/* Summary */}
          <Box sx={{ display: 'flex', gap: 3, mt: 2 }}>
            <Box>
              <Typography variant="caption" color="text.secondary">Average</Typography>
              <Typography variant="body1" fontWeight={700} color="#327C8D">
                {days.length > 0 ? Math.round(days.reduce((s: number, d) => s + (d.occupancyPercent ?? d.percentage ?? d.occupancy ?? 0), 0) / days.length) : 0}%
              </Typography>
            </Box>
            <Box>
              <Typography variant="caption" color="text.secondary">Peak</Typography>
              <Typography variant="body1" fontWeight={700} color="#b8621a">
                {Math.max(...days.map((d) => d.occupancyPercent ?? d.percentage ?? d.occupancy ?? 0), 0)}%
              </Typography>
            </Box>
          </Box>
        </>
      )}
    </Paper>
  );
}

/* ─── Staff Leave Calendar ─── */
function StaffLeaveCalendarCard() {
  const { data, isLoading, error } = useQuery<StaffLeaveResponse>({
    queryKey: managerKeys.staffLeave(),
    queryFn: async (): Promise<StaffLeaveResponse> => {
      try {
        return await apiClient.get<StaffLeaveResponse>('staff-leave')
      } catch {
        return { leave: [], data: [] }
      }
    },
  });

  const leaveEntries: StaffLeaveRow[] = data?.leave ?? data?.data ?? [];

  if (error) return <Paper variant="outlined" sx={{ p: 2.5 }}><Alert role="alert" severity="error">Failed to load staff leave</Alert></Paper>;

  // Generate simple calendar grid for current month
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const firstDay = new Date(year, month, 1).getDay();
  const monthName = now.toLocaleDateString('en-AU', { month: 'long', year: 'numeric' });

  const LEAVE_COLORS: Record<string, string> = { annual: '#327C8D', sick: '#D32F2F', study: '#b8621a', other: '#7B1FA2' };

  // Map leave to days
  const leaveByDay: Record<number, { name: string; type: string }[]> = {};
  leaveEntries.forEach((l) => {
    const startRaw = l.startDate ?? l.startDate ?? l.start;
    const endRaw = l.endDate ?? l.endDate ?? l.end ?? startRaw;
    if (!startRaw) return;
    if (!endRaw) return;
    const start = new Date(startRaw);
    const end = new Date(endRaw);
    for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
      if (d.getMonth() === month && d.getFullYear() === year) {
        const day = d.getDate();
        if (!leaveByDay[day]) leaveByDay[day] = [];
        leaveByDay[day].push({ name: l.staffName ?? l.staffName ?? l.name ?? 'Staff', type: l.leave_type ?? l.type ?? 'other' });
      }
    }
  });

  const WEEKDAYS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];

  return (
    <Paper variant="outlined" sx={{ p: 2.5 }}>
      <Typography variant="subtitle1" fontWeight={700} color="#3D484B" sx={{ mb: 2, fontFamily: 'Albert Sans, sans-serif' }}>
        <CalendarMonthIcon sx={{ fontSize: 18, mr: 0.5, verticalAlign: 'text-bottom', color: '#327C8D' }} />
        Staff Leave - {monthName}
      </Typography>
      {isLoading && <CircularProgress role="progressbar" aria-label="Loading" size={24} />}

      {/* Calendar grid */}
      <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 0.5 }}>
        {WEEKDAYS.map((d, i) => (
          <Typography key={i} variant="caption" fontWeight={700} color="text.secondary" sx={{ textAlign: 'center', pb: 0.5 }}>{d}</Typography>
        ))}
        {/* Empty cells before first day */}
        {Array.from({ length: firstDay }, (_, i) => <Box key={`e${i}`} />)}
        {/* Day cells */}
        {Array.from({ length: daysInMonth }, (_, i) => {
          const day = i + 1;
          const dayLeave = leaveByDay[day] ?? [];
          const isToday = day === now.getDate();
          return (
            <Tooltip key={day} title={dayLeave.length > 0 ? dayLeave.map(l => `${l.name} (${l.type})`).join(', ') : ''}>
              <Box sx={{
                p: 0.5, minHeight: 32, border: isToday ? '2px solid #327C8D' : '1px solid #eee',
                borderRadius: 1, textAlign: 'center', cursor: dayLeave.length > 0 ? 'pointer' : 'default',
                bgcolor: dayLeave.length > 0 ? (LEAVE_COLORS[dayLeave[0].type] ?? '#7B1FA2') + '20' : 'transparent',
              }}>
                <Typography variant="caption" fontWeight={isToday ? 700 : 400} color={isToday ? '#327C8D' : '#3D484B'} sx={{ fontSize: 10 }}>
                  {day}
                </Typography>
                {dayLeave.length > 0 && (
                  <Box sx={{ display: 'flex', justifyContent: 'center', gap: 0.25, mt: 0.25 }}>
                    {dayLeave.slice(0, 3).map((l, j) => (
                      <Box key={j} sx={{ width: 5, height: 5, borderRadius: '50%', bgcolor: LEAVE_COLORS[l.type] ?? '#7B1FA2' }} />
                    ))}
                  </Box>
                )}
              </Box>
            </Tooltip>
          );
        })}
      </Box>

      {/* Legend */}
      <Box sx={{ display: 'flex', gap: 2, mt: 2, flexWrap: 'wrap' }}>
        {Object.entries(LEAVE_COLORS).map(([type, color]) => (
          <Box key={type} sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
            <Box sx={{ width: 10, height: 10, borderRadius: '50%', bgcolor: color }} />
            <Typography variant="caption" color="text.secondary" sx={{ textTransform: 'capitalize' }}>{type}</Typography>
          </Box>
        ))}
      </Box>
    </Paper>
  );
}

/* ─── Workload Alerts ─── */
function WorkloadAlertsCard() {
  const { data, isLoading, error } = useQuery<WorkloadAlertsResponse>({
    queryKey: managerKeys.workloadAlerts(),
    queryFn: async (): Promise<WorkloadAlertsResponse> => {
      try {
        return await apiClient.get<WorkloadAlertsResponse>('reports/workload-alerts')
      } catch {
        return { alerts: [], data: [] }
      }
    },
  });

  // API returns { data: { caseloadExceeded: [...], overdueContacts: [...] } }
  const raw = data?.data ?? data ?? {};
  const caseloadExceeded: WorkloadCaseloadExceededRow[] = Array.isArray(raw) ? [] : ((raw as WorkloadAlertsPayload).caseloadExceeded ?? []);
  const overdueContacts: WorkloadOverdueContactsRow[] = Array.isArray(raw) ? [] : ((raw as WorkloadAlertsPayload).overdueContacts ?? []);
  const alerts: WorkloadAlertRow[] = [
    ...caseloadExceeded.map((a) => ({ ...a, type: 'over-caseload', message: `${a.patient_count ?? 0} patients (max ${a.max_caseload ?? 0})`, staffName: a.name })),
    ...overdueContacts.map((a) => ({ ...a, type: 'no-contacts', message: `${a.overdue_patients ?? 0} patients with no contact in 14+ days`, staffName: a.name })),
  ];

  if (error) return <Paper variant="outlined" sx={{ p: 2.5 }}><Alert role="alert" severity="error">Failed to load workload alerts</Alert></Paper>;

  const ALERT_ICONS: Record<string, { icon: React.ReactNode; color: string }> = {
    'over-caseload': { icon: <PeopleIcon sx={{ fontSize: 16 }} />, color: '#D32F2F' },
    'no-contacts': { icon: <EventBusyIcon sx={{ fontSize: 16 }} />, color: '#b8621a' },
    'overdue-tasks': { icon: <WarningAmberIcon sx={{ fontSize: 16 }} />, color: '#b8621a' },
    default: { icon: <WarningAmberIcon sx={{ fontSize: 16 }} />, color: '#b8621a' },
  };

  return (
    <Paper variant="outlined" sx={{ p: 2.5 }}>
      <Typography variant="subtitle1" fontWeight={700} color="#3D484B" sx={{ mb: 2, fontFamily: 'Albert Sans, sans-serif' }}>
        <WarningAmberIcon sx={{ fontSize: 18, mr: 0.5, verticalAlign: 'text-bottom', color: '#b8621a' }} />
        Workload Alerts
      </Typography>
      {isLoading && <CircularProgress role="progressbar" aria-label="Loading" size={24} />}
      {alerts.length === 0 && !isLoading && (
        <Box sx={{ py: 3, textAlign: 'center' }}>
          <Typography variant="body2" color="text.secondary">No active alerts</Typography>
          <Typography variant="caption" color="#2E7D32">All staff within normal parameters</Typography>
        </Box>
      )}
      {alerts.map((a, i: number) => {
        const alertType = ALERT_ICONS[a.type ?? 'default'] ?? ALERT_ICONS.default;
        return (
          <Box key={a.id ?? i} sx={{ display: 'flex', gap: 1.5, alignItems: 'flex-start', py: 1.5, borderBottom: i < alerts.length - 1 ? '1px solid #eee' : 'none' }}>
            <Box sx={{
              width: 28, height: 28, borderRadius: '50%', bgcolor: alertType.color + '20',
              display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, mt: 0.25,
            }}>
              <Box sx={{ color: alertType.color }}>{alertType.icon}</Box>
            </Box>
            <Box sx={{ flex: 1 }}>
              <Typography variant="body2" fontWeight={600} color="#3D484B" sx={{ fontSize: 12 }}>
                {a.staffName ?? a.name ?? 'Staff Member'}
              </Typography>
              <Typography variant="caption" color="text.secondary">
                {a.message ?? a.description ?? a.reason ?? a.type?.replace(/-/g, ' ') ?? 'Alert'}
              </Typography>
            </Box>
            <Chip label={a.severity ?? a.type ?? 'alert'} size="small" sx={{
              bgcolor: (a.severity === 'high' || a.type === 'over-caseload') ? '#FDECEA' : '#FFF3E0',
              color: (a.severity === 'high' || a.type === 'over-caseload') ? '#D32F2F' : '#b8621a',
              fontSize: 9, fontWeight: 600, height: 20, textTransform: 'capitalize',
            }} />
          </Box>
        );
      })}
    </Paper>
  );
}
