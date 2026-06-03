// apps/web/src/features/patients/components/PatientList.tsx
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
  Divider,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  IconButton,
  Paper,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TablePagination,
  TableRow,
  Tooltip,
  Typography,
} from '@mui/material';
import AttachFileIcon from '@mui/icons-material/AttachFile';
import NoteAddIcon from '@mui/icons-material/NoteAdd';
import PersonOffIcon from '@mui/icons-material/PersonOff';
import PersonIcon from '@mui/icons-material/Person';
import { AddNoteDialog } from './notes/AddNoteDialog';
import { useDebounce } from 'use-debounce';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { usePatients } from '../hooks/usePatients';
import { PatientSearchBar } from './PatientSearchBar';
import { useAuthStore } from '../../../shared/store/authStore';
import { apiClient } from '../../../shared/services/apiClient';
import { ListExportBar } from '../../../shared/components/ui/ListExportBar';
import type { PatientResponse } from '@signacare/shared';
import { patientsKeys } from '../queryKeys';

const COLUMNS = ['Patient Name', 'DOB', 'UR Number', 'Team', 'Key Clinician', 'Consultant', 'Junior Medical Staff', ''];

interface MdtMember { staffId: string; staffName: string; roleName: string }

// Keys are guaranteed camelCase by the camelCaseResponse middleware.
interface PatientTeamAssignment {
  patientId: string;
  orgUnitId: string;
  orgUnitName: string;
  primaryClinicianId: string | null;
  clinicianName: string;
  referralStatus?: string | null;
  isActive?: boolean;
  mdt?: MdtMember[];
}

function isConsultantRole(roleName: string): boolean {
  const normalized = roleName.toLowerCase();
  return normalized.includes('consultant');
}

function isJuniorMedicalRole(roleName: string): boolean {
  const normalized = roleName.toLowerCase();
  return (
    normalized.includes('junior') ||
    normalized.includes('registrar') ||
    normalized.includes('resident') ||
    normalized.includes('medical officer')
  );
}

interface OrgUnitFlat {
  id: string;
  name: string;
  level: number | string;
  parentId: string | null;
}

interface ErrorWithMessage {
  response?: {
    data?: {
      error?: string;
    };
  };
  message?: string;
}

function getErrorMessage(error: unknown): string {
  const maybe = error as ErrorWithMessage;
  return maybe.response?.data?.error ?? maybe.message ?? 'Failed to deactivate patient';
}

function useOrgUnitsFlat() {
  return useQuery({
    queryKey: patientsKeys.unitsFlat(),
    queryFn: () => apiClient.get<{ units: OrgUnitFlat[] }>('org-settings/units').then(r => r.units),
    staleTime: 5 * 60 * 1000,
  });
}

/** Given a selected unit ID, returns a Set of that ID plus all descendant IDs */
function getDescendantIds(selectedId: string, units: OrgUnitFlat[]): Set<string> {
  const ids = new Set<string>([selectedId]);
  let added = true;
  while (added) {
    added = false;
    for (const u of units) {
      if (u.parentId && ids.has(u.parentId) && !ids.has(u.id)) {
        ids.add(u.id);
        added = true;
      }
    }
  }
  return ids;
}

function useStaffList() {
  return useQuery({
    queryKey: patientsKeys.staffLookup(),
    queryFn: () =>
      apiClient.get<{ id: string; givenName: string; familyName: string }[]>('staff/lookup'),
    staleTime: 5 * 60 * 1000,
  });
}

function usePatientTeamAssignments() {
  return useQuery({
    queryKey: patientsKeys.patientTeamAssignments(),
    queryFn: () => apiClient.get<{ assignments: PatientTeamAssignment[] }>('patients/team-assignments').then(r => r.assignments),
    staleTime: 30_000,
  });
}

function useAttachmentCounts() {
  return useQuery({
    queryKey: patientsKeys.patientAttachmentCounts(),
    queryFn: () => apiClient.get<{ counts: Record<string, number> }>('patients/attachment-counts').then(r => r.counts),
    staleTime: 60_000,
  });
}

