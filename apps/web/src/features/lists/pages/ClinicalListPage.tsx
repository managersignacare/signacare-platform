import SearchIcon from '@mui/icons-material/Search';
import {
    Alert, Box, Button, ButtonBase, CircularProgress, FormControl, InputAdornment, InputLabel, MenuItem, Paper, Select, Table, TableBody, TableCell,
    TableContainer, TableHead, TablePagination, TableRow, TextField, Typography
} from '@mui/material';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import React, { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ListExportBar } from '../../../shared/components/ui/ListExportBar';
import { apiClient } from '../../../shared/services/apiClient';
import { useOrgTree } from '../../org-settings/hooks/useOrgSettings';
import type { OrgUnit } from '../../org-settings/services/orgSettingsApi';
import { listsCrossFeatureKeys } from '../queryKeys';
import { DEFAULT_CLINIC_TIME_ZONE, LAI_OVERDUE_GRACE_DAYS } from '@signacare/shared';
import {
  isInDueBucket,
  dueDateForRow,
  overdueGraceDaysFor,
  computeListCountTiles,
} from '../../../shared/utils/dueDateBuckets';
import { compute91DayReviewCycle } from '../../../shared/utils/reviewCycle';

// Per-listKey policy (dueDateForRow / overdueGraceDaysFor) and the count-
// tile builder live in the shared SSoT util `dueDateBuckets.ts` (plan
// PART 6 DoD#7). The page imports them so the count cards and the date-
// range filter cannot drift apart.

interface TeamAssignmentPayload {
  assignment_id?: string | null;
  assignmentId?: string | null;
  patient_id?: string | null;
  patientid?: string | null;
  orgunitname?: string | null;
  org_unit_name?: string | null;
  clinicianname?: string | null;
  clinicianName?: string | null;
  referral_status?: string | null;
}

interface PatientListPayload {
  id: string;
  givenName: string;
  familyName: string;
  dateOfBirth?: string | null;
  emrNumber?: string | null;
  status?: string | null;
  latestEpisodeStart?: string | null;
  createdAt?: string | null;
}

interface ClinicalListRow {
  id: string; // patient id
  assignmentId?: string | null;
  rowKey: string;
  givenName: string;
  familyName: string;
  dob: string | null;
  emrNumber: string | null;
  status: string;
  teamName: string;
  clinicianName: string;
  referralStatus?: string | null;
  episodeStartDate: string | null;
  lastReviewDate: string | null;
  nextDueDate: string | null;
  orderTypeName?: string | null;
  startDate?: string | null;
  reviewDate?: string | null;
  source?: string | null;
  urgency?: string | null;
  referralDate?: string | null;
}

interface LaiScheduleListPayload {
  id: string;
  patient_id: string;
  prescriber_staff_id?: string | null;
  drug_name?: string | null;
  frequency_days?: number | null;
  status?: string | null;
  start_date?: string | null;
  next_due_date?: string | null;
  end_date?: string | null;
}

interface ClozapineRegistrationListPayload {
  id: string;
  patientId: string;
  prescriberStaffId?: string | null;
  titrationPhase?: string | null;
  ancStatus?: string | null;
  registrationDate?: string | null;
  nextBloodDueDate?: string | null;
  ceasedDate?: string | null;
}

interface ActiveLegalOrderListPayload {
  id: string;
  patientId: string;
  orderTypeName: string;
  status: string;
  startDate: string;
  reviewDate: string | null;
  endDate: string | null;
  patientGivenName: string;
  patientFamilyName: string;
  patientDob: string | null;
}

interface ClinicalAlertListPayload {
  patientId?: string;
  patientid?: string;
  givenName?: string | null;
  givenname?: string | null;
  familyName?: string | null;
  familyname?: string | null;
  emrNumber?: string | null;
  emrnumber?: string | null;
  detail?: string | null;
  dueDate?: string | null;
  duedate?: string | null;
  alertType?: string | null;
  alerttype?: string | null;
  teamIdName?: string | null;
  teamidname?: string | null;
  clinicianIdName?: string | null;
  clinicianidname?: string | null;
}

function errorMessage(err: unknown, fallback: string): string {
  if (typeof err !== 'object' || err === null) return fallback;
  const maybeErr = err as {
    message?: unknown;
    response?: { data?: { error?: unknown; message?: unknown } };
  };
  if (typeof maybeErr.response?.data?.error === 'string' && maybeErr.response.data.error.trim()) return maybeErr.response.data.error;
  if (typeof maybeErr.response?.data?.message === 'string' && maybeErr.response.data.message.trim()) return maybeErr.response.data.message;
  if (typeof maybeErr.message === 'string' && maybeErr.message.trim()) return maybeErr.message;
  return fallback;
}

function flattenUnits(nodes: OrgUnit[]): { id: string; name: string }[] {
  const r: { id: string; name: string }[] = [];
  function w(l: OrgUnit[], d: number) { for (const n of l) { r.push({ id: n.id, name: n.name }); if (n.children?.length) w(n.children, d + 1); } }
  w(nodes, 0); return r;
}

