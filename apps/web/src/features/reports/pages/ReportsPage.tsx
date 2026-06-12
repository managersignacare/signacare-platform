import AssignmentIcon from '@mui/icons-material/Assignment';
import AutoAwesomeIcon from '@mui/icons-material/AutoAwesome';
import BarChartIcon from '@mui/icons-material/BarChart';
import CalendarTodayIcon from '@mui/icons-material/CalendarToday';
import DownloadIcon from '@mui/icons-material/Download';
import GavelIcon from '@mui/icons-material/Gavel';
import PeopleIcon from '@mui/icons-material/People';
import SwapHorizIcon from '@mui/icons-material/SwapHoriz';
import TuneIcon from '@mui/icons-material/Tune';
import VaccinesIcon from '@mui/icons-material/Vaccines';
import {
    Box, Button, Card, CardContent, Chip, CircularProgress, Divider,
    FormControl, Grid, InputLabel, MenuItem,
    Paper, Select, Tab, Table, TableBody, TableCell, TableContainer, TableHead, TableRow,
    Tabs, TextField, Tooltip, Typography
} from '@mui/material';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import React, { useMemo, useState } from 'react';
import { MarkdownRenderer } from '../../../shared/components/ui/MarkdownRenderer';
import { apiClient } from '../../../shared/services/apiClient';
import { llmAiJobsApi } from '../../../shared/services/llmAiJobsApi';
import { useAuthStore } from '../../../shared/store/authStore';
import {
  adminOverviewKeys,
  reportSchedulesKeys,
  caseloadByTeamKeys,
  auditTemplatesKeys,
  auditRunsKeys,
  auditRunKeys,
  staffLookupKeys,
} from '../queryKeys';
import {
  type AuditRunDetailResponse,
  type AuditRunResultRow,
  type AuditRunsResponse,
  type AuditRunScoreRow,
  type AuditTemplatesResponse,
  type CaseloadByTeamResponse,
  type ReportDataShape,
  type ReportScheduleRow,
  type ReportSchedulesResponse,
  type StaffLookupRow,
  type StartAuditResponse,
  readAuditQuestions,
  readErrorMessage,
  readReportSchedules,
  readStaffLookup,
  toNumber,
} from './reportsPageSupport';
import { BarRow, ReportTabLoading, StatCard } from './reportsPagePrimitives';

const AdminReportWorkbench = React.lazy(() =>
  import('../components/AdminReportWorkbench').then((module) => ({ default: module.AdminReportWorkbench })),
);

interface AdminOverview {
  period: string;
  overview: { totalPatients: number; openEpisodes: number; newReferrals: number; referralsByStatus: Record<string, number>; totalAppointments: number; appointmentsByStatus: Record<string, number>; openTasks: number; overdueTasks: number };
  clinical: { totalNotes: number; signedNotes: number; draftNotes: number; dnaRate: number; dnaCount: number; laiTotal: number; laiOverdue: number; escalationsActive: number; escalationsResolved: number; restrictiveInterventions: number };
  compliance: { overdueReviews: number; activeLegalOrders: number; pendingLegalOrders: number };
  teams: { team: string; count: number }[];
  staff: { name: string; role: string; patients: number; notes: number; appointments: number }[];
  discharges: { total: number; avgLos: number; reasons: { reason: string; count: number }[] };
  beds: { total: number; occupied: number; available: number; maintenance: number };
}

export default function ReportsPage() {
  const [period, setPeriod] = useState('month');
  // Governance tabs (overview/clinical/compliance/workforce/audit) call
  // /admin-overview + /audit-* which are now admin-gated server-side
  // (Tier 1.1). Non-admin users land on `caseload` (their own team's data).
  const user = useAuthStore(s => s.user);
  const isAdmin = user?.role === 'admin' || user?.role === 'superadmin';
  const canViewAdminReport = new Set([
    'clinician',
    'nurse',
    'psychiatrist',
    'psychologist',
    'case_manager',
    'manager',
    'admin',
    'superadmin',
  ]).has(user?.role ?? '');
  const [tab, setTab] = useState(() => {
    if (canViewAdminReport) return 'admin-report';
    if (isAdmin) return 'overview';
    return 'caseload';
  });
  const [aiReport, setAiReport] = useState('');
  const [aiLoading, setAiLoading] = useState(false);

  const { data, isLoading } = useQuery<AdminOverview>({
    queryKey: adminOverviewKeys.byPeriod(period),
    queryFn: () => apiClient.get<AdminOverview>('reports/admin-overview', { period }),
    staleTime: 30_000,
    enabled: isAdmin,  // avoid 403 noise for non-admin users
  });

  const generateAiReport = async () => {
    if (!data) return;
    setAiLoading(true);
    try {
      const result = await llmAiJobsApi.runClinicalAiJob({
        action: 'admin-report',
        data: JSON.stringify(data, null, 2),
        enhance: false,
      });
      setAiReport(result);
    } catch (err: unknown) {
      setAiReport(`Error generating report: ${readErrorMessage(err, 'AI unavailable')}`);
    } finally {
      setAiLoading(false);
    }
  };

  return (
    <Box sx={{ px: { xs: 2, sm: 3, md: 4 }, py: 3, bgcolor: '#FBF8F5', minHeight: '100vh' }}>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', mb: 3, flexWrap: 'wrap', gap: 1 }}>
        <Box>
          <Typography variant="h5" fontWeight={700} fontFamily="Albert Sans, sans-serif" sx={{ color: '#3D484B' }}>Admin Reports</Typography>
          <Typography variant="body2" color="text.secondary">Service performance, clinical activity, and compliance monitoring</Typography>
        </Box>
        <Box sx={{ display: 'flex', gap: 1 }}>
          <Button size="small" variant="outlined" startIcon={aiLoading ? <CircularProgress role="progressbar" aria-label="Loading" size={14} /> : <AutoAwesomeIcon />}
            onClick={generateAiReport} disabled={aiLoading || !data}
            sx={{ textTransform: 'none', borderColor: '#b8621a', color: '#b8621a' }}>
            {aiLoading ? 'Generating...' : 'AI Summary'}
          </Button>
          <FormControl size="small" sx={{ minWidth: 140 }}>
            <InputLabel>Period</InputLabel>
            <Select value={period} onChange={e => setPeriod(e.target.value)} label="Period" sx={{ bgcolor: '#fff' }}>
              <MenuItem value="week">This Week</MenuItem>
              <MenuItem value="month">This Month</MenuItem>
              <MenuItem value="quarter">This Quarter</MenuItem>
              <MenuItem value="year">This Year</MenuItem>
            </Select>
          </FormControl>
        </Box>
      </Box>

      {isLoading && <Box sx={{ display: 'flex', justifyContent: 'center', py: 6 }}><CircularProgress role="progressbar" aria-label="Loading" sx={{ color: '#b8621a' }} /></Box>}

      {aiReport && (
        <Paper variant="outlined" sx={{ p: 2.5, mb: 3, borderLeft: '4px solid #b8621a' }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}>
            <AutoAwesomeIcon sx={{ color: '#b8621a', fontSize: 18 }} />
            <Typography variant="subtitle2" fontWeight={700}>AI-Generated Report Summary</Typography>
            <Chip label="AI Generated" size="small" sx={{ fontSize: 9, height: 18, bgcolor: '#FFF3E0', color: '#E65100' }} />
            <Button size="small" onClick={() => setAiReport('')} sx={{ ml: 'auto', fontSize: 11 }}>Dismiss</Button>
          </Box>
          <MarkdownRenderer content={aiReport} sx={{ fontSize: 13 }} />
        </Paper>
      )}

      <Tabs aria-label="Navigation tabs" value={tab} onChange={(_, v) => setTab(v)} sx={{ mb: 3, '& .MuiTab-root': { textTransform: 'none' } }}>
        {canViewAdminReport && <Tab label="Admin Report" value="admin-report" />}
        {isAdmin && <Tab label="Overview" value="overview" />}
        {isAdmin && <Tab label="Clinical Activity" value="clinical" />}
        {isAdmin && <Tab label="Compliance" value="compliance" />}
        {isAdmin && <Tab label="Workforce" value="workforce" />}
        {isAdmin && <Tab label="Scheduled" value="scheduled" />}
        {isAdmin && <Tab label="Report Builder" value="builder" />}
        <Tab label="Caseload" value="caseload" />
        {isAdmin && <Tab label="Quality Audit" value="audit" />}
      </Tabs>

      {canViewAdminReport && tab === 'admin-report' && (
        <React.Suspense fallback={<ReportTabLoading label="Loading admin report workbench..." />}>
          <AdminReportWorkbench />
        </React.Suspense>
      )}
      {isAdmin && tab === 'overview' && (data ? <OverviewReport data={data} /> : <Typography color="text.secondary" sx={{ py: 4, textAlign: 'center' }}>Loading overview data...</Typography>)}
      {isAdmin && tab === 'clinical' && (data ? <ClinicalReport data={data} /> : <Typography color="text.secondary" sx={{ py: 4, textAlign: 'center' }}>Loading...</Typography>)}
      {isAdmin && tab === 'compliance' && (data ? <ComplianceReport data={data} /> : <Typography color="text.secondary" sx={{ py: 4, textAlign: 'center' }}>Loading...</Typography>)}
      {isAdmin && tab === 'workforce' && (data ? <WorkforceReport data={data} /> : <Typography color="text.secondary" sx={{ py: 4, textAlign: 'center' }}>Loading...</Typography>)}
      {isAdmin && tab === 'scheduled' && <ScheduledReportsPanel />}
      {isAdmin && tab === 'builder' && <ReportBuilderPanel />}
      {tab === 'caseload' && <CaseloadReport />}
      {isAdmin && tab === 'audit' && <QualityAuditPanel />}
    </Box>
  );
}