interface ReviewOverdue { medical: boolean; clinician: boolean; daysSinceMedical: number | null; daysSinceClinician: number | null }

function useReviewStatus() {
  return useQuery({
    queryKey: patientsKeys.patientReviewStatus(),
    queryFn: () => apiClient.get<{ overdue: Record<string, ReviewOverdue> }>('patients/review-status').then(r => r.overdue),
    staleTime: 60_000,
  });
}

function useMyTeamIds() {
  const userId = useAuthStore(s => s.user?.id ?? '');
  return useQuery({
    queryKey: patientsKeys.teamAssignmentsForStaff(userId),
    queryFn: () => apiClient.get<{ assignments: { orgUnitId: string }[] }>('staff-settings/team-assignments', { staffId: userId }).then(r => r.assignments.map(a => a.orgUnitId)),
    enabled: !!userId,
    staleTime: 5 * 60 * 1000,
  });
}

const PatientRow: React.FC<{
  patient: PatientResponse;
  onClick: (id: string) => void;
  teamName: string;
  clinicianName: string;
  consultantName: string;
  juniorMedicalName: string;
  attachmentCount: number;
  onQuickNote: (id: string) => void;
  onDeactivate: (id: string) => void;
  onReactivate: (id: string) => void;
  reviewOverdue?: ReviewOverdue;
}> = ({ patient, onClick, teamName, clinicianName, consultantName, juniorMedicalName, attachmentCount, onQuickNote, onDeactivate, onReactivate, reviewOverdue }) => {
  const dob = patient.dateOfBirth ? new Date(patient.dateOfBirth).toLocaleDateString('en-AU') : '—';
  // Row colour: red tint if both overdue, orange tint if one overdue
  const bothOverdue = reviewOverdue?.medical && reviewOverdue?.clinician;
  const anyOverdue = reviewOverdue?.medical || reviewOverdue?.clinician;
  const rowBg = bothOverdue ? '#FFF0F0' : anyOverdue ? '#FFF8F0' : undefined;
  const reviewTooltip = anyOverdue
    ? [
        reviewOverdue?.medical ? `Medical review overdue${reviewOverdue.daysSinceMedical != null ? ` (${reviewOverdue.daysSinceMedical}d)` : ''}` : '',
        reviewOverdue?.clinician ? `Clinician review overdue${reviewOverdue.daysSinceClinician != null ? ` (${reviewOverdue.daysSinceClinician}d)` : ''}` : '',
      ].filter(Boolean).join(' | ')
    : '';
  return (
    <TableRow hover sx={{ '&:last-child td': { borderBottom: 0 }, bgcolor: rowBg }}>
      <TableCell onClick={() => onClick(patient.id)}
        sx={{ fontFamily: 'Albert Sans, sans-serif', cursor: 'pointer', '&:hover': { textDecoration: 'underline' }, minWidth: 220 }}>
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.2 }}>
          <Typography sx={{ fontWeight: 700, fontSize: 13, color: '#b8621a', lineHeight: 1.2 }}>
            {patient.givenName} {patient.familyName}
          </Typography>
          {patient.preferredName && (
            <Typography variant="caption" sx={{ fontSize: 11, color: 'text.secondary' }}>
              Preferred: {patient.preferredName}
            </Typography>
          )}
          {anyOverdue && (
            <Tooltip title={reviewTooltip}>
              <Chip
                label={bothOverdue ? 'Reviews Due' : reviewOverdue?.medical ? 'Medical Review Due' : 'Clinician Review Due'}
                size="small"
                sx={{
                  alignSelf: 'flex-start',
                  fontSize: 9,
                  height: 18,
                  fontWeight: 700,
                  bgcolor: bothOverdue ? '#FFEBEE' : '#FFF3E0',
                  color: bothOverdue ? '#C62828' : '#E65100',
                }}
              />
            </Tooltip>
          )}
        </Box>
      </TableCell>
      <TableCell sx={{ fontFamily: 'Albert Sans, sans-serif' }}>{dob}</TableCell>
      <TableCell
        onClick={() => onClick(patient.id)}
        sx={{ fontFamily: 'Albert Sans, sans-serif', fontWeight: 500, color: '#327C8D', cursor: 'pointer', '&:hover': { textDecoration: 'underline' } }}
      >
        {patient.emrNumber ?? '—'}
      </TableCell>
      <TableCell sx={{ fontFamily: 'Albert Sans, sans-serif', fontSize: 13 }}>{teamName || '—'}</TableCell>
      <TableCell sx={{ fontFamily: 'Albert Sans, sans-serif', fontSize: 13 }}>{clinicianName || '—'}</TableCell>
      <TableCell sx={{ fontFamily: 'Albert Sans, sans-serif', fontSize: 13 }}>{consultantName || '—'}</TableCell>
      <TableCell sx={{ fontFamily: 'Albert Sans, sans-serif', fontSize: 12 }}>{juniorMedicalName || '—'}</TableCell>
      <TableCell align="center" sx={{ width: 70 }}>
        <Box sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.3 }}>
          <Tooltip title="Quick Note">
            <IconButton size="small" aria-label="Quick note" onClick={e => { e.stopPropagation(); onQuickNote(patient.id); }} sx={{ color: '#b8621a' }}>
              <NoteAddIcon sx={{ fontSize: 18 }} />
            </IconButton>
          </Tooltip>
          {patient.status === 'active' ? (
            <Tooltip title="Deactivate Patient">
              <IconButton size="small" aria-label="Deactivate" onClick={e => { e.stopPropagation(); onDeactivate(patient.id); }} sx={{ color: '#999' }}>
                <PersonOffIcon sx={{ fontSize: 18 }} />
              </IconButton>
            </Tooltip>
          ) : (
            <Tooltip title="Reactivate Patient">
              <IconButton size="small" aria-label="Reactivate" onClick={e => { e.stopPropagation(); onReactivate(patient.id); }} sx={{ color: '#327C8D' }}>
                <PersonIcon sx={{ fontSize: 18 }} />
              </IconButton>
            </Tooltip>
          )}
        {attachmentCount > 0 && (
          <Tooltip title={`${attachmentCount} attachment${attachmentCount > 1 ? 's' : ''}`}>
            <Box sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.3 }}>
              <AttachFileIcon sx={{ fontSize: 18, color: '#b8621a' }} />
              {attachmentCount > 1 && (
                <Typography variant="caption" sx={{ fontSize: 11, color: '#b8621a', fontWeight: 600 }}>
                  {attachmentCount}
                </Typography>
              )}
            </Box>
          </Tooltip>
        )}
        </Box>
      </TableCell>
    </TableRow>
  );
};