function useStaffLookup() {
  return useQuery({ queryKey: listsCrossFeatureKeys.staffLookup(), queryFn: () => apiClient.get<{ id: string; givenName: string; familyName: string }[]>('staff/lookup'), staleTime: 5 * 60 * 1000 });
}

function usePatientTeamAssignments() {
  return useQuery({
    queryKey: listsCrossFeatureKeys.patientsTeamAssignments(),
    queryFn: () => apiClient.get<{ assignments: TeamAssignmentPayload[] }>('patients/team-assignments').then((r) => r.assignments),
    staleTime: 30_000,
  });
}

function usePatientList() {
  return useQuery({
    queryKey: listsCrossFeatureKeys.patientsAll(),
    queryFn: () => apiClient.get<{ data: PatientListPayload[] }>('patients', { limit: 200 }).then((r) => r.data ?? []),
    staleTime: 30_000,
  });
}

function useLaiSchedules() {
  return useQuery({
    queryKey: listsCrossFeatureKeys.laiSchedulesActive(),
    queryFn: () => apiClient.get<{ data: LaiScheduleListPayload[] }>('lai/active').then((r) => r.data ?? []),
    staleTime: 30_000,
  });
}

function useClozapineRegistrations() {
  return useQuery({
    queryKey: listsCrossFeatureKeys.clozapineRegistrationsActive(),
    queryFn: () => apiClient.get<ClozapineRegistrationListPayload[]>('clozapine').then((r) => r ?? []),
    staleTime: 30_000,
  });
}

function useActiveLegalOrders() {
  return useQuery({
    queryKey: listsCrossFeatureKeys.legalOrdersActive(),
    queryFn: () => apiClient.get<{ orders: ActiveLegalOrderListPayload[] }>('patients/legal-orders/active').then((r) => r.orders ?? []),
    staleTime: 30_000,
  });
}

function useNinetyOneDayAlerts(enabled: boolean) {
  return useQuery({
    queryKey: listsCrossFeatureKeys.reportsClinicalAlerts(),
    queryFn: () =>
      apiClient
        .get<{ overdue?: ClinicalAlertListPayload[] }>('reports/clinical-alerts', {
          daysAhead: 30,
          daysBack: 365,
        })
        .then((r) => r.overdue ?? []),
    staleTime: 30_000,
    enabled,
  });
}

interface ListConfig {
  title: string;
  description: string;
  listType: 'lai' | 'mha' | 'clozapine' | 'referrals' | 'team';
  teamFilter?: string; // pre-filter by team name pattern
  columns?: string[];
}

type DueFilterKey =
  | 'all'
  | 'overdue'
  | 'dueThisWeek'
  | 'dueNextWeek'
  | 'dueThisMonth'
  | 'dueThisQuarter'
  | 'active';

const LIST_CONFIGS: Record<string, ListConfig> = {
  lai: { title: 'LAI List', description: 'Patients on Long-Acting Injectable medications', listType: 'lai', columns: ['Patient', 'DOB', 'Team', 'Clinician', 'Status', 'Next Due'] },
  mha: { title: 'MH Act List', description: 'Patients with active Mental Health Act orders', listType: 'mha', columns: ['Patient', 'DOB', 'Team', 'Order Type', 'Start Date', 'Review Date', 'Status'] },
  clozapine: { title: 'Clozapine List', description: 'Patients on Clozapine monitoring', listType: 'clozapine', columns: ['Patient', 'DOB', 'Team', 'Clinician', 'Status', 'Next Blood Test'] },
  referrals: { title: 'Referral List', description: 'Active referrals and intake', listType: 'referrals', columns: ['Patient', 'DOB', 'Source', 'Date', 'Urgency', 'Status'] },
  acis: { title: 'ACIS List', description: 'Acute Intervention Service patients', listType: 'team', teamFilter: 'ACIS', columns: ['Patient', 'DOB', 'Team', 'Clinician', 'Episode', 'Status'] },
  parc: { title: 'PARC List', description: 'Prevention and Recovery Care patients', listType: 'team', teamFilter: 'PARC', columns: ['Patient', 'DOB', 'Team', 'Clinician', 'Episode', 'Status'] },
  ccu: { title: 'CCU List', description: 'Community Care Unit patients', listType: 'team', teamFilter: 'CCU', columns: ['Patient', 'DOB', 'Team', 'Clinician', 'Episode', 'Status'] },
  ipu: { title: 'IPU List', description: 'Inpatient Unit patients', listType: 'team', teamFilter: 'IPU', columns: ['Patient', 'DOB', 'Team', 'Clinician', 'Episode', 'Status'] },
  op: { title: 'Outpatients List', description: 'Outpatient / Continuing Care Team patients', listType: 'team', teamFilter: 'Community', columns: ['Patient', 'DOB', 'Team', 'Clinician', 'Episode', 'Status'] },
  group: { title: 'Group Program List', description: 'Patients enrolled in group therapy programs', listType: 'team', teamFilter: '', columns: ['Patient', 'DOB', 'Team', 'Clinician', 'Status'] },
  'cloz-support': { title: 'Clozapine Support Program', description: 'Patients in the Clozapine support and monitoring program', listType: 'clozapine', columns: ['Patient', 'DOB', 'Team', 'Clinician', 'Status', 'Next Blood Test'] },
  '91day': { title: '91-Day Review List', description: 'Patients due for 91-day Mental Health Act treatment order review', listType: 'mha', columns: ['Patient', 'DOB', 'Team', 'Last Review', 'Next Due', 'Status'] },
};