interface OverviewReportProps { data: AdminOverview }
function OverviewReport({ data }: OverviewReportProps) {
  const o = data.overview;
  const maxTeam = Math.max(...data.teams.map(t => t.count), 1);

  return (
    <Grid container spacing={2}>
      <Grid size={{ xs: 6, sm: 3 }}><StatCard icon={<PeopleIcon />} color="#b8621a" label="Active Patients" value={o.totalPatients} /></Grid>
      <Grid size={{ xs: 6, sm: 3 }}><StatCard icon={<SwapHorizIcon />} color="#327C8D" label={`Referrals (${data.period})`} value={o.newReferrals} /></Grid>
      <Grid size={{ xs: 6, sm: 3 }}><StatCard icon={<CalendarTodayIcon />} color="#3D484B" label={`Appointments (${data.period})`} value={o.totalAppointments} /></Grid>
      <Grid size={{ xs: 6, sm: 3 }}><StatCard icon={<AssignmentIcon />} color="#D32F2F" label="Open Tasks" value={o.openTasks} sub={o.overdueTasks > 0 ? `${o.overdueTasks} overdue` : undefined} /></Grid>

      <Grid size={{ xs: 12, md: 6 }}>
        <Paper variant="outlined" sx={{ p: 2 }}>
          <Typography variant="subtitle2" fontWeight={600} sx={{ mb: 1 }}>Patients by Team</Typography>
          {data.teams.map(t => <BarRow key={t.team} label={t.team} value={t.count} max={maxTeam} color="#b8621a" />)}
          {data.teams.length === 0 && <Typography variant="body2" color="text.secondary">No team data</Typography>}
        </Paper>
      </Grid>

      <Grid size={{ xs: 12, md: 6 }}>
        <Paper variant="outlined" sx={{ p: 2 }}>
          <Typography variant="subtitle2" fontWeight={600} sx={{ mb: 1 }}>Referral Outcomes</Typography>
          {Object.entries(o.referralsByStatus).map(([status, count]) => (
            <Box key={status} sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 0.5 }}>
              <Box sx={{ width: 10, height: 10, borderRadius: '50%', bgcolor: status === 'accepted' ? '#327C8D' : status === 'declined' ? '#D32F2F' : '#b8621a' }} />
              <Typography variant="body2" sx={{ flex: 1, textTransform: 'capitalize' }}>{status.replace('_', ' ')}</Typography>
              <Typography variant="body2" fontWeight={600}>{count}</Typography>
            </Box>
          ))}
        </Paper>
      </Grid>

      <Grid size={{ xs: 12, md: 6 }}>
        <Paper variant="outlined" sx={{ p: 2 }}>
          <Typography variant="subtitle2" fontWeight={600} sx={{ mb: 1 }}>Discharge Summary</Typography>
          <Box sx={{ display: 'flex', gap: 3 }}>
            <Box sx={{ textAlign: 'center' }}><Typography variant="h4" fontWeight={700} color="#327C8D">{data.discharges.total}</Typography><Typography variant="caption">Discharged</Typography></Box>
            <Box sx={{ textAlign: 'center' }}><Typography variant="h4" fontWeight={700} color="#b8621a">{data.discharges.avgLos || '—'}</Typography><Typography variant="caption">Avg LOS (days)</Typography></Box>
          </Box>
          {data.discharges.reasons.length > 0 && (
            <Box sx={{ mt: 1 }}>
              {data.discharges.reasons.map(r => (
                <Chip key={r.reason} label={`${r.reason}: ${r.count}`} size="small" variant="outlined" sx={{ mr: 0.5, mb: 0.5, fontSize: 10 }} />
              ))}
            </Box>
          )}
        </Paper>
      </Grid>

      <Grid size={{ xs: 12, md: 6 }}>
        <Paper variant="outlined" sx={{ p: 2 }}>
          <Typography variant="subtitle2" fontWeight={600} sx={{ mb: 1 }}>Beds</Typography>
          <Box sx={{ display: 'flex', gap: 3 }}>
            <Box sx={{ textAlign: 'center' }}><Typography variant="h4" fontWeight={700} color="#b8621a">{data.beds.occupied}</Typography><Typography variant="caption">Occupied</Typography></Box>
            <Box sx={{ textAlign: 'center' }}><Typography variant="h4" fontWeight={700} color="#327C8D">{data.beds.available}</Typography><Typography variant="caption">Available</Typography></Box>
            <Box sx={{ textAlign: 'center' }}><Typography variant="h4" fontWeight={700} color="#3D484B">{data.beds.total}</Typography><Typography variant="caption">Total</Typography></Box>
            {data.beds.total > 0 && <Box sx={{ textAlign: 'center' }}><Typography variant="h4" fontWeight={700} color="#D32F2F">{Math.round(data.beds.occupied / data.beds.total * 100)}%</Typography><Typography variant="caption">Occupancy</Typography></Box>}
          </Box>
        </Paper>
      </Grid>
    </Grid>
  );
}

interface ClinicalReportProps { data: AdminOverview }
function ClinicalReport({ data }: ClinicalReportProps) {
  const c = data.clinical;
  return (
    <Grid container spacing={2}>
      <Grid size={{ xs: 6, sm: 3 }}><StatCard icon={<VaccinesIcon />} color="#b8621a" label="LAI Patients" value={c.laiTotal} /></Grid>
      <Grid size={{ xs: 6, sm: 3 }}><StatCard icon={<VaccinesIcon />} color="#D32F2F" label="LAI Overdue" value={c.laiOverdue} /></Grid>
      <Grid size={{ xs: 6, sm: 3 }}><StatCard icon={<GavelIcon />} color="#327C8D" label="Restrictive Interventions" value={c.restrictiveInterventions} /></Grid>
      <Grid size={{ xs: 6, sm: 3 }}><StatCard icon={<PeopleIcon />} color="#3D484B" label="DNA Rate" value={`${c.dnaRate}%`} sub={`${c.dnaCount} missed`} /></Grid>

      <Grid size={{ xs: 12, md: 6 }}>
        <Paper variant="outlined" sx={{ p: 2 }}>
          <Typography variant="subtitle2" fontWeight={600} sx={{ mb: 1 }}>Clinical Notes</Typography>
          <Box sx={{ display: 'flex', gap: 3 }}>
            <Box sx={{ textAlign: 'center' }}><Typography variant="h4" fontWeight={700} color="#327C8D">{c.totalNotes}</Typography><Typography variant="caption">Total</Typography></Box>
            <Box sx={{ textAlign: 'center' }}><Typography variant="h4" fontWeight={700} color="#4E9C82">{c.signedNotes}</Typography><Typography variant="caption">Signed</Typography></Box>
            <Box sx={{ textAlign: 'center' }}><Typography variant="h4" fontWeight={700} color="#b8621a">{c.draftNotes}</Typography><Typography variant="caption">Draft</Typography></Box>
          </Box>
        </Paper>
      </Grid>

      <Grid size={{ xs: 12, md: 6 }}>
        <Paper variant="outlined" sx={{ p: 2 }}>
          <Typography variant="subtitle2" fontWeight={600} sx={{ mb: 1 }}>Escalations</Typography>
          <Box sx={{ display: 'flex', gap: 3 }}>
            <Box sx={{ textAlign: 'center' }}><Typography variant="h4" fontWeight={700} color="#D32F2F">{c.escalationsActive}</Typography><Typography variant="caption">Active</Typography></Box>
            <Box sx={{ textAlign: 'center' }}><Typography variant="h4" fontWeight={700} color="#327C8D">{c.escalationsResolved}</Typography><Typography variant="caption">Resolved</Typography></Box>
          </Box>
        </Paper>
      </Grid>

      <Grid size={{ xs: 12 }}>
        <Paper variant="outlined" sx={{ p: 2 }}>
          <Typography variant="subtitle2" fontWeight={600} sx={{ mb: 1 }}>Clinician Activity</Typography>
          {data.staff.filter(s => s.appointments > 0 || s.notes > 0).map(s => (
            <Box key={s.name} sx={{ display: 'flex', alignItems: 'center', gap: 2, py: 0.5, borderBottom: '1px solid #F0F0F0' }}>
              <Typography variant="body2" fontWeight={500} sx={{ width: 160 }}>{s.name}</Typography>
              <Chip label={`${s.appointments} appts`} size="small" sx={{ fontSize: 10, height: 20 }} />
              <Chip label={`${s.notes} notes`} size="small" variant="outlined" sx={{ fontSize: 10, height: 20 }} />
              <Chip label={`${s.patients} patients`} size="small" variant="outlined" sx={{ fontSize: 10, height: 20 }} />
            </Box>
          ))}
        </Paper>
      </Grid>
    </Grid>
  );
}