export const PatientList: React.FC = () => {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const currentUserId = useAuthStore((s) => s.user?.id ?? '');
  const [quickNotePatientId, setQuickNotePatientId] = useState<string | null>(null);
  const [deactivateTarget, setDeactivateTarget] = useState<string | null>(null);
  const [deactivateError, setDeactivateError] = useState<string | null>(null);

  // Check if patient can be deactivated (no active episodes)
  const { data: canDeactivateData } = useQuery({
    queryKey: patientsKeys.canDeactivate(deactivateTarget ?? ''),
    queryFn: () => apiClient.get<{ canDeactivate: boolean; activeEpisodeCount: number }>(`patients/${deactivateTarget}/can-deactivate`),
    enabled: !!deactivateTarget,
  });

  const deactivateMut = useMutation({
    mutationFn: (patientId: string) => apiClient.patch(`patients/${patientId}/deactivate`, {}),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: patientsKeys.all });
      setDeactivateTarget(null);
      setDeactivateError(null);
    },
    onError: (error: unknown) => {
      setDeactivateError(getErrorMessage(error));
    },
  });

  const reactivateMut = useMutation({
    mutationFn: (patientId: string) => apiClient.patch(`patients/${patientId}/reactivate`, {}),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: patientsKeys.all });
    },
  });

  const [search, setSearch] = useState('');
  const [teamFilter, setTeamFilter] = useState('');
  const [clinicianFilter, setClinicianFilter] = useState('');
  const [consultantFilter, setConsultantFilter] = useState('');
  const [juniorMedicalFilter, setJuniorMedicalFilter] = useState('');
  const [allocatedToMeOnly, setAllocatedToMeOnly] = useState(true);
  const [page, setPage] = useState(0);
  const [rowsPerPage, setRowsPerPage] = useState(20);
  const [debouncedSearch] = useDebounce(search, 350);
  const [defaultsApplied, setDefaultsApplied] = useState(false);

  const { data: orgUnits } = useOrgUnitsFlat();
  const { data: staffList } = useStaffList();
  const { data: ptAssignments } = usePatientTeamAssignments();
  const { data: myTeamIds } = useMyTeamIds();
  const { data: attachCounts } = useAttachmentCounts();
  const { data: reviewStatus } = useReviewStatus();

  // Default: always filter to the user's primary team at login
  useEffect(() => {
    if (defaultsApplied) return;
    if (myTeamIds?.length) {
      setTeamFilter(myTeamIds[0]);
      setDefaultsApplied(true);
      return;
    }
    // If user has no team assignment yet, still mark defaults-applied so UI does not loop.
    if (myTeamIds && myTeamIds.length === 0) {
      setDefaultsApplied(true);
    }
  }, [myTeamIds, defaultsApplied]);

  useEffect(() => { setPage(0); }, [debouncedSearch, teamFilter, clinicianFilter, consultantFilter, juniorMedicalFilter, allocatedToMeOnly]);

  const { data, isLoading, isError } = usePatients({
    search: debouncedSearch || undefined,
    status: undefined,
    page: page + 1,
    limit: rowsPerPage,
  });

  // Build lookup maps from patient team assignments.
  // USER-B.3: consultantByPatient derives from MDT rows where roleName
  // matches 'Consultant Psychiatrist' (canonical) or 'Consultant' (fallback
  // for clinics that use abbreviated role labels).
  const { teamByPatient, clinicianByPatient, consultantByPatient, juniorMedicalByPatient } = useMemo(() => {
    const tMap = new Map<string, string>();
    const cMap = new Map<string, { id: string; name: string }>();
    const conMap = new Map<string, string>();
    const juniorMap = new Map<string, string>();
    if (ptAssignments) {
      for (const a of ptAssignments) {
        if (!tMap.has(a.patientId)) tMap.set(a.patientId, a.orgUnitName);
        if (!cMap.has(a.patientId) && a.clinicianName) cMap.set(a.patientId, { id: a.primaryClinicianId ?? '', name: a.clinicianName });
        if (a.mdt?.length) {
          if (!conMap.has(a.patientId)) {
            const consultants = a.mdt
              .filter((m) => isConsultantRole(m.roleName))
              .map((m) => m.staffName);
            if (consultants.length > 0) {
              conMap.set(a.patientId, Array.from(new Set(consultants)).join(', '));
            }
          }
          if (!juniorMap.has(a.patientId)) {
            const juniors = a.mdt
              .filter((m) => isJuniorMedicalRole(m.roleName))
              .map((m) => m.staffName);
            if (juniors.length > 0) {
              juniorMap.set(a.patientId, Array.from(new Set(juniors)).join(', '));
            }
          }
        }
      }
    }
    return { teamByPatient: tMap, clinicianByPatient: cMap, consultantByPatient: conMap, juniorMedicalByPatient: juniorMap };
  }, [ptAssignments]);

  // When a parent team is selected, expand to include all descendant unit IDs
  const teamFilterIds = useMemo(() => {
    if (!teamFilter || !orgUnits) return null;
    return getDescendantIds(teamFilter, orgUnits);
  }, [teamFilter, orgUnits]);

  // Build set of patient IDs matching team/clinician/key worker filters
  const filteredPatientIds = useMemo(() => {
    const hasExplicitFilter = Boolean(teamFilter || clinicianFilter || consultantFilter || juniorMedicalFilter);
    if (!hasExplicitFilter && !allocatedToMeOnly) return null; // no filter → show all
    if (!ptAssignments) return new Set<string>();
    const ids = new Set<string>();
    for (const a of ptAssignments) {
      const matchTeam = !teamFilterIds || teamFilterIds.has(a.orgUnitId);
      const matchClinician = !clinicianFilter || a.primaryClinicianId === clinicianFilter;
      const matchConsultant =
        !consultantFilter ||
        Boolean(
          a.mdt?.some((m) => isConsultantRole(m.roleName) && m.staffId === consultantFilter),
        );
      const matchJuniorMedical =
        !juniorMedicalFilter ||
        Boolean(
          a.mdt?.some((m) => isJuniorMedicalRole(m.roleName) && m.staffId === juniorMedicalFilter),
        );
      const matchAllocatedToMe =
        !allocatedToMeOnly ||
        !currentUserId ||
        a.primaryClinicianId === currentUserId ||
        Boolean(a.mdt?.some((m) => m.staffId === currentUserId));
      if (matchTeam && matchClinician && matchConsultant && matchJuniorMedical && matchAllocatedToMe) {
        ids.add(a.patientId);
      }
    }
    return ids;
  }, [allocatedToMeOnly, clinicianFilter, consultantFilter, currentUserId, juniorMedicalFilter, ptAssignments, teamFilterIds]);

  const filteredPatients = useMemo(() => {
    if (!data?.data) return [];
    if (!filteredPatientIds) return data.data;
    return data.data.filter(p => filteredPatientIds.has(p.id));
  }, [data, filteredPatientIds]);

  const teams = useMemo(() => (orgUnits ?? []).map(u => ({ id: u.id, name: u.name })), [orgUnits]);
  const clinicians = useMemo(() => (staffList ?? []).map(s => ({ id: s.id, name: `${s.givenName} ${s.familyName}` })), [staffList]);

  const handleRowClick = useCallback((id: string) => navigate(`/patients/${id}`), [navigate]);

  // Build team chips with patient counts for quick filtering
  const teamChips = useMemo(() => {
    const counts = new Map<string, number>();
    if (ptAssignments) {
      for (const a of ptAssignments) {
        counts.set(a.orgUnitId, (counts.get(a.orgUnitId) ?? 0) + 1);
      }
    }
    return (orgUnits ?? [])
      .filter(u => u.level === 'team' || counts.has(u.id)) // teams or any unit with patients
      .map(u => ({ id: u.id, name: u.name, count: counts.get(u.id) ?? 0 }))
      .filter(t => t.count > 0)
      .sort((a, b) => b.count - a.count);
  }, [orgUnits, ptAssignments]);

  const totalCount = data?.pagination?.total ?? 0;
  const shownCount = filteredPatients.length;
  const activeCount = filteredPatients.filter(p => (p.status ?? 'active') === 'active').length;
  const countsLabel = `${shownCount} shown`;

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
      <Box sx={{ display: 'flex', gap: 1.5, alignItems: 'center', flexWrap: 'wrap' }}>
        <Paper variant="outlined" sx={{ px: 1.5, py: 0.8, display: 'flex', alignItems: 'center', gap: 1.5, borderRadius: 2 }}>
          <Typography sx={{ fontSize: 12, color: 'text.secondary', fontWeight: 600 }}>
            Total Patients
          </Typography>
          <Typography sx={{ fontSize: 14, fontWeight: 800, color: '#3D484B' }}>
            {totalCount}
          </Typography>
          <Divider orientation="vertical" flexItem />
          <Typography sx={{ fontSize: 12, color: 'text.secondary', fontWeight: 600 }}>
            Active Patients
          </Typography>
          <Typography sx={{ fontSize: 14, fontWeight: 800, color: '#2E7D32' }}>
            {activeCount}
          </Typography>
          <Divider orientation="vertical" flexItem />
          <Typography sx={{ fontSize: 11, color: '#327C8D', fontWeight: 600 }}>
            {countsLabel}
          </Typography>
        </Paper>
        <Chip
          label={allocatedToMeOnly ? 'Showing: My Allocation' : 'Showing: All Patients'}
          size="small"
          onClick={() => setAllocatedToMeOnly((prev) => !prev)}
          variant={allocatedToMeOnly ? 'filled' : 'outlined'}
          sx={{
            cursor: 'pointer',
            fontSize: 11,
            fontWeight: 700,
            bgcolor: allocatedToMeOnly ? '#E8F5E9' : '#FFFFFF',
            color: allocatedToMeOnly ? '#2E7D32' : '#3D484B',
            borderColor: allocatedToMeOnly ? '#A5D6A7' : '#CFD8DC',
          }}
        />
      </Box>
      {/* Team quick-filter chips */}
      {teamChips.length > 0 && (
        <Box sx={{ display: 'flex', gap: 0.75, flexWrap: 'wrap', alignItems: 'center' }}>
          <Typography variant="caption" color="text.secondary" sx={{ fontWeight: 600, mr: 0.5 }}>Teams:</Typography>
          <Chip label={`All (${data?.pagination?.total ?? 0})`} size="small"
            variant={!teamFilter ? 'filled' : 'outlined'}
            onClick={() => setTeamFilter('')}
            sx={{ cursor: 'pointer', fontSize: 11, fontWeight: 600, ...(
              !teamFilter ? { bgcolor: '#327C8D', color: '#fff' } : {}
            ) }} />
          {teamChips.map(t => (
            <Chip key={t.id} label={`${t.name} (${t.count})`} size="small"
              variant={teamFilter === t.id ? 'filled' : 'outlined'}
              onClick={() => setTeamFilter(teamFilter === t.id ? '' : t.id)}
              sx={{ cursor: 'pointer', fontSize: 11, fontWeight: 600, ...(
                teamFilter === t.id ? { bgcolor: '#b8621a', color: '#fff' } : {}
              ) }} />
          ))}
        </Box>
      )}

      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 2, flexWrap: 'wrap' }}>
        <PatientSearchBar
          search={search} onSearchChange={setSearch}
          teamFilter={teamFilter} onTeamFilterChange={setTeamFilter}
          clinicianFilter={clinicianFilter} onClinicianFilterChange={setClinicianFilter}
          consultantFilter={consultantFilter} onConsultantFilterChange={setConsultantFilter}
          juniorMedicalFilter={juniorMedicalFilter} onJuniorMedicalFilterChange={setJuniorMedicalFilter}
          teams={teams} clinicians={clinicians}
        />
        <ListExportBar
          title="Patient List"
          subtitle={`${filteredPatients.length} patient${filteredPatients.length === 1 ? '' : 's'} exported`}
          columns={['Patient Name', 'DOB', 'UR Number', 'Team', 'Key Clinician', 'Consultant', 'Junior Medical Staff']}
          rows={filteredPatients.map(p => [
            `${p.givenName} ${p.familyName}`,
            p.dateOfBirth ? new Date(p.dateOfBirth).toLocaleDateString('en-AU') : '',
            p.emrNumber ?? '',
            teamByPatient.get(p.id) ?? '',
            clinicianByPatient.get(p.id)?.name ?? '',
            consultantByPatient.get(p.id) ?? '',
            juniorMedicalByPatient.get(p.id) ?? '',
          ])}
          compact
        />
      </Box>

      {isError && <Alert role="alert" severity="error">Failed to load patients. Please try again.</Alert>}

      <Paper elevation={0} sx={{ border: '1px solid', borderColor: 'divider', borderRadius: 2, overflow: 'hidden' }}>
        <TableContainer role="region" aria-label="Data table">
          <Table size="small" stickyHeader>
            <TableHead>
              <TableRow>
                {COLUMNS.map(col => (
                  <TableCell key={col} sx={{ fontFamily: 'Albert Sans, sans-serif', fontWeight: 600, fontSize: 13, color: '#3D484B', backgroundColor: '#FBF8F5' }}>
                    {col}
                  </TableCell>
                ))}
              </TableRow>
            </TableHead>
            <TableBody>
              {isLoading ? (
                <TableRow>
                  <TableCell colSpan={COLUMNS.length} align="center" sx={{ py: 6 }}>
                    <CircularProgress role="progressbar" aria-label="Loading" size={28} sx={{ color: '#b8621a' }} />
                  </TableCell>
                </TableRow>
              ) : !filteredPatients.length ? (
                <TableRow>
                  <TableCell colSpan={COLUMNS.length} align="center" sx={{ py: 6 }}>
                    <Typography variant="body2" color="text.secondary" fontFamily="Albert Sans, sans-serif">
                      No patients found
                    </Typography>
                  </TableCell>
                </TableRow>
              ) : (
                filteredPatients.map(p => (
                  <PatientRow
                    key={p.id}
                    patient={p}
                    onClick={handleRowClick}
                    teamName={teamByPatient.get(p.id) ?? ''}
                    clinicianName={clinicianByPatient.get(p.id)?.name ?? ''}
                    consultantName={consultantByPatient.get(p.id) ?? ''}
                    juniorMedicalName={juniorMedicalByPatient.get(p.id) ?? ''}
                    attachmentCount={attachCounts?.[p.id] ?? 0}
                    onQuickNote={(id) => setQuickNotePatientId(id)}
                    onDeactivate={(id) => setDeactivateTarget(id)}
                    onReactivate={(id) => reactivateMut.mutate(id)}
                    reviewOverdue={reviewStatus?.[p.id]}
                  />
                ))
              )}
            </TableBody>
          </Table>
        </TableContainer>
        <TablePagination
          component="div"
          count={filteredPatientIds ? filteredPatients.length : (data?.pagination?.total ?? 0)}
          page={page}
          onPageChange={(_, newPage) => setPage(newPage)}
          rowsPerPage={rowsPerPage}
          onRowsPerPageChange={e => { setRowsPerPage(parseInt(e.target.value, 10)); setPage(0); }}
          rowsPerPageOptions={[10, 20, 50]}
          sx={{ fontFamily: 'Albert Sans, sans-serif' }}
        />
      </Paper>

      {/* Quick Note Dialog */}
      {quickNotePatientId && (
        <AddNoteDialog open onClose={() => setQuickNotePatientId(null)} patientId={quickNotePatientId} noteType="progress" />
      )}

      {/* Deactivate Confirmation Dialog */}
      <Dialog open={!!deactivateTarget} onClose={() => { setDeactivateTarget(null); setDeactivateError(null); }} maxWidth="sm" fullWidth>
        <DialogTitle>Deactivate Patient</DialogTitle>
        <DialogContent>
          {canDeactivateData && !canDeactivateData.canDeactivate ? (
            <Alert severity="error" sx={{ mt: 1 }}>
              Cannot deactivate — this patient has {canDeactivateData.activeEpisodeCount} active episode(s). Close all episodes before deactivating.
            </Alert>
          ) : (
            <Typography variant="body2" sx={{ mt: 1 }}>
              Are you sure you want to deactivate this patient? They will no longer appear in the active patient list. This can be reversed by reactivating them later.
            </Typography>
          )}
          {deactivateError && (
            <Alert severity="error" sx={{ mt: 1 }}>{deactivateError}</Alert>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => { setDeactivateTarget(null); setDeactivateError(null); }}>Cancel</Button>
          <Button
            variant="contained"
            color="error"
            disabled={deactivateMut.isPending || (canDeactivateData != null && !canDeactivateData.canDeactivate)}
            onClick={() => { if (deactivateTarget) deactivateMut.mutate(deactivateTarget); }}
          >
            {deactivateMut.isPending ? 'Deactivating...' : 'Deactivate'}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
};