interface ClinicalListPageProps { listKey: string }
export default function ClinicalListPage({ listKey }: ClinicalListPageProps) {
  const navigate = useNavigate();
  const config = LIST_CONFIGS[listKey];
  const { data: tree } = useOrgTree();
  const { data: staffList } = useStaffLookup();
  const { data: patients, isLoading: pLoading } = usePatientList();
  const { data: teamAssigns } = usePatientTeamAssignments();
  const { data: laiSchedules, isLoading: laiLoading } = useLaiSchedules();
  const { data: clozapineRegs, isLoading: clozLoading } = useClozapineRegistrations();
  const { data: activeLegalOrders, isLoading: legalLoading } = useActiveLegalOrders();
  const { data: ninetyOneDayAlerts, isLoading: alertLoading } = useNinetyOneDayAlerts(listKey === '91day');
  const flatUnits = useMemo(() => tree ? flattenUnits(tree) : [], [tree]);
  const qc = useQueryClient();

  // Accept/Reject referral for team lists
  const handleTeamAccept = async (row: ClinicalListRow) => {
    try {
      const today = new Date().toISOString().split('T')[0];
      const teamName = row.teamName || config?.teamFilter || '';
      if (!row.assignmentId) {
        throw new Error('Team assignment id is required to accept referral.');
      }
      // Update team assignment to accepted
      await apiClient.patch(`patients/team-assignments/${row.assignmentId}`, { referralStatus: 'accepted', isActive: true });
      // Create care episode: "TeamName YYYYMMDD"
      await apiClient.post('episodes', { patientId: row.id, title: `${teamName} ${today.replace(/-/g, '')}`, episodeType: 'community', startDate: today });
      qc.invalidateQueries({ queryKey: listsCrossFeatureKeys.patientsAllRoot() });
      alert(`Accepted — episode "${teamName} ${today.replace(/-/g, '')}" created.`);
    } catch (err: unknown) {
      alert(`Accept failed: ${errorMessage(err, 'Unknown')}`);
    }
  };
  const handleTeamReject = async (row: ClinicalListRow) => {
    try {
      if (!row.assignmentId) {
        throw new Error('Team assignment id is required to reject referral.');
      }
      await apiClient.patch(`patients/team-assignments/${row.assignmentId}`, { referralStatus: 'rejected', isActive: false });
      qc.invalidateQueries({ queryKey: listsCrossFeatureKeys.patientsAllRoot() });
    } catch (err: unknown) {
      alert(`Reject failed: ${errorMessage(err, 'Unknown')}`);
    }
  };

  const [search, setSearch] = useState('');
  const [teamFilter, setTeamFilter] = useState('');
  const [clinicianFilter, setClinicianFilter] = useState('');
  const [dueFilter, setDueFilter] = useState<DueFilterKey>('all');
  const [page, setPage] = useState(0);
  const [rowsPerPage, setRowsPerPage] = useState(20);

  if (!config) return <Alert role="alert" severity="error">Unknown list type: {listKey}</Alert>;

  // USER-C.1: separate unfiltered rows (for Total count card) from
  // filtered rows (for the visible table). Pre-filter once, apply
  // user filters on top. Date-period filter now actually applies.
  const allRows = useMemo(() => {
    if (!patients || !teamAssigns) return [];
    const teamMultiMap = new Map<string, { assignmentId: string | null; orgunitname: string; clinicianname: string; referral_status?: string }[]>();
    for (const a of teamAssigns) {
      const pid = a.patient_id ?? a.patientid;
      if (!pid) continue;
      if (!teamMultiMap.has(pid)) teamMultiMap.set(pid, []);
      teamMultiMap.get(pid)!.push({
        assignmentId: a.assignmentId ?? a.assignment_id ?? null,
        orgunitname: a.orgunitname ?? a.org_unit_name ?? '',
        clinicianname: a.clinicianname ?? a.clinicianName ?? '',
        referral_status: a.referral_status ?? undefined,
      });
    }

    const patientById = new Map(patients.map((p) => [p.id, p]));
    const staffNameById = new Map((staffList ?? []).map((s) => [s.id, `${s.givenName} ${s.familyName}`.trim()]));
    const mapAssignment = (patientId: string) => {
      const assignment = (teamMultiMap.get(patientId) ?? [])[0];
      return {
        assignmentId: assignment?.assignmentId ?? null,
        teamName: assignment?.orgunitname ?? '',
        clinicianName: assignment?.clinicianname ?? '',
        referralStatus: assignment?.referral_status ?? null,
      };
    };

    if (config.listType === 'lai') {
      const todayIso = new Date().toISOString().slice(0, 10);
      const rows = (laiSchedules ?? [])
        .filter((s) => (s.status ?? '').toLowerCase() === 'active')
        .filter((s) => !s.end_date || s.end_date >= todayIso)
        .map((s): ClinicalListRow | null => {
          const patient = patientById.get(s.patient_id);
          if (!patient) return null;
          const assignment = mapAssignment(patient.id);
          const prescriberName = s.prescriber_staff_id ? (staffNameById.get(s.prescriber_staff_id) ?? '') : '';
          const clinicianName = assignment.clinicianName || prescriberName || '—';
          const isOverdue = Boolean(s.next_due_date && s.next_due_date < todayIso);
          return {
            id: patient.id,
            assignmentId: assignment.assignmentId,
            rowKey: s.id,
            givenName: patient.givenName,
            familyName: patient.familyName,
            dob: patient.dateOfBirth ?? null,
            emrNumber: patient.emrNumber ?? null,
            status: isOverdue ? 'overdue' : 'active',
            teamName: assignment.teamName,
            clinicianName,
            referralStatus: assignment.referralStatus,
            episodeStartDate: s.start_date ?? null,
            lastReviewDate: null,
            nextDueDate: s.next_due_date ?? null,
          };
        })
        .filter((row): row is ClinicalListRow => row !== null);
      if (config.teamFilter) {
        return rows.filter((r) => r.teamName.toLowerCase().includes(config.teamFilter!.toLowerCase()));
      }
      return rows;
    }

    if (config.listType === 'clozapine') {
      const rows = (clozapineRegs ?? [])
        .map((reg): ClinicalListRow | null => {
          const patient = patientById.get(reg.patientId);
          if (!patient) return null;
          const assignment = mapAssignment(patient.id);
          const prescriberName = reg.prescriberStaffId ? (staffNameById.get(reg.prescriberStaffId) ?? '') : '';
          const clinicianName = assignment.clinicianName || prescriberName || '—';
          const anc = (reg.ancStatus ?? '').toLowerCase();
          const status = anc === 'red' ? 'anc red' : anc === 'amber' ? 'anc amber' : 'active';
          return {
            id: patient.id,
            assignmentId: assignment.assignmentId,
            rowKey: reg.id,
            givenName: patient.givenName,
            familyName: patient.familyName,
            dob: patient.dateOfBirth ?? null,
            emrNumber: patient.emrNumber ?? null,
            status,
            teamName: assignment.teamName,
            clinicianName,
            referralStatus: assignment.referralStatus,
            episodeStartDate: reg.registrationDate ?? null,
            lastReviewDate: null,
            nextDueDate: reg.nextBloodDueDate ?? null,
          };
        })
        .filter((row): row is ClinicalListRow => row !== null);
      if (config.teamFilter) {
        return rows.filter((r) => r.teamName.toLowerCase().includes(config.teamFilter!.toLowerCase()));
      }
      return rows;
    }

    if (config.listType === 'mha' && listKey !== '91day') {
      const rows = (activeLegalOrders ?? [])
        .map((order): ClinicalListRow => {
          const assignment = mapAssignment(order.patientId);
          return {
            id: order.patientId,
            assignmentId: assignment.assignmentId,
            rowKey: order.id,
            givenName: order.patientGivenName,
            familyName: order.patientFamilyName,
            dob: order.patientDob ?? null,
            emrNumber: patientById.get(order.patientId)?.emrNumber ?? null,
            status: order.status,
            teamName: assignment.teamName,
            clinicianName: assignment.clinicianName,
            referralStatus: assignment.referralStatus,
            episodeStartDate: order.startDate ?? null,
            lastReviewDate: null,
            nextDueDate: null,
            orderTypeName: order.orderTypeName,
            startDate: order.startDate,
            reviewDate: order.reviewDate,
          };
        });
      if (config.teamFilter) {
        return rows.filter((r) => r.teamName.toLowerCase().includes(config.teamFilter!.toLowerCase()));
      }
      return rows;
    }

    if (listKey === '91day') {
      const rows = (ninetyOneDayAlerts ?? [])
        .filter((alert) => (alert.alertType ?? alert.alerttype ?? '') === 'review_91d_overdue')
        .map((alert): ClinicalListRow | null => {
          const patientId = alert.patientId ?? alert.patientid;
          if (!patientId) return null;
          const patient = patientById.get(patientId);
          const assignment = mapAssignment(patientId);
          return {
            id: patientId,
            assignmentId: assignment.assignmentId,
            rowKey: `${patientId}:91day`,
            givenName: patient?.givenName ?? alert.givenName ?? alert.givenname ?? 'Unknown',
            familyName: patient?.familyName ?? alert.familyName ?? alert.familyname ?? 'Patient',
            dob: patient?.dateOfBirth ?? null,
            emrNumber: patient?.emrNumber ?? alert.emrNumber ?? alert.emrnumber ?? null,
            status: 'overdue',
            teamName: assignment.teamName || alert.teamIdName || alert.teamidname || '',
            clinicianName: assignment.clinicianName || alert.clinicianIdName || alert.clinicianidname || '',
            referralStatus: assignment.referralStatus,
            episodeStartDate: null,
            lastReviewDate: null,
            nextDueDate: alert.dueDate ?? alert.duedate ?? null,
          };
        })
        .filter((row): row is ClinicalListRow => row !== null);

      if (config.teamFilter) {
        return rows.filter((r) => r.teamName.toLowerCase().includes(config.teamFilter!.toLowerCase()));
      }
      return rows;
    }

    const built: ClinicalListRow[] = [];
    for (const p of patients) {
      const episodeStart = p.latestEpisodeStart ?? p.createdAt;
      // 91-day clinical-review cadence via the shared SSoT helper. No inline
      // day-ms math here — see scripts/guards/check-no-inline-date-bucket-math.
      const { lastReviewDate, nextDueDate } = compute91DayReviewCycle(episodeStart ?? null, new Date());

      const assignments = teamMultiMap.get(p.id) ?? [{
        assignmentId: null,
        orgunitname: '',
        clinicianname: '',
        referral_status: undefined,
      }];
      for (const assign of assignments) {
        built.push({
          id: p.id,
          assignmentId: assign.assignmentId ?? null,
          rowKey: `${p.id}:${assign.orgunitname ?? ''}:${assign.clinicianname ?? ''}`,
          givenName: p.givenName,
          familyName: p.familyName,
          dob: p.dateOfBirth ?? null, emrNumber: p.emrNumber ?? null, status: p.status ?? 'active',
          teamName: assign.orgunitname ?? '', clinicianName: assign.clinicianname ?? '',
          referralStatus: assign.referral_status,
          episodeStartDate: episodeStart ?? null, lastReviewDate, nextDueDate,
        });
      }
    }
    // Apply list-config's team pre-filter (LAI / MHA / clozapine / team
    // lists all have a scope rule that's part of the list's identity —
    // separate from the user's optional team filter below).
    if (config.teamFilter) {
      return built.filter(r => r.teamName.toLowerCase().includes(config.teamFilter!.toLowerCase()));
    }
    return built;
  }, [activeLegalOrders, clozapineRegs, config, laiSchedules, ninetyOneDayAlerts, patients, staffList, teamAssigns, listKey]);

  const filteredRows = useMemo(() => {
    let filtered = allRows;
    if (search) {
      const q = search.toLowerCase();
      filtered = filtered.filter(r => r.familyName.toLowerCase().includes(q) || r.givenName.toLowerCase().includes(q) || r.emrNumber?.toLowerCase().includes(q));
    }
    if (teamFilter) filtered = filtered.filter(r => r.teamName.includes(teamFilter));
    if (clinicianFilter) filtered = filtered.filter(r => r.clinicianName.includes(clinicianFilter));
    return filtered;
  }, [allRows, search, teamFilter, clinicianFilter]);

  const rows = useMemo(() => {
    if (dueFilter === 'all') return filteredRows;
    if (dueFilter === 'active') return filteredRows.filter((r) => r.status === 'active');
    const opts = {
      now: new Date(),
      timeZone: DEFAULT_CLINIC_TIME_ZONE,
      graceDays: overdueGraceDaysFor(listKey, LAI_OVERDUE_GRACE_DAYS),
    };
    return filteredRows.filter((r) => isInDueBucket(dueDateForRow(listKey, r), dueFilter, opts));
  }, [filteredRows, dueFilter, listKey]);

  const paginatedRows = rows.slice(page * rowsPerPage, (page + 1) * rowsPerPage);
  const columns = config.columns ?? ['Patient', 'DOB', 'Team', 'Clinician', 'Status'];
  const listLoading =
    pLoading
    || (config.listType === 'lai' && laiLoading)
    || (config.listType === 'clozapine' && clozLoading)
    || (config.listType === 'mha' && legalLoading)
    || (listKey === '91day' && alertLoading);

  return (
    <Box sx={{ px: { xs: 2, sm: 3, md: 4 }, py: 3, bgcolor: '#FBF8F5', minHeight: '100vh' }}>
      <Box sx={{ mb: 3 }}>
        <Typography variant="h5" fontWeight={700} fontFamily="Albert Sans, sans-serif" sx={{ color: '#3D484B' }}>
          {config.title}
        </Typography>
        <Typography variant="body2" color="text.secondary" fontFamily="Albert Sans, sans-serif" sx={{ mt: 0.5 }}>
          {config.description}
        </Typography>
      </Box>

      {/* USER-C.1: count cards on every clinical list. Team-type lists
          also get the referral-status TeamSummaryCards on top. */}
      <ListCountCards
        listKey={listKey}
        filteredRows={filteredRows}
        activeFilter={dueFilter}
        onFilterChange={(next) => {
          setPage(0);
          setDueFilter((prev) => (next === 'all' ? 'all' : prev === next ? 'all' : next));
        }}
      />
      {config.listType === 'team' && (
        <TeamSummaryCards teamFilter={config.teamFilter ?? ''} flatUnits={flatUnits} />
      )}

      {/* Filters */}
      <Box sx={{ display: 'flex', gap: 1.5, mb: 2, flexWrap: 'wrap' }}>
        <TextField size="small" placeholder="Search by name or UR…" value={search} onChange={e => setSearch(e.target.value)}
          slotProps={{ input: { startAdornment: <InputAdornment position="start"><SearchIcon sx={{ fontSize: 20, color: 'text.secondary' }} /></InputAdornment> } }}
          sx={{ minWidth: 240, '& .MuiOutlinedInput-root': { bgcolor: '#fff' } }} />
        <FormControl size="small" sx={{ minWidth: 180 }}>
          <InputLabel>Team / Unit</InputLabel>
          <Select value={teamFilter} onChange={e => setTeamFilter(e.target.value)} label="Team / Unit" sx={{ bgcolor: '#fff' }}>
            <MenuItem value="">All Teams</MenuItem>
            {flatUnits.map(u => <MenuItem key={u.id} value={u.name}>{u.name}</MenuItem>)}
          </Select>
        </FormControl>
        <FormControl size="small" sx={{ minWidth: 180 }}>
          <InputLabel>Clinician</InputLabel>
          <Select value={clinicianFilter} onChange={e => setClinicianFilter(e.target.value)} label="Clinician" sx={{ bgcolor: '#fff' }}>
            <MenuItem value="">All Clinicians</MenuItem>
            {(staffList ?? []).map(s => <MenuItem key={s.id} value={`${s.givenName} ${s.familyName}`}>{s.givenName} {s.familyName}</MenuItem>)}
          </Select>
        </FormControl>
        <FormControl size="small" sx={{ minWidth: 140 }}>
          <InputLabel>Time Period</InputLabel>
          <Select
            value={dueFilter}
            onChange={e => {
              setDueFilter(e.target.value as DueFilterKey);
              setPage(0);
            }}
            label="Time Period"
            sx={{ bgcolor: '#fff' }}
          >
            <MenuItem value="all">All</MenuItem>
            <MenuItem value="overdue">Overdue</MenuItem>
            <MenuItem value="dueThisWeek">Due This Week</MenuItem>
            <MenuItem value="dueNextWeek">Due Next Week</MenuItem>
            <MenuItem value="dueThisMonth">Due This Month</MenuItem>
            <MenuItem value="dueThisQuarter">Due This Quarter</MenuItem>
            <MenuItem value="active">Active</MenuItem>
          </Select>
        </FormControl>
      </Box>

      {/* Export Bar + Table */}
      <Box sx={{ display: 'flex', justifyContent: 'flex-end', mb: 0.5 }}>
        <ListExportBar
          title={config.title ?? listKey}
          subtitle={`${rows.length} records`}
          columns={columns}
          rows={rows.map((r) => columns.map((col) => {
            switch (col) {
              case 'Patient': return `${r.familyName}, ${r.givenName}`;
              case 'DOB': return r.dob ? new Date(r.dob).toLocaleDateString('en-AU') : '';
              case 'Team': return r.teamName ?? '';
              case 'Clinician': return r.clinicianName ?? '';
              case 'Status': return r.status ?? '';
              case 'Next Due': return r.nextDueDate ? new Date(r.nextDueDate).toLocaleDateString('en-AU') : '';
              case 'Next Blood Test': return r.nextDueDate ? new Date(r.nextDueDate).toLocaleDateString('en-AU') : '';
              case 'Order Type': return r.orderTypeName ?? '';
              case 'Start Date': return r.startDate ? new Date(r.startDate).toLocaleDateString('en-AU') : '';
              case 'Review Date': return r.reviewDate ? new Date(r.reviewDate).toLocaleDateString('en-AU') : '';
              case 'Source': return r.source ?? '';
              case 'Date': return r.referralDate ? new Date(r.referralDate).toLocaleDateString('en-AU') : '';
              case 'Urgency': return r.urgency ?? '';
              case 'Episode': return r.episodeStartDate ? new Date(r.episodeStartDate).toLocaleDateString('en-AU') : '';
              case 'Last Review': return r.lastReviewDate ? new Date(r.lastReviewDate).toLocaleDateString('en-AU') : '';
              default: return '';
            }
          }))}
          compact
        />
      </Box>
      <Paper elevation={0} sx={{ border: '1px solid', borderColor: 'divider', borderRadius: 2, overflow: 'hidden' }}>
        <TableContainer role="region" aria-label="Data table">
          <Table size="small" stickyHeader>
            <TableHead>
              <TableRow>
                {columns.map(col => (
                  <TableCell key={col} sx={{ fontFamily: 'Albert Sans, sans-serif', fontWeight: 600, fontSize: 13, color: '#3D484B', backgroundColor: '#FBF8F5' }}>{col}</TableCell>
                ))}
              </TableRow>
            </TableHead>
            <TableBody>
              {listLoading ? (
                <TableRow><TableCell colSpan={columns.length} align="center" sx={{ py: 6 }}><CircularProgress role="progressbar" aria-label="Loading" size={28} sx={{ color: '#b8621a' }} /></TableCell></TableRow>
              ) : paginatedRows.length === 0 ? (
                <TableRow><TableCell colSpan={columns.length} align="center" sx={{ py: 6 }}><Typography variant="body2" color="text.secondary">No patients found</Typography></TableCell></TableRow>
              ) : (
                paginatedRows.map((r) => (
                  <React.Fragment key={r.rowKey}>
                    <TableRow hover sx={{ cursor: 'pointer' }} onClick={() => {
                      const tabMap: Record<string, string> = {
                        lai: 'medications', mha: 'legal', clozapine: 'medications',
                        referrals: 'referrals', '91day': '91day-review',
                        acis: 'episodes', parc: 'episodes', ccu: 'episodes', ipu: 'episodes', op: 'episodes',
                        group: 'episodes', 'cloz-support': 'medications',
                      };
                      const tab = tabMap[listKey] ?? 'summary';
                      navigate(`/patients/${r.id}?tab=${tab}`);
                    }}>
                      <TableCell sx={{ fontFamily: 'Albert Sans, sans-serif', fontWeight: 600, color: '#b8621a', '&:hover': { textDecoration: 'underline' } }}>
                        {r.familyName}, {r.givenName}
                      </TableCell>
                      <TableCell sx={{ fontFamily: 'Albert Sans, sans-serif' }}>{r.dob ? new Date(r.dob).toLocaleDateString('en-AU') : '—'}</TableCell>
                      <TableCell sx={{ fontFamily: 'Albert Sans, sans-serif', fontSize: 13 }}>{r.teamName || '—'}</TableCell>
                      {/* Render remaining columns in header order */}
                      {columns.slice(3).map(col => {
                        switch (col) {
                          case 'Clinician': return <TableCell key={col} sx={{ fontFamily: 'Albert Sans, sans-serif', fontSize: 13 }}>{r.clinicianName || '—'}</TableCell>;
                          case 'Status': return <TableCell key={col}>
                            {r.referralStatus && r.referralStatus !== 'accepted' ? (
                              <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                                <Typography variant="caption" sx={{ fontSize: 10, textTransform: 'capitalize', px: 0.75, py: 0.15, borderRadius: 1, bgcolor: r.referralStatus === 'new' ? '#FFF3E0' : '#E3F2FD', color: r.referralStatus === 'new' ? '#E65100' : '#1565C0', fontWeight: 600 }}>{r.referralStatus}</Typography>
                                {r.referralStatus === 'new' && (
                                  <>
                                    <Button size="small" variant="contained" color="success" sx={{ fontSize: 9, minWidth: 0, px: 0.75, py: 0.15, lineHeight: 1 }}
                                      onClick={e => { e.stopPropagation(); handleTeamAccept(r); }}>Accept</Button>
                                    <Button size="small" variant="outlined" color="error" sx={{ fontSize: 9, minWidth: 0, px: 0.75, py: 0.15, lineHeight: 1 }}
                                      onClick={e => { e.stopPropagation(); handleTeamReject(r); }}>Reject</Button>
                                  </>
                                )}
                              </Box>
                            ) : (
                              <Typography variant="caption" sx={{ fontSize: 11, textTransform: 'capitalize', px: 1, py: 0.25, borderRadius: 1, bgcolor: r.status === 'active' ? '#E8F5E9' : '#F5F5F5', color: r.status === 'active' ? '#2E7D32' : '#757575', fontWeight: 600 }}>{r.status}</Typography>
                            )}
                          </TableCell>;
                          case 'Last Review': return <TableCell key={col} sx={{ fontSize: 13, color: 'text.secondary' }}>{r.lastReviewDate ? new Date(r.lastReviewDate).toLocaleDateString('en-AU') : '—'}</TableCell>;
                          case 'Next Due': return <TableCell key={col} sx={{ fontSize: 13 }}>{r.nextDueDate ? new Date(r.nextDueDate).toLocaleDateString('en-AU') : '—'}</TableCell>;
                          case 'Next Blood Test': return <TableCell key={col} sx={{ fontSize: 13, color: 'text.secondary' }}>{r.nextDueDate ? new Date(r.nextDueDate).toLocaleDateString('en-AU') : '—'}</TableCell>;
                          case 'Order Type': return <TableCell key={col} sx={{ fontSize: 13 }}>{r.orderTypeName ?? '—'}</TableCell>;
                          case 'Start Date': return <TableCell key={col} sx={{ fontSize: 13 }}>{r.startDate ? new Date(r.startDate).toLocaleDateString('en-AU') : '—'}</TableCell>;
                          case 'Review Date': return <TableCell key={col} sx={{ fontSize: 13 }}>{r.reviewDate ? new Date(r.reviewDate).toLocaleDateString('en-AU') : '—'}</TableCell>;
                          case 'Source': return <TableCell key={col} sx={{ fontSize: 13 }}>{r.source ?? '—'}</TableCell>;
                          case 'Date': return <TableCell key={col} sx={{ fontSize: 13 }}>{r.referralDate ? new Date(r.referralDate).toLocaleDateString('en-AU') : '—'}</TableCell>;
                          case 'Urgency': return <TableCell key={col} sx={{ fontSize: 13 }}>{r.urgency ?? '—'}</TableCell>;
                          case 'Episode': return <TableCell key={col} sx={{ fontSize: 13 }}>{r.episodeStartDate ? new Date(r.episodeStartDate).toLocaleDateString('en-AU') : '—'}</TableCell>;
                          default: return null;
                        }
                      })}
                    </TableRow>
                  </React.Fragment>
                ))
              )}
            </TableBody>
          </Table>
        </TableContainer>
        <TablePagination component="div" count={rows.length} page={page}
          onPageChange={(_, p) => setPage(p)} rowsPerPage={rowsPerPage}
          onRowsPerPageChange={e => { setRowsPerPage(parseInt(e.target.value, 10)); setPage(0); }}
          rowsPerPageOptions={[10, 20, 50]} />
      </Paper>
    </Box>
  );
}