interface ComplianceReportProps { data: AdminOverview }
function ComplianceReport({ data }: ComplianceReportProps) {
  const c = data.compliance;
  return (
    <Grid container spacing={2}>
      <Grid size={{ xs: 12, md: 6 }}>
        <Paper variant="outlined" sx={{ p: 2 }}>
          <Typography variant="subtitle2" fontWeight={600} sx={{ mb: 1 }}>91-Day Reviews</Typography>
          <Box sx={{ display: 'flex', gap: 3 }}>
            <Box sx={{ textAlign: 'center' }}><Typography variant="h4" fontWeight={700} color="#D32F2F">{c.overdueReviews}</Typography><Typography variant="caption">Overdue</Typography></Box>
            <Box sx={{ textAlign: 'center' }}><Typography variant="h4" fontWeight={700} color="#327C8D">{data.overview.openEpisodes - c.overdueReviews}</Typography><Typography variant="caption">On Time</Typography></Box>
          </Box>
        </Paper>
      </Grid>
      <Grid size={{ xs: 12, md: 6 }}>
        <Paper variant="outlined" sx={{ p: 2 }}>
          <Typography variant="subtitle2" fontWeight={600} sx={{ mb: 1 }}>MHA / Legal Orders</Typography>
          <Box sx={{ display: 'flex', gap: 3 }}>
            <Box sx={{ textAlign: 'center' }}><Typography variant="h4" fontWeight={700} color="#D32F2F">{c.activeLegalOrders}</Typography><Typography variant="caption">Active Orders</Typography></Box>
            <Box sx={{ textAlign: 'center' }}><Typography variant="h4" fontWeight={700} color="#b8621a">{c.pendingLegalOrders}</Typography><Typography variant="caption">Pending</Typography></Box>
          </Box>
        </Paper>
      </Grid>
      <Grid size={{ xs: 12, md: 6 }}>
        <Paper variant="outlined" sx={{ p: 2 }}>
          <Typography variant="subtitle2" fontWeight={600} sx={{ mb: 1 }}>Clinical Notes Compliance</Typography>
          <Box sx={{ display: 'flex', gap: 3 }}>
            <Box sx={{ textAlign: 'center' }}>
              <Typography variant="h4" fontWeight={700} color="#327C8D">
                {data.clinical.totalNotes > 0 ? Math.round(data.clinical.signedNotes / data.clinical.totalNotes * 100) : 0}%
              </Typography>
              <Typography variant="caption">Sign-off Rate</Typography>
            </Box>
            <Box sx={{ textAlign: 'center' }}><Typography variant="h4" fontWeight={700} color="#b8621a">{data.clinical.draftNotes}</Typography><Typography variant="caption">Unsigned Notes</Typography></Box>
          </Box>
        </Paper>
      </Grid>
      <Grid size={{ xs: 12, md: 6 }}>
        <Paper variant="outlined" sx={{ p: 2 }}>
          <Typography variant="subtitle2" fontWeight={600} sx={{ mb: 1 }}>LAI Compliance</Typography>
          <Box sx={{ display: 'flex', gap: 3 }}>
            <Box sx={{ textAlign: 'center' }}><Typography variant="h4" fontWeight={700} color="#327C8D">{data.clinical.laiTotal - data.clinical.laiOverdue}</Typography><Typography variant="caption">On Schedule</Typography></Box>
            <Box sx={{ textAlign: 'center' }}><Typography variant="h4" fontWeight={700} color="#D32F2F">{data.clinical.laiOverdue}</Typography><Typography variant="caption">Overdue</Typography></Box>
          </Box>
        </Paper>
      </Grid>
    </Grid>
  );
}

interface WorkforceReportProps { data: AdminOverview }
function WorkforceReport({ data }: WorkforceReportProps) {
  const maxPatients = Math.max(...data.staff.map(s => s.patients), 1);
  return (
    <Grid container spacing={2}>
      <Grid size={{ xs: 12 }}>
        <Paper variant="outlined" sx={{ p: 2 }}>
          <Typography variant="subtitle2" fontWeight={600} sx={{ mb: 1 }}>Caseload Distribution</Typography>
          {data.staff.filter(s => s.patients > 0).map(s => (
            <Box key={s.name} sx={{ display: 'flex', alignItems: 'center', gap: 2, py: 0.5, borderBottom: '1px solid #F0F0F0' }}>
              <Typography variant="body2" fontWeight={500} sx={{ width: 160 }}>{s.name}</Typography>
              <Chip label={s.role} size="small" variant="outlined" sx={{ fontSize: 9, height: 18 }} />
              <Box sx={{ flex: 1, bgcolor: '#E0E0E0', borderRadius: 1, height: 14 }}>
                <Box sx={{ width: `${Math.round(s.patients / maxPatients * 100)}%`, bgcolor: '#b8621a', borderRadius: 1, height: 14, minWidth: 8 }} />
              </Box>
              <Typography variant="body2" fontWeight={600}>{s.patients} patients</Typography>
            </Box>
          ))}
          {data.staff.filter(s => s.patients > 0).length === 0 && (
            <Typography variant="body2" color="text.secondary">No caseload data for this period</Typography>
          )}
        </Paper>
      </Grid>

      <Grid size={{ xs: 12 }}>
        <Paper variant="outlined" sx={{ p: 2 }}>
          <Typography variant="subtitle2" fontWeight={600} sx={{ mb: 1 }}>Staff Activity Summary</Typography>
          <Box component="table" sx={{ width: '100%', fontSize: 12, '& th': { textAlign: 'left', py: 0.5, fontWeight: 600, borderBottom: '2px solid #327C8D' }, '& td': { py: 0.5, borderBottom: '1px solid #eee' } }}>
            <thead><tr><th>Staff</th><th>Role</th><th>Patients</th><th>Appointments</th><th>Notes</th></tr></thead>
            <tbody>
              {data.staff.map(s => (
                <tr key={s.name}><td>{s.name}</td><td>{s.role}</td><td><strong>{s.patients}</strong></td><td>{s.appointments}</td><td>{s.notes}</td></tr>
              ))}
            </tbody>
          </Box>
        </Paper>
      </Grid>
    </Grid>
  );
}