// ListCountCards — dynamic due-date count header (plan PART 6). Recomputes
// from `filteredRows` (search/team/clinician filters applied, before due-
// bucket selection) so the numbers stay actionable as clickable filters.
// The six operator-specified cards (Total / Overdue / Due This
// Week / Due Next Week / Due This Month / Due This Quarter) lead; the
// pre-existing USER-C.1 Active + Teams cards are preserved (no regression).
// Bucket math is the shared SSoT util — nested/cumulative calendar buckets,
// clinic timezone, per-domain overdue grace.
interface ListCountRow {
  status?: string;
  teamName?: string;
  nextDueDate?: string | null;
  reviewDate?: string | null;
}
function ListCountCards({
  listKey,
  filteredRows,
  activeFilter,
  onFilterChange,
}: {
  listKey: string;
  filteredRows: ListCountRow[];
  activeFilter: DueFilterKey;
  onFilterChange: (next: DueFilterKey) => void;
}) {
  const cards = useMemo(() => {
    const t = computeListCountTiles(filteredRows, listKey, {
      now: new Date(),
      timeZone: DEFAULT_CLINIC_TIME_ZONE,
      laiGraceDays: LAI_OVERDUE_GRACE_DAYS,
    });
    return [
      { label: 'Total', count: t.total, color: '#3D484B', filter: 'all' as const },
      { label: 'Overdue', count: t.overdue, color: '#C62828', filter: 'overdue' as const },
      { label: 'Due This Week', count: t.dueThisWeek, color: '#E65100', filter: 'dueThisWeek' as const },
      { label: 'Due Next Week', count: t.dueNextWeek, color: '#EF6C00', filter: 'dueNextWeek' as const },
      { label: 'Due This Month', count: t.dueThisMonth, color: '#327C8D', filter: 'dueThisMonth' as const },
      { label: 'Due This Quarter', count: t.dueThisQuarter, color: '#2E7D32', filter: 'dueThisQuarter' as const },
      { label: 'Active', count: t.active, color: '#2E7D32', filter: 'active' as const },
      { label: 'Teams', count: t.teams, color: '#b8621a', filter: null },
    ];
  }, [listKey, filteredRows]);
  return (
    <Box sx={{ display: 'flex', gap: 1.5, mb: 2, flexWrap: 'wrap' }}>
      {cards.map(c => {
        const isSelected = !!c.filter && c.filter === activeFilter;
        return (
        <Paper
          key={c.label}
          variant="outlined"
          sx={{
            minWidth: 110,
            borderLeft: `3px solid ${c.color}`,
            borderColor: isSelected ? c.color : 'divider',
            boxShadow: isSelected ? `0 0 0 1px ${c.color}` : 'none',
          }}
        >
          <ButtonBase
            disableRipple={!c.filter}
            disabled={!c.filter}
            onClick={() => {
              if (c.filter) onFilterChange(c.filter);
            }}
            sx={{
              width: '100%',
              px: 2,
              py: 1,
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              opacity: c.filter ? 1 : 0.8,
            }}
          >
            <Typography variant="h5" fontWeight={700} sx={{ color: c.color }}>{c.count}</Typography>
            <Typography variant="caption" color="text.secondary">{c.label}</Typography>
          </ButtonBase>
        </Paper>
      )})}
    </Box>
  );
}

// ── Summary Cards for team referral counts ──
function TeamSummaryCards({ teamFilter, flatUnits }: { teamFilter: string; flatUnits: { id: string; name: string }[] }) {
  const orgUnit = flatUnits.find(u => u.name.toLowerCase().includes(teamFilter.toLowerCase()));
  const { data: counts } = useQuery({
    queryKey: listsCrossFeatureKeys.teamSummary(orgUnit?.id),
    queryFn: () => apiClient.get<Record<string, number>>(`escalations/team-summary?orgUnitId=${orgUnit?.id}`),
    enabled: !!orgUnit?.id,
  });
  const cards = [
    { label: 'New', count: counts?.new ?? 0, color: '#327C8D' },
    { label: 'In Review', count: counts?.in_review ?? 0, color: '#b8621a' },
    { label: 'Accepted', count: counts?.accepted ?? 0, color: '#2E7D32' },
    { label: 'Rejected', count: counts?.rejected ?? 0, color: '#D32F2F' },
  ];
  return (
    <Box sx={{ display: 'flex', gap: 1.5, mb: 2 }}>
      {cards.map(c => (
        <Paper key={c.label} variant="outlined" sx={{ px: 2, py: 1, minWidth: 100, textAlign: 'center', borderLeft: `3px solid ${c.color}` }}>
          <Typography variant="h5" fontWeight={700} sx={{ color: c.color }}>{c.count}</Typography>
          <Typography variant="caption" color="text.secondary">{c.label}</Typography>
        </Paper>
      ))}
    </Box>
  );
}