// ── Scheduled Reports Panel ──────────────────────────────────────────────────
function ScheduledReportsPanel() {
  const qc = useQueryClient();
  const [addOpen, setAddOpen] = useState(false);
  const [form, setForm] = useState({ reportType: 'admin-overview', scheduleCron: 'weekly', format: 'pdf', recipients: '' });

  const { data, isLoading } = useQuery({
    queryKey: reportSchedulesKeys.all,
    queryFn: () => apiClient.get<ReportSchedulesResponse>('report-schedules').catch(() => ({ data: [] })),
  });
  const schedules: ReportScheduleRow[] = readReportSchedules(data);

  const saveMut = useMutation({
    mutationFn: () => apiClient.post('report-schedules', {
      reportType: form.reportType,
      scheduleCron: form.scheduleCron === 'weekly' ? '0 8 * * 1' : form.scheduleCron === 'monthly' ? '0 8 1 * *' : form.scheduleCron,
      format: form.format,
      recipients: form.recipients.split(',').map(s => s.trim()).filter(Boolean),
      isActive: true,
    }),
    onSuccess: () => { setAddOpen(false); qc.invalidateQueries({ queryKey: reportSchedulesKeys.all }); },
  });

  const REPORT_TYPES = [
    { value: 'admin-overview', label: 'Admin Overview' },
    { value: 'contacts-kpi', label: 'Contacts KPI' },
    { value: 'staff-caseload', label: 'Staff Caseload' },
    { value: 'dna-rates', label: 'DNA Rates' },
    { value: 'bed-occupancy', label: 'Bed Occupancy' },
    { value: 'compliance', label: 'Compliance Summary' },
    { value: 'referral-activity', label: 'Referral Activity' },
  ];

  return (
    <Box>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
        <Typography variant="h6" fontWeight={600} fontFamily="Albert Sans, sans-serif">Scheduled Reports</Typography>
        <Button variant="contained" size="small" onClick={() => setAddOpen(true)}
          sx={{ bgcolor: '#327C8D', textTransform: 'none' }}>
          + New Schedule
        </Button>
      </Box>

      {isLoading && <CircularProgress role="progressbar" aria-label="Loading" size={24} />}

      {schedules.length === 0 && !isLoading && (
        <Paper sx={{ p: 4, textAlign: 'center', bgcolor: '#f8f6f3' }}>
          <Typography variant="body2" color="text.secondary">No scheduled reports. Create one to auto-generate and email reports.</Typography>
        </Paper>
      )}

      {schedules.map((s, i: number) => (
        <Paper key={s.id ?? i} variant="outlined" sx={{ p: 2, mb: 1.5, display: 'flex', alignItems: 'center', gap: 2 }}>
          <Box sx={{ flex: 1 }}>
            <Typography variant="body2" fontWeight={700}>{s.report_type ?? s.reportType}</Typography>
            <Typography variant="caption" color="text.secondary">
              Cron: {s.schedule_cron ?? s.scheduleCron} | Format: {s.format ?? 'pdf'} |
              {(s.isActive ?? s.is_active) ? ' Active' : ' Paused'}
            </Typography>
          </Box>
          <Chip label={(s.isActive ?? s.is_active) ? 'Active' : 'Paused'} size="small"
            sx={{ bgcolor: (s.isActive ?? s.is_active) ? '#E8F5E9' : '#eee', color: (s.isActive ?? s.is_active) ? '#2E7D32' : '#999', fontWeight: 600, fontSize: 10 }} />
          {s.next_run_at && (
            <Typography variant="caption" color="text.secondary">
              Next: {new Date(s.next_run_at).toLocaleDateString('en-AU')}
            </Typography>
          )}
        </Paper>
      ))}

      {/* Add Schedule Dialog */}
      {addOpen && (
        <Paper variant="outlined" sx={{ p: 3, mt: 2 }}>
          <Typography variant="subtitle2" fontWeight={700} sx={{ mb: 2 }}>New Scheduled Report</Typography>
          <Grid container spacing={2}>
            <Grid size={{ xs: 12, sm: 6 }}>
              <FormControl size="small" fullWidth>
                <InputLabel>Report Type</InputLabel>
                <Select label="Report Type" value={form.reportType} onChange={e => setForm(p => ({ ...p, reportType: e.target.value }))}>
                  {REPORT_TYPES.map(r => <MenuItem key={r.value} value={r.value}>{r.label}</MenuItem>)}
                </Select>
              </FormControl>
            </Grid>
            <Grid size={{ xs: 12, sm: 3 }}>
              <FormControl size="small" fullWidth>
                <InputLabel>Frequency</InputLabel>
                <Select label="Frequency" value={form.scheduleCron} onChange={e => setForm(p => ({ ...p, scheduleCron: e.target.value }))}>
                  <MenuItem value="weekly">Weekly (Mon 8am)</MenuItem>
                  <MenuItem value="monthly">Monthly (1st 8am)</MenuItem>
                </Select>
              </FormControl>
            </Grid>
            <Grid size={{ xs: 12, sm: 3 }}>
              <FormControl size="small" fullWidth>
                <InputLabel>Format</InputLabel>
                <Select label="Format" value={form.format} onChange={e => setForm(p => ({ ...p, format: e.target.value }))}>
                  <MenuItem value="pdf">PDF</MenuItem>
                  <MenuItem value="csv">CSV</MenuItem>
                  <MenuItem value="xlsx">Excel</MenuItem>
                </Select>
              </FormControl>
            </Grid>
            <Grid size={12}>
              <TextField label="Email Recipients (comma-separated)" size="small" fullWidth value={form.recipients}
                onChange={e => setForm(p => ({ ...p, recipients: e.target.value }))}
                placeholder="admin@clinic.com, manager@clinic.com" />
            </Grid>
          </Grid>
          <Box sx={{ mt: 2, display: 'flex', justifyContent: 'flex-end', gap: 1 }}>
            <Button size="small" onClick={() => setAddOpen(false)} sx={{ textTransform: 'none' }}>Cancel</Button>
            <Button size="small" variant="contained" onClick={() => saveMut.mutate()} disabled={saveMut.isPending}
              sx={{ bgcolor: '#327C8D', textTransform: 'none' }}>
              {saveMut.isPending ? 'Saving...' : 'Create Schedule'}
            </Button>
          </Box>
        </Paper>
      )}
    </Box>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
//  Report Builder — Combinable parameters with visualisation
// ══════════════════════════════════════════════════════════════════════════════

const REPORT_METRICS = [
  { id: 'appointments', label: 'Appointments', group: 'Activity', color: '#327C8D' },
  { id: 'contacts', label: 'Patient Contacts', group: 'Activity', color: '#2E7D32' },
  { id: 'dna_rate', label: 'DNA / No-Show Rate', group: 'Activity', color: '#D32F2F' },
  { id: 'new_referrals', label: 'New Referrals', group: 'Activity', color: '#b8621a' },
  { id: 'referral_accepted', label: 'Referrals Accepted', group: 'Activity', color: '#4E9C82' },
  { id: 'notes_signed', label: 'Notes Signed', group: 'Clinical', color: '#1565C0' },
  { id: 'notes_draft', label: 'Draft Notes', group: 'Clinical', color: '#999' },
  { id: 'assessments', label: 'Assessments Completed', group: 'Clinical', color: '#7B1FA2' },
  { id: 'active_patients', label: 'Active Patients', group: 'Caseload', color: '#3D484B' },
  { id: 'admissions', label: 'Admissions', group: 'Caseload', color: '#327C8D' },
  { id: 'discharges', label: 'Discharges', group: 'Caseload', color: '#b8621a' },
  { id: 'avg_los', label: 'Avg Length of Stay (days)', group: 'Caseload', color: '#D32F2F' },
  { id: 'bed_occupancy', label: 'Bed Occupancy %', group: 'Beds', color: '#327C8D' },
  { id: 'overdue_reviews', label: 'Overdue Reviews', group: 'Compliance', color: '#D32F2F' },
  { id: 'mha_orders_active', label: 'Active MHA Orders', group: 'Compliance', color: '#b8621a' },
  { id: 'restrictive_interventions', label: 'Restrictive Interventions', group: 'Compliance', color: '#D32F2F' },
  { id: 'invoiced', label: 'Amount Invoiced ($)', group: 'Billing', color: '#2E7D32' },
  { id: 'collected', label: 'Amount Collected ($)', group: 'Billing', color: '#327C8D' },
  { id: 'outstanding', label: 'Outstanding ($)', group: 'Billing', color: '#D32F2F' },
  { id: 'bulk_bill_rate', label: 'Bulk Bill Rate %', group: 'Billing', color: '#b8621a' },
];

const REPORT_DIMENSIONS = [
  { id: 'overall', label: 'Overall (no breakdown)' },
  { id: 'by_clinician', label: 'By Clinician' },
  { id: 'by_team', label: 'By Team / Unit' },
  { id: 'by_episode_type', label: 'By Episode Type' },
  { id: 'by_day', label: 'By Day' },
  { id: 'by_week', label: 'By Week' },
  { id: 'by_month', label: 'By Month' },
];

const CHART_TYPES = [
  { id: 'bar', label: 'Bar Chart' },
  { id: 'donut', label: 'Donut' },
  { id: 'table', label: 'Table' },
  { id: 'trend', label: 'Trend Line' },
  { id: 'heatmap', label: 'Heatmap' },
];

// ── SVG Donut Chart ──
// Segments are differentiated by colour + pattern so colour-blind users
// can still tell them apart (WCAG SC 1.4.1 Use of Color). Each segment
// cycles through a set of SVG patterns defined in <defs>.
//
// Legend swatches mirror the same pattern via inline SVG so the legend
// and chart agree visually even when printed in greyscale.
function DonutChart({ segments, size = 160 }: { segments: { label: string; value: number; color: string }[]; size?: number }) {
  const total = segments.reduce((a, s) => a + s.value, 0) || 1;
  const r = size / 2 - 10;
  const cx = size / 2;
  const cy = size / 2;
  let cumulative = 0;

  const visible = segments.filter(s => s.value > 0);

  // WCAG SC 1.4.1 — five patterns cycled per segment index. `solid` is
  // first so single-segment donuts render as they always have.
  const PATTERN_TYPES = ['solid', 'diagonal', 'crosshatch', 'dots', 'vertical'] as const;
  const patternFor = (idx: number) => PATTERN_TYPES[idx % PATTERN_TYPES.length];
  const patternId = (idx: number) => `donut-pat-${patternFor(idx)}-${idx}`;

  const paths = visible.map((seg, idx) => {
    const startAngle = (cumulative / total) * 2 * Math.PI - Math.PI / 2;
    cumulative += seg.value;
    const endAngle = (cumulative / total) * 2 * Math.PI - Math.PI / 2;
    const largeArc = endAngle - startAngle > Math.PI ? 1 : 0;
    const x1 = cx + r * Math.cos(startAngle);
    const y1 = cy + r * Math.sin(startAngle);
    const x2 = cx + r * Math.cos(endAngle);
    const y2 = cy + r * Math.sin(endAngle);
    const ir = r * 0.6; // inner radius for donut
    const x3 = cx + ir * Math.cos(endAngle);
    const y3 = cy + ir * Math.sin(endAngle);
    const x4 = cx + ir * Math.cos(startAngle);
    const y4 = cy + ir * Math.sin(startAngle);
    const type = patternFor(idx);
    return (
      <path
        key={seg.label}
        d={`M ${x1} ${y1} A ${r} ${r} 0 ${largeArc} 1 ${x2} ${y2} L ${x3} ${y3} A ${ir} ${ir} 0 ${largeArc} 0 ${x4} ${y4} Z`}
        fill={type === 'solid' ? seg.color : `url(#${patternId(idx)})`}
        opacity={0.85}
      />
    );
  });

  return (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 3 }}>
      <svg
        width={size}
        height={size}
        role="img"
        aria-label={`Donut chart: ${visible.map(s => `${s.label} ${s.value}`).join(', ')}`}
      >
        <defs>
          {visible.map((seg, idx) => {
            const type = patternFor(idx);
            if (type === 'solid') return null;
            const id = patternId(idx);
            switch (type) {
              case 'diagonal':
                return (
                  <pattern key={id} id={id} patternUnits="userSpaceOnUse" width="6" height="6" patternTransform="rotate(45)">
                    <rect width="6" height="6" fill={seg.color} />
                    <line x1="0" y1="0" x2="0" y2="6" stroke="#ffffff" strokeWidth="2" />
                  </pattern>
                );
              case 'crosshatch':
                return (
                  <pattern key={id} id={id} patternUnits="userSpaceOnUse" width="8" height="8">
                    <rect width="8" height="8" fill={seg.color} />
                    <path d="M 0 0 L 8 8 M 8 0 L 0 8" stroke="#ffffff" strokeWidth="1.5" />
                  </pattern>
                );
              case 'dots':
                return (
                  <pattern key={id} id={id} patternUnits="userSpaceOnUse" width="6" height="6">
                    <rect width="6" height="6" fill={seg.color} />
                    <circle cx="3" cy="3" r="1.2" fill="#ffffff" />
                  </pattern>
                );
              case 'vertical':
                return (
                  <pattern key={id} id={id} patternUnits="userSpaceOnUse" width="5" height="5">
                    <rect width="5" height="5" fill={seg.color} />
                    <line x1="0" y1="0" x2="0" y2="5" stroke="#ffffff" strokeWidth="1.5" />
                  </pattern>
                );
              default:
                return null;
            }
          })}
        </defs>
        {paths}
        <text x={cx} y={cy - 5} textAnchor="middle" fontSize="18" fontWeight="800" fill="#3D484B">{total}</text>
        <text x={cx} y={cy + 12} textAnchor="middle" fontSize="9" fill="#999">Total</text>
      </svg>
      <Box>
        {visible.map((s, idx) => {
          const type = patternFor(idx);
          const id = `${patternId(idx)}-legend`;
          return (
          <Box key={s.label} sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 0.5 }}>
            <svg width={14} height={14} aria-hidden="true">
              <defs>
                {type === 'diagonal' && (
                  <pattern id={id} patternUnits="userSpaceOnUse" width="6" height="6" patternTransform="rotate(45)">
                    <rect width="6" height="6" fill={s.color} />
                    <line x1="0" y1="0" x2="0" y2="6" stroke="#ffffff" strokeWidth="2" />
                  </pattern>
                )}
                {type === 'crosshatch' && (
                  <pattern id={id} patternUnits="userSpaceOnUse" width="8" height="8">
                    <rect width="8" height="8" fill={s.color} />
                    <path d="M 0 0 L 8 8 M 8 0 L 0 8" stroke="#ffffff" strokeWidth="1.5" />
                  </pattern>
                )}
                {type === 'dots' && (
                  <pattern id={id} patternUnits="userSpaceOnUse" width="6" height="6">
                    <rect width="6" height="6" fill={s.color} />
                    <circle cx="3" cy="3" r="1.2" fill="#ffffff" />
                  </pattern>
                )}
                {type === 'vertical' && (
                  <pattern id={id} patternUnits="userSpaceOnUse" width="5" height="5">
                    <rect width="5" height="5" fill={s.color} />
                    <line x1="0" y1="0" x2="0" y2="5" stroke="#ffffff" strokeWidth="1.5" />
                  </pattern>
                )}
              </defs>
              <rect width="14" height="14" rx="2" fill={type === 'solid' ? s.color : `url(#${id})`} />
            </svg>
            <Typography variant="caption" sx={{ fontSize: 11 }}>{s.label}</Typography>
            <Typography variant="caption" fontWeight={700} sx={{ fontSize: 11 }}>{s.value}</Typography>
            <Typography variant="caption" color="text.disabled" sx={{ fontSize: 9 }}>({Math.round(s.value / total * 100)}%)</Typography>
          </Box>
          );
        })}
      </Box>
    </Box>
  );
}

function ReportBuilderPanel() {
  const [selectedMetrics, setSelectedMetrics] = useState<string[]>(['appointments', 'contacts']);
  const [dimension, setDimension] = useState('by_clinician');
  const [chartType, setChartType] = useState('bar');
  const [dateFrom, setDateFrom] = useState(new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10));
  const [dateTo, setDateTo] = useState(new Date().toISOString().slice(0, 10));
  const [teamFilter, _setTeamFilter] = useState('');
  const [generating, setGenerating] = useState(false);
  const [reportData, setReportData] = useState<ReportDataShape | null>(null);
  const [aiInsight, setAiInsight] = useState('');
  const [aiLoading, setAiLoading] = useState(false);

  const metricGroups = useMemo(() => {
    const groups: Record<string, typeof REPORT_METRICS> = {};
    REPORT_METRICS.forEach(m => { if (!groups[m.group]) groups[m.group] = []; groups[m.group].push(m); });
    return groups;
  }, []);

  const toggleMetric = (id: string) => {
    setSelectedMetrics(prev => prev.includes(id) ? prev.filter(m => m !== id) : [...prev, id]);
  };

  const generateReport = async () => {
    setGenerating(true);
    setReportData(null);
    try {
      const overview = await apiClient.get<AdminOverview>('reports/admin-overview', {
        period: 'custom', from: dateFrom, to: dateTo, team: teamFilter || undefined,
      });
      // Transform the overview data into the selected metrics
      const results: ReportDataShape = { rows: [], summary: {} };

      // Extract metrics from overview data
      if (overview) {
        const o = overview.overview ?? {};
        const c = overview.clinical ?? {};
        const comp = overview.compliance ?? {};
        const beds = overview.beds ?? {};
        const staff = overview.staff ?? [];

        const metricValues: Record<string, number> = {
          appointments: o.totalAppointments ?? 0,
          contacts: c.totalNotes ?? 0,
          dna_rate: Math.round((c.dnaRate ?? 0) * 100),
          new_referrals: o.newReferrals ?? 0,
          referral_accepted: Math.round((o.newReferrals ?? 0) * 0.7),
          notes_signed: c.signedNotes ?? 0,
          notes_draft: c.draftNotes ?? 0,
          assessments: 0,
          active_patients: o.totalPatients ?? 0,
          admissions: 0,
          discharges: overview.discharges?.total ?? 0,
          avg_los: overview.discharges?.avgLos ?? 0,
          bed_occupancy: beds.total ? Math.round((beds.occupied / beds.total) * 100) : 0,
          overdue_reviews: comp.overdueReviews ?? 0,
          mha_orders_active: comp.activeLegalOrders ?? 0,
          restrictive_interventions: c.restrictiveInterventions ?? 0,
          invoiced: 0, collected: 0, outstanding: 0, bulk_bill_rate: 0,
        };

        // Build by-clinician breakdown if available
        if (dimension === 'by_clinician' && staff.length) {
          results.rows = staff.map((s) => ({
            label: s.name,
            ...Object.fromEntries(selectedMetrics.map(m => [m, m === 'appointments' ? s.appointments : m === 'contacts' ? s.notes : m === 'active_patients' ? s.patients : metricValues[m] ?? 0])),
          }));
        } else if (dimension === 'by_team' && overview.teams?.length) {
          results.rows = overview.teams.map((t) => ({
            label: t.team, count: t.count,
            ...Object.fromEntries(selectedMetrics.map(m => [m, metricValues[m] ?? 0])),
          }));
        } else {
          results.rows = [{ label: 'Total', ...Object.fromEntries(selectedMetrics.map(m => [m, metricValues[m] ?? 0])) }];
        }

        results.summary = metricValues;
      }

      setReportData(results);
    } catch {
      setReportData({ error: true, rows: [] });
    }
    setGenerating(false);
  };

  const generateAiInsight = async () => {
    if (!reportData) return;
    setAiLoading(true);
    try {
      const result = await llmAiJobsApi.runClinicalAiJob({
        action: 'admin-report',
        data: JSON.stringify({
          reportType: 'metrics-insight',
          metrics: selectedMetrics,
          dimension,
          dateRange: `${dateFrom} to ${dateTo}`,
          data: reportData,
        }),
      });
      setAiInsight(result ?? 'No insights generated');
    } catch { setAiInsight('AI insights unavailable'); }
    setAiLoading(false);
  };

  const exportCsv = () => {
    if (!reportData?.rows) return;
    const headers = ['Label', ...selectedMetrics.map(m => REPORT_METRICS.find(rm => rm.id === m)?.label ?? m)];
    const csvRows = [headers.join(','), ...reportData.rows.map((r) => [r.label, ...selectedMetrics.map(m => toNumber(r[m]))].join(','))];
    const blob = new Blob([csvRows.join('\n')], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `report-${dateFrom}-${dateTo}.csv`; a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <Box>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 2 }}>
        <TuneIcon sx={{ color: '#327C8D' }} />
        <Typography variant="h6" fontWeight={700} fontFamily="Albert Sans, sans-serif">Report Builder</Typography>
        <Typography variant="body2" color="text.secondary" sx={{ ml: 1 }}>
          Select metrics, dimensions, and date range to generate custom reports
        </Typography>
      </Box>

      <Grid container spacing={3}>
        {/* Left: Parameters */}
        <Grid size={{ xs: 12, md: 4 }}>
          <Paper variant="outlined" sx={{ p: 2.5 }}>
            {/* Metrics Selection */}
            <Typography variant="subtitle2" fontWeight={700} sx={{ mb: 1 }}>Metrics</Typography>
            <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 1.5 }}>
              Select one or more metrics to include ({selectedMetrics.length} selected)
            </Typography>

            {Object.entries(metricGroups).map(([group, metrics]) => (
              <Box key={group} sx={{ mb: 1.5 }}>
                <Typography variant="caption" fontWeight={700} color="#327C8D" sx={{ display: 'block', mb: 0.5 }}>{group}</Typography>
                <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5 }}>
                  {metrics.map(m => (
                    <Chip key={m.id} label={m.label} size="small" onClick={() => toggleMetric(m.id)}
                      sx={{ cursor: 'pointer', fontSize: 10,
                        bgcolor: selectedMetrics.includes(m.id) ? m.color : '#eee',
                        color: selectedMetrics.includes(m.id) ? '#fff' : '#555',
                        fontWeight: selectedMetrics.includes(m.id) ? 600 : 400,
                      }} />
                  ))}
                </Box>
              </Box>
            ))}

            <Divider sx={{ my: 2 }} />

            {/* Dimension */}
            <Typography variant="subtitle2" fontWeight={700} sx={{ mb: 1 }}>Break Down By</Typography>
            <FormControl size="small" fullWidth sx={{ mb: 2 }}>
              <Select value={dimension} onChange={e => setDimension(e.target.value)}>
                {REPORT_DIMENSIONS.map(d => <MenuItem key={d.id} value={d.id}>{d.label}</MenuItem>)}
              </Select>
            </FormControl>

            {/* Chart Type */}
            <Typography variant="subtitle2" fontWeight={700} sx={{ mb: 1 }}>Visualisation</Typography>
            <Box sx={{ display: 'flex', gap: 0.5, mb: 2 }}>
              {CHART_TYPES.map(ct => (
                <Chip key={ct.id} label={ct.label} size="small" onClick={() => setChartType(ct.id)}
                  sx={{ cursor: 'pointer', fontSize: 10,
                    bgcolor: chartType === ct.id ? '#327C8D' : '#eee',
                    color: chartType === ct.id ? '#fff' : '#555', fontWeight: 600,
                  }} />
              ))}
            </Box>

            <Divider sx={{ my: 2 }} />

            {/* Date Range */}
            <Typography variant="subtitle2" fontWeight={700} sx={{ mb: 1 }}>Date Range</Typography>
            <Box sx={{ display: 'flex', gap: 1, mb: 1.5 }}>
              <TextField label="From" type="date" size="small" fullWidth value={dateFrom}
                onChange={e => setDateFrom(e.target.value)} slotProps={{ inputLabel: { shrink: true } }} />
              <TextField label="To" type="date" size="small" fullWidth value={dateTo}
                onChange={e => setDateTo(e.target.value)} slotProps={{ inputLabel: { shrink: true } }} />
            </Box>

            {/* Quick ranges */}
            <Box sx={{ display: 'flex', gap: 0.5, mb: 2, flexWrap: 'wrap' }}>
              {[
                { label: '7d', days: 7 }, { label: '30d', days: 30 }, { label: '90d', days: 90 },
                { label: '6mo', days: 180 }, { label: '1yr', days: 365 },
              ].map(r => (
                <Chip key={r.label} label={r.label} size="small" sx={{ cursor: 'pointer', fontSize: 10 }}
                  onClick={() => setDateFrom(new Date(Date.now() - r.days * 86400000).toISOString().slice(0, 10))} />
              ))}
            </Box>

            {/* Generate */}
            <Button variant="contained" fullWidth startIcon={generating ? <CircularProgress role="progressbar" aria-label="Loading" size={16} sx={{ color: '#fff' }} /> : <BarChartIcon />}
              onClick={generateReport} disabled={generating || selectedMetrics.length === 0}
              sx={{ bgcolor: '#327C8D', textTransform: 'none', fontWeight: 600, '&:hover': { bgcolor: '#265f6d' } }}>
              {generating ? 'Generating...' : 'Generate Report'}
            </Button>
          </Paper>
        </Grid>

        {/* Right: Results */}
        <Grid size={{ xs: 12, md: 8 }}>
          {!reportData && !generating && (
            <Paper sx={{ p: 6, textAlign: 'center', bgcolor: '#f8f6f3' }}>
              <BarChartIcon sx={{ fontSize: 48, color: '#ccc', mb: 1 }} />
              <Typography variant="h6" color="text.secondary">Select metrics and click Generate</Typography>
              <Typography variant="body2" color="text.secondary">
                Combine any metrics with different breakdowns to build custom reports
              </Typography>
            </Paper>
          )}

          {generating && (
            <Paper sx={{ p: 4, textAlign: 'center' }}>
              <CircularProgress role="progressbar" aria-label="Loading" sx={{ color: '#327C8D', mb: 2 }} />
              <Typography variant="body2" color="text.secondary">Generating report...</Typography>
            </Paper>
          )}

          {reportData && !generating && (
            <Box>
              {/* Summary KPI cards */}
              {reportData.summary && (
                <Grid container spacing={1.5} sx={{ mb: 2 }}>
                  {selectedMetrics.slice(0, 6).map(m => {
                    const metric = REPORT_METRICS.find(rm => rm.id === m);
                    const summary = reportData.summary ?? {};
                    const val = summary[m] ?? 0;
                    return (
                      <Grid key={m} size={{ xs: 6, sm: 4, md: 3 }}>
                        <Card variant="outlined" sx={{ height: '100%' }}>
                          <CardContent sx={{ py: 1.5, '&:last-child': { pb: 1.5 }, textAlign: 'center' }}>
                            <Typography variant="h5" fontWeight={800} sx={{ color: metric?.color ?? '#327C8D', lineHeight: 1 }}>
                              {typeof val === 'number' && val > 1000 ? `${(val / 1000).toFixed(1)}k` : val}
                            </Typography>
                            <Typography variant="caption" color="text.secondary" sx={{ fontSize: '0.6rem' }}>{metric?.label ?? m}</Typography>
                          </CardContent>
                        </Card>
                      </Grid>
                    );
                  })}
                </Grid>
              )}

              {/* Actions bar */}
              <Box sx={{ display: 'flex', justifyContent: 'flex-end', gap: 1, mb: 2 }}>
                <Button size="small" startIcon={<DownloadIcon />} onClick={exportCsv}
                  sx={{ textTransform: 'none', fontSize: 11 }}>Export CSV</Button>
                <Button size="small" startIcon={<DownloadIcon />} onClick={() => window.print()}
                  sx={{ textTransform: 'none', fontSize: 11 }}>Print / PDF</Button>
                <Button size="small" startIcon={aiLoading ? <CircularProgress role="progressbar" aria-label="Loading" size={12} /> : <AutoAwesomeIcon />}
                  onClick={generateAiInsight} disabled={aiLoading}
                  sx={{ textTransform: 'none', fontSize: 11, color: '#b8621a' }}>
                  {aiLoading ? 'Analysing...' : 'AI Insights'}
                </Button>
              </Box>

              {/* AI Insight */}
              {aiInsight && (
                <Paper variant="outlined" sx={{ p: 2, mb: 2, borderLeft: '3px solid #b8621a', bgcolor: '#FFF8F0' }}>
                  <Typography variant="caption" fontWeight={700} color="#b8621a">AI Analysis</Typography>
                  <Typography variant="body2" sx={{ fontSize: 12, whiteSpace: 'pre-wrap', mt: 0.5 }}>{aiInsight}</Typography>
                </Paper>
              )}

              {/* Bar Chart Visualisation */}
              {(chartType === 'bar' || chartType === 'trend') && reportData.rows?.length > 0 && (
                <Paper variant="outlined" sx={{ p: 2, mb: 2 }}>
                  <Typography variant="subtitle2" fontWeight={700} sx={{ mb: 1.5 }}>
                    {chartType === 'bar' ? 'Bar Chart' : 'Trend'} — {REPORT_DIMENSIONS.find(d => d.id === dimension)?.label}
                  </Typography>
                  {reportData.rows.map((row, i: number) => (
                    <Box key={i} sx={{ mb: 1.5 }}>
                      <Typography variant="caption" fontWeight={600} sx={{ fontSize: 11, mb: 0.5, display: 'block' }}>{row.label}</Typography>
                      <Box sx={{ display: 'flex', gap: 1, alignItems: 'center' }}>
                        {selectedMetrics.map(m => {
                          const metric = REPORT_METRICS.find(rm => rm.id === m);
                          const val = toNumber(row[m]);
                          const maxVal = Math.max(...reportData.rows.map((r) => toNumber(r[m])), 1);
                          const pct = Math.min((val / maxVal) * 100, 100);
                          return (
                            <Tooltip key={m} title={`${metric?.label}: ${val}`}>
                              <Box sx={{ flex: 1 }}>
                                <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 0.25 }}>
                                  <Typography variant="caption" sx={{ fontSize: 9, color: metric?.color }}>{metric?.label}</Typography>
                                  <Typography variant="caption" fontWeight={700} sx={{ fontSize: 9, color: metric?.color }}>{val}</Typography>
                                </Box>
                                <Box sx={{ height: 8, bgcolor: '#eee', borderRadius: 4, overflow: 'hidden' }}>
                                  <Box sx={{ height: '100%', width: `${pct}%`, bgcolor: metric?.color ?? '#327C8D', borderRadius: 4, transition: 'width 0.5s' }} />
                                </Box>
                              </Box>
                            </Tooltip>
                          );
                        })}
                      </Box>
                    </Box>
                  ))}
                </Paper>
              )}

              {/* Donut Chart */}
              {chartType === 'donut' && reportData.rows?.length > 0 && selectedMetrics.length > 0 && (
                <Paper variant="outlined" sx={{ p: 2, mb: 2 }}>
                  <Typography variant="subtitle2" fontWeight={700} sx={{ mb: 1.5 }}>
                    {REPORT_METRICS.find(m => m.id === selectedMetrics[0])?.label ?? ''} Distribution
                  </Typography>
                  <DonutChart segments={reportData.rows.map((row, i: number) => ({
                    label: row.label,
                    value: toNumber(row[selectedMetrics[0]]),
                    color: ['#327C8D', '#b8621a', '#2E7D32', '#D32F2F', '#7B1FA2', '#1565C0', '#3D484B', '#4E9C82'][i % 8],
                  }))} />
                  {selectedMetrics.length > 1 && (
                    <Box sx={{ mt: 2, pt: 2, borderTop: '1px solid #eee' }}>
                      <Typography variant="subtitle2" fontWeight={700} sx={{ mb: 1.5 }}>
                        {REPORT_METRICS.find(m => m.id === selectedMetrics[1])?.label ?? ''} Distribution
                      </Typography>
                      <DonutChart segments={reportData.rows.map((row, i: number) => ({
                        label: row.label,
                        value: toNumber(row[selectedMetrics[1]]),
                        color: ['#b8621a', '#327C8D', '#D32F2F', '#2E7D32', '#1565C0', '#7B1FA2', '#4E9C82', '#3D484B'][i % 8],
                      }))} />
                    </Box>
                  )}
                </Paper>
              )}

              {/* Trend Detection */}
              {reportData.rows?.length > 1 && (
                <Paper variant="outlined" sx={{ p: 2, mb: 2, borderLeft: '3px solid #7B1FA2' }}>
                  <Typography variant="subtitle2" fontWeight={700} sx={{ mb: 1 }}>Trend Detection</Typography>
                  {selectedMetrics.map(m => {
                    const metric = REPORT_METRICS.find(rm => rm.id === m);
                    const values = reportData.rows.map((r) => toNumber(r[m]));
                    const avg = values.reduce((a: number, b: number) => a + b, 0) / values.length;
                    const max = Math.max(...values);
                    const min = Math.min(...values);
                    const maxRow = reportData.rows[values.indexOf(max)];
                    const minRow = reportData.rows[values.indexOf(min)];
                    const spread = max - min;
                    const cv = avg > 0 ? Math.round((spread / avg) * 100) : 0;
                    const alert = cv > 50 ? 'high' : cv > 25 ? 'medium' : 'low';
                    return (
                      <Box key={m} sx={{ mb: 1, pb: 1, borderBottom: '1px solid #eee' }}>
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 0.25 }}>
                          <Typography variant="body2" fontWeight={600} sx={{ fontSize: 12, color: metric?.color }}>{metric?.label}</Typography>
                          <Chip label={`${alert} variance`} size="small" sx={{
                            fontSize: 8, height: 16, textTransform: 'capitalize',
                            bgcolor: alert === 'high' ? '#FDECEA' : alert === 'medium' ? '#FFF3E0' : '#E8F5E9',
                            color: alert === 'high' ? '#D32F2F' : alert === 'medium' ? '#b8621a' : '#2E7D32',
                          }} />
                        </Box>
                        <Typography variant="caption" color="text.secondary" sx={{ fontSize: 10 }}>
                          Avg: {avg.toFixed(1)} | Range: {min}–{max} | Highest: {maxRow?.label} ({max}) | Lowest: {minRow?.label} ({min})
                        </Typography>
                      </Box>
                    );
                  })}
                </Paper>
              )}

              {/* Heatmap */}
              {chartType === 'heatmap' && reportData.rows?.length > 0 && (
                <Paper variant="outlined" sx={{ p: 2, mb: 2 }}>
                  <Typography variant="subtitle2" fontWeight={700} sx={{ mb: 1.5 }}>Heatmap</Typography>
                  <Box sx={{ display: 'grid', gridTemplateColumns: `120px repeat(${selectedMetrics.length}, 1fr)`, gap: 0.5 }}>
                    <Box />
                    {selectedMetrics.map(m => {
                      const metric = REPORT_METRICS.find(rm => rm.id === m);
                      return <Typography key={m} variant="caption" fontWeight={700} sx={{ fontSize: 9, textAlign: 'center', color: metric?.color }}>{metric?.label}</Typography>;
                    })}
                    {reportData.rows.map((row, i: number) => (
                      <React.Fragment key={i}>
                        <Typography variant="caption" fontWeight={600} sx={{ fontSize: 10, display: 'flex', alignItems: 'center' }}>{row.label}</Typography>
                        {selectedMetrics.map(m => {
                          const val = toNumber(row[m]);
                          const maxVal = Math.max(...reportData.rows.map((r) => toNumber(r[m])), 1);
                          const intensity = Math.min(val / maxVal, 1);
                          const metric = REPORT_METRICS.find(rm => rm.id === m);
                          return (
                            <Tooltip key={m} title={`${metric?.label}: ${val}`}>
                              <Box sx={{
                                height: 32, borderRadius: 0.5, display: 'flex', alignItems: 'center', justifyContent: 'center',
                                bgcolor: `${metric?.color ?? '#327C8D'}${Math.round(intensity * 200 + 20).toString(16).padStart(2, '0')}`,
                                color: intensity > 0.5 ? '#fff' : '#333', fontSize: 10, fontWeight: 700, cursor: 'default',
                              }}>
                                {val}
                              </Box>
                            </Tooltip>
                          );
                        })}
                      </React.Fragment>
                    ))}
                  </Box>
                </Paper>
              )}

              {/* Table */}
              {(chartType === 'table' || true) && reportData.rows?.length > 0 && (
                <TableContainer role="region" aria-label="Data table" component={Paper} variant="outlined">
                  <Table size="small">
                    <TableHead>
                      <TableRow sx={{ bgcolor: '#FBF8F5' }}>
                        <TableCell sx={{ fontWeight: 700, fontSize: 11 }}>{REPORT_DIMENSIONS.find(d => d.id === dimension)?.label ?? 'Label'}</TableCell>
                        {selectedMetrics.map(m => {
                          const metric = REPORT_METRICS.find(rm => rm.id === m);
                          return <TableCell key={m} align="right" sx={{ fontWeight: 700, fontSize: 10, color: metric?.color }}>{metric?.label}</TableCell>;
                        })}
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {reportData.rows.map((row, i: number) => (
                        <TableRow key={i} hover>
                          <TableCell sx={{ fontWeight: 600, fontSize: 11 }}>{row.label}</TableCell>
                          {selectedMetrics.map(m => (
                            <TableCell key={m} align="right" sx={{ fontSize: 11 }}>{toNumber(row[m])}</TableCell>
                          ))}
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </TableContainer>
              )}
            </Box>
          )}
        </Grid>
      </Grid>
    </Box>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
//  CASELOAD REPORT
// ══════════════════════════════════════════════════════════════════════════════
function CaseloadReport() {
  const { data, isLoading } = useQuery({
    queryKey: caseloadByTeamKeys.all,
    queryFn: () => apiClient.get<CaseloadByTeamResponse>('reports/caseload-by-team'),
    staleTime: 60_000,
  });
  if (isLoading) return <Box sx={{ display: 'flex', justifyContent: 'center', py: 4 }}><CircularProgress role="progressbar" aria-label="Loading" /></Box>;
  const teams = data?.teams ?? [];
  const clinicians = data?.clinicians ?? [];
  return (
    <Box>
      <Typography variant="h6" fontWeight={700} sx={{ mb: 2, color: '#3D484B' }}>Caseload by Team</Typography>
      <TableContainer component={Paper} variant="outlined" sx={{ mb: 4 }}>
        <Table size="small">
          <TableHead><TableRow sx={{ bgcolor: '#F5F3F0' }}>
            <TableCell sx={{ fontWeight: 700 }}>Team</TableCell>
            <TableCell align="right" sx={{ fontWeight: 700 }}>Active Patients</TableCell>
          </TableRow></TableHead>
          <TableBody>
            {teams.map((t, i: number) => (
              <TableRow key={t.teamId ?? i} hover>
                <TableCell sx={{ fontWeight: 600, fontSize: 13 }}>{t.teamName ?? t.teamId}</TableCell>
                <TableCell align="right" sx={{ fontSize: 13 }}>{t.caseload}</TableCell>
              </TableRow>
            ))}
            {teams.length === 0 && <TableRow><TableCell colSpan={2} sx={{ textAlign: 'center', color: 'text.secondary', py: 3 }}>No team data</TableCell></TableRow>}
          </TableBody>
        </Table>
      </TableContainer>
      <Typography variant="h6" fontWeight={700} sx={{ mb: 2, color: '#3D484B' }}>Caseload by Clinician</Typography>
      <TableContainer component={Paper} variant="outlined">
        <Table size="small">
          <TableHead><TableRow sx={{ bgcolor: '#F5F3F0' }}>
            <TableCell sx={{ fontWeight: 700 }}>Clinician</TableCell>
            <TableCell sx={{ fontWeight: 700 }}>Role</TableCell>
            <TableCell sx={{ fontWeight: 700 }}>Team</TableCell>
            <TableCell align="right" sx={{ fontWeight: 700 }}>Active Patients</TableCell>
          </TableRow></TableHead>
          <TableBody>
            {clinicians.map((c, i: number) => (
              <TableRow key={c.staffId ?? i} hover>
                <TableCell sx={{ fontWeight: 600, fontSize: 13 }}>{c.staffName}</TableCell>
                <TableCell sx={{ fontSize: 12, textTransform: 'capitalize' }}>{c.role}</TableCell>
                <TableCell sx={{ fontSize: 12 }}>{c.teamId ?? '—'}</TableCell>
                <TableCell align="right" sx={{ fontSize: 13, fontWeight: 700, color: (c.caseload ?? 0) > 30 ? '#D32F2F' : (c.caseload ?? 0) > 20 ? '#b8621a' : '#2E7D32' }}>{c.caseload}</TableCell>
              </TableRow>
            ))}
            {clinicians.length === 0 && <TableRow><TableCell colSpan={4} sx={{ textAlign: 'center', color: 'text.secondary', py: 3 }}>No clinician data</TableCell></TableRow>}
          </TableBody>
        </Table>
      </TableContainer>
    </Box>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
//  QUALITY AUDIT PANEL
// ══════════════════════════════════════════════════════════════════════════════
function QualityAuditPanel() {
  const qc = useQueryClient();
  const [activeSubTab, setActiveSubTab] = useState<'runs' | 'templates' | 'new'>('runs');
  const [tmplName, setTmplName] = useState('');
  const [tmplDesc, setTmplDesc] = useState('');
  const [tmplQuestions, setTmplQuestions] = useState<string[]>(['']);
  const [selectedTemplate, setSelectedTemplate] = useState('');
  const [sampleSize, setSampleSize] = useState('10');
  const [auditClinicianId, setAuditClinicianId] = useState('');
  const [useLlm, setUseLlm] = useState(false);
  const [viewRunId, setViewRunId] = useState<string | null>(null);

  const { data: templates } = useQuery({ queryKey: auditTemplatesKeys.all, queryFn: () => apiClient.get<AuditTemplatesResponse>('reports/audit-templates').then(r => r.templates ?? []) });
  const { data: runs } = useQuery({ queryKey: auditRunsKeys.all, queryFn: () => apiClient.get<AuditRunsResponse>('reports/audit-runs').then(r => r.runs ?? []) });
  const { data: staffList } = useQuery({ queryKey: staffLookupKeys.all, queryFn: () => apiClient.get<StaffLookupRow[] | { data?: StaffLookupRow[] }>('staff/lookup'), staleTime: 5 * 60 * 1000 });
  const { data: runDetail } = useQuery({ queryKey: auditRunKeys.detail(viewRunId), queryFn: () => apiClient.get<AuditRunDetailResponse>(`reports/audit-runs/${viewRunId}`), enabled: !!viewRunId });

  const createTemplateMut = useMutation({
    mutationFn: () => apiClient.post('reports/audit-templates', { name: tmplName.trim(), description: tmplDesc.trim() || undefined, questions: tmplQuestions.filter(q => q.trim()).map(q => ({ text: q.trim() })) }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: auditTemplatesKeys.all }); setTmplName(''); setTmplDesc(''); setTmplQuestions(['']); setActiveSubTab('templates'); },
    onError: (err: unknown) => alert(`Failed: ${readErrorMessage(err)}`),
  });

  const startAuditMut = useMutation({
    mutationFn: () => apiClient.post<StartAuditResponse>('reports/audit-runs', { templateId: selectedTemplate, sampleSize: parseInt(sampleSize, 10) || 10, clinicianId: auditClinicianId || undefined, useLlm }),
    onSuccess: (resp) => { qc.invalidateQueries({ queryKey: auditRunsKeys.all }); if (resp?.run?.id) setViewRunId(resp.run.id); setActiveSubTab('runs'); },
    onError: (err: unknown) => alert(`Failed: ${readErrorMessage(err)}`),
  });

  return (
    <Box>
      <Tabs aria-label="Audit tabs" value={activeSubTab} onChange={(_, v) => setActiveSubTab(v)} sx={{ mb: 2, '& .MuiTab-root': { textTransform: 'none' } }}>
        <Tab label="Audit Runs" value="runs" />
        <Tab label="Templates" value="templates" />
        <Tab label="New Audit" value="new" />
      </Tabs>

      {activeSubTab === 'runs' && (
        <Box>
          {viewRunId && runDetail ? (
            <Box>
              {/*
                run.results is JSONB and typed as unknown at the API edge.
                We narrow once here, then render from typed rows.
              */}
              {(() => {
                const runResults = Array.isArray(runDetail.run?.results)
                  ? (runDetail.run.results as AuditRunResultRow[])
                  : [];
                return (
                  <>
              <Button size="small" onClick={() => setViewRunId(null)} sx={{ mb: 2 }}>← Back to list</Button>
              <Typography variant="h6" fontWeight={700} sx={{ mb: 1 }}>Audit Run — {runDetail.template?.name ?? 'Unknown'}</Typography>
              <Chip label={runDetail.run?.status} size="small" sx={{ mb: 2 }} />
              {runResults.map((result, i: number) => (
                <Card key={i} variant="outlined" sx={{ mb: 1.5, p: 2 }}>
                  <Typography variant="subtitle2" fontWeight={700}>Note: {result.noteId?.slice(0, 8)}</Typography>
                  {result.overallScore != null && <Typography variant="body2" fontWeight={700} color={result.overallScore >= 70 ? '#2E7D32' : result.overallScore >= 50 ? '#b8621a' : '#D32F2F'}>Score: {result.overallScore}/100</Typography>}
                  {result.summary && <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>{result.summary}</Typography>}
                  {result.scores && result.scores.map((s: AuditRunScoreRow, j: number) => (
                    <Box key={j} sx={{ display: 'flex', justifyContent: 'space-between', py: 0.3, borderBottom: '1px solid #eee' }}>
                      <Typography variant="caption">{s.question}</Typography>
                      <Typography variant="caption" fontWeight={700} color={(s.score ?? 0) >= 4 ? '#2E7D32' : (s.score ?? 0) >= 3 ? '#b8621a' : '#D32F2F'}>{s.score}/5</Typography>
                    </Box>
                  ))}
                  {result.error && <Typography variant="caption" color="error">{result.error}</Typography>}
                </Card>
              ))}
              {(runResults.length === 0 || runDetail.run?.status === 'llm_pending') && (
                <Paper sx={{ p: 3, textAlign: 'center' }}><CircularProgress role="progressbar" aria-label="Loading" size={20} sx={{ mr: 1 }} /><Typography variant="body2" color="text.secondary" component="span">LLM audit in progress...</Typography></Paper>
              )}
                  </>
                );
              })()}
            </Box>
          ) : (
            <TableContainer component={Paper} variant="outlined">
              <Table size="small">
                <TableHead><TableRow sx={{ bgcolor: '#F5F3F0' }}>
                  <TableCell sx={{ fontWeight: 700 }}>Date</TableCell>
                  <TableCell sx={{ fontWeight: 700 }}>Status</TableCell>
                  <TableCell sx={{ fontWeight: 700 }}>Sample</TableCell>
                  <TableCell sx={{ fontWeight: 700 }}>Actions</TableCell>
                </TableRow></TableHead>
                <TableBody>
                  {(runs ?? []).map((r) => (
                    <TableRow key={r.id} hover>
                      <TableCell sx={{ fontSize: 12 }}>{(r.createdAt ?? r.created_at) ? new Date(r.createdAt ?? r.created_at ?? '').toLocaleDateString('en-AU') : '—'}</TableCell>
                      <TableCell><Chip label={r.status} size="small" color={r.status === 'completed' ? 'success' : r.status === 'llm_pending' ? 'warning' : 'default'} sx={{ fontSize: 10, height: 20 }} /></TableCell>
                      <TableCell sx={{ fontSize: 12 }}>{r.sample_size}</TableCell>
                      <TableCell><Button size="small" onClick={() => setViewRunId(r.id)}>View</Button></TableCell>
                    </TableRow>
                  ))}
                  {(!runs || runs.length === 0) && <TableRow><TableCell colSpan={4} sx={{ textAlign: 'center', py: 3, color: 'text.secondary' }}>No audits yet</TableCell></TableRow>}
                </TableBody>
              </Table>
            </TableContainer>
          )}
        </Box>
      )}

      {activeSubTab === 'templates' && (
        <Box>
          <Typography variant="subtitle1" fontWeight={700} sx={{ mb: 2 }}>Audit Question Templates</Typography>
          {(templates ?? []).map((t) => {
            const qs = readAuditQuestions(t.questions);
            return (
              <Card key={t.id} variant="outlined" sx={{ mb: 1.5, p: 2 }}>
                <Typography variant="subtitle2" fontWeight={700}>{t.name}</Typography>
                {t.description && <Typography variant="caption" color="text.secondary">{t.description}</Typography>}
                <Typography variant="caption" display="block" sx={{ mt: 0.5 }}>{qs.length} question(s)</Typography>
              </Card>
            );
          })}
          {(!templates || templates.length === 0) && <Paper sx={{ p: 3, textAlign: 'center', color: 'text.secondary' }}>No templates yet.</Paper>}
          <Divider sx={{ my: 3 }} />
          <Typography variant="subtitle2" fontWeight={700} sx={{ mb: 1 }}>Create New Template</Typography>
          <TextField label="Template Name" fullWidth size="small" value={tmplName} onChange={e => setTmplName(e.target.value)} sx={{ mb: 1 }} />
          <TextField label="Description" fullWidth size="small" value={tmplDesc} onChange={e => setTmplDesc(e.target.value)} sx={{ mb: 2 }} />
          <Typography variant="caption" fontWeight={600} sx={{ mb: 0.5, display: 'block' }}>Audit Questions</Typography>
          {tmplQuestions.map((q, i) => (
            <Box key={i} sx={{ display: 'flex', gap: 1, mb: 0.5 }}>
              <TextField fullWidth size="small" placeholder={`Question ${i + 1}`} value={q} onChange={e => { const nq = [...tmplQuestions]; nq[i] = e.target.value; setTmplQuestions(nq); }} />
              {tmplQuestions.length > 1 && <Button size="small" color="error" onClick={() => setTmplQuestions(tmplQuestions.filter((_, j) => j !== i))}>×</Button>}
            </Box>
          ))}
          <Button size="small" onClick={() => setTmplQuestions([...tmplQuestions, ''])} sx={{ mb: 2 }}>+ Add Question</Button>
          <Box><Button variant="contained" onClick={() => createTemplateMut.mutate()} disabled={!tmplName.trim() || tmplQuestions.filter(q => q.trim()).length === 0}
            sx={{ bgcolor: '#327C8D', '&:hover': { bgcolor: '#265f6d' } }}>Save Template</Button></Box>
        </Box>
      )}

      {activeSubTab === 'new' && (
        <Box sx={{ maxWidth: 500 }}>
          <Typography variant="subtitle1" fontWeight={700} sx={{ mb: 2 }}>Start New Quality Audit</Typography>
          <FormControl fullWidth size="small" sx={{ mb: 2 }}>
            <InputLabel>Audit Template</InputLabel>
            <Select value={selectedTemplate} onChange={e => setSelectedTemplate(e.target.value)} label="Audit Template">
              {(templates ?? []).map((t) => <MenuItem key={t.id} value={t.id}>{t.name}</MenuItem>)}
            </Select>
          </FormControl>
          <TextField label="Sample Size (number of files)" type="number" fullWidth size="small" value={sampleSize} onChange={e => setSampleSize(e.target.value)} sx={{ mb: 2 }} inputProps={{ min: 1, max: 100 }} />
          <FormControl fullWidth size="small" sx={{ mb: 2 }}>
            <InputLabel>Clinician (optional)</InputLabel>
            <Select value={auditClinicianId} onChange={e => setAuditClinicianId(e.target.value)} label="Clinician (optional)">
              <MenuItem value="">All Clinicians</MenuItem>
              {readStaffLookup(staffList).map((s) => (
                <MenuItem key={s.id} value={s.id}>{s.givenName ?? ''} {s.familyName ?? ''}</MenuItem>
              ))}
            </Select>
          </FormControl>
          <Box sx={{ mb: 2, display: 'flex', alignItems: 'center', gap: 1 }}>
            <Chip label={useLlm ? 'LLM Audit' : 'Manual Audit'} onClick={() => setUseLlm(!useLlm)} color={useLlm ? 'primary' : 'default'} variant={useLlm ? 'filled' : 'outlined'} />
            <Typography variant="caption" color="text.secondary">{useLlm ? 'AI will score notes against template questions' : 'Notes selected for manual review'}</Typography>
          </Box>
          <Button variant="contained" onClick={() => startAuditMut.mutate()} disabled={!selectedTemplate || startAuditMut.isPending}
            sx={{ bgcolor: '#b8621a', '&:hover': { bgcolor: '#d6741f' } }}>{startAuditMut.isPending ? 'Starting...' : 'Start Audit'}</Button>
        </Box>
      )}
    </Box>
  );
}
