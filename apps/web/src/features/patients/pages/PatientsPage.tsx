import React, { useMemo, useState } from 'react';
import {
  Alert, Box, Button, Checkbox, Chip, CircularProgress, Dialog, DialogActions,
  DialogContent, DialogTitle, Divider, FormControl, Grid, IconButton, InputLabel, MenuItem,
  Paper, Select, TextField, Tooltip, Typography,
} from '@mui/material';
import PersonAddAltIcon from '@mui/icons-material/PersonAddAlt';
import SwapHorizIcon from '@mui/icons-material/SwapHoriz';
import ScheduleIcon from '@mui/icons-material/Schedule';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import PlayArrowIcon from '@mui/icons-material/PlayArrow';
import { PatientList } from '../components/PatientList';
import { PatientRegistrationWizard } from '../components/registration/PatientRegistrationWizard';
import { apiClient } from '../../../shared/services/apiClient';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { patientsKeys, episodesKeys } from '../queryKeys';
import { resolveTeamId, rowIncludesClinician, toErrorMessage } from './patientsPageSupport';
export const PatientsPage: React.FC = () => {
  const [wizardOpen, setWizardOpen] = useState(false);
  const [bulkOpen, setBulkOpen] = useState(false);
  const [transitionOpen, setTransitionOpen] = useState(false);
  return (
    <Box sx={{ px: { xs: 2, sm: 3, md: 4 }, py: 3, bgcolor: '#FBF8F5', minHeight: '100vh' }}>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', mb: 3, flexWrap: 'wrap', gap: 2 }}>
        <Box>
          <Typography variant="h5" fontWeight={700} fontFamily="Albert Sans, sans-serif" sx={{ color: '#3D484B', lineHeight: 1.2 }}>
            Patients
          </Typography>
          <Typography variant="body2" color="text.secondary" fontFamily="Albert Sans, sans-serif" sx={{ mt: 0.5 }}>
            Search, view and manage patient records
          </Typography>
        </Box>
        <Box sx={{ display: 'flex', gap: 1 }}>
          <Button variant="outlined" size="small" startIcon={<ScheduleIcon />} onClick={() => setTransitionOpen(true)}
            sx={{ textTransform: 'none', borderColor: '#7B1FA2', color: '#7B1FA2' }}>
            Planned Transitions
          </Button>
          <Button variant="outlined" size="small" startIcon={<SwapHorizIcon />} onClick={() => setBulkOpen(true)}
            sx={{ textTransform: 'none', borderColor: '#327C8D', color: '#327C8D' }}>
            Bulk Reassign
          </Button>
          <Button startIcon={<PersonAddAltIcon />} variant="contained" onClick={() => setWizardOpen(true)}
            sx={{ fontFamily: 'Albert Sans, sans-serif', fontWeight: 600, bgcolor: '#b8621a', px: 2.5, py: 1, borderRadius: 2, textTransform: 'none', '&:hover': { bgcolor: '#d6741f' } }}>
            Register Patient
          </Button>
        </Box>
      </Box>
      <PatientList />
      <PatientRegistrationWizard open={wizardOpen} onClose={() => setWizardOpen(false)} />
      <BulkReassignDialog open={bulkOpen} onClose={() => setBulkOpen(false)} />
      <PlannedTransitionDialog open={transitionOpen} onClose={() => setTransitionOpen(false)} />
    </Box>
  );
};
interface AssignedPatient {
  patientId: string;
  givenName: string;
  familyName: string;
  emrNumber: string;
  episodeId?: string | null;
  team: string | null;
  teamId?: string | null;
}
interface TeamAssignmentRosterRow {
  patientId: string;
  givenName: string | null;
  familyName: string | null;
  emrNumber: string | null;
  orgUnitId: string;
  orgUnitName: string;
  primaryClinicianId: string | null;
  clinicianName: string;
  referralStatus?: string | null;
  isActive?: boolean;
  episodeId?: string | null;
  openEpisodeId?: string | null;
  openEpisodeTeamId?: string | null;
  openEpisodePrimaryClinicianId?: string | null;
  openEpisodeKeyWorkerId?: string | null;
  effectivePrimaryClinicianId?: string | null;
  effectiveClinicianName?: string | null;
  keyWorkerId?: string | null;
  keyWorkerName?: string | null;
  mdt?: Array<Record<string, unknown>>;
}
interface OrgUnitOption {
  id: string;
  name: string;
  level?: number | string;
}
interface BulkReassignDialogProps { open: boolean; onClose: () => void }
function BulkReassignDialog({ open, onClose }: BulkReassignDialogProps) {
  const qc = useQueryClient();
  const [reassignType, setReassignType] = useState<'clinician' | 'team'>('clinician');
  const [fromClinician, setFromClinician] = useState('');
  const [toClinician, setToClinician] = useState('');
  const [fromTeam, setFromTeam] = useState('');
  const [toTeam, setToTeam] = useState('');
  const [selectedPatients, setSelectedPatients] = useState<string[]>([]);
  const [scope, setScope] = useState<'all' | 'selected'>('all');
  const [saving, setSaving] = useState(false);
  const [result, setResult] = useState('');
  const { data: staffList } = useQuery({
    queryKey: patientsKeys.staffLookup(),
    queryFn: () => apiClient.get<{ id: string; givenName: string; familyName: string; role: string }[]>('staff/lookup'),
    enabled: open,
  });
  const { data: orgUnits = [] } = useQuery({
    queryKey: patientsKeys.unitsFlat(),
    queryFn: () => apiClient.get<{ units: OrgUnitOption[] }>('org-settings/units').then((r) => r.units ?? []),
    enabled: open,
  });
  const { data: assignmentRows = [], isLoading: loadingAssignments } = useQuery({
    queryKey: patientsKeys.patientTeamAssignments(),
    queryFn: () => apiClient.get<{ assignments: TeamAssignmentRosterRow[] }>('patients/team-assignments').then((r) => r.assignments ?? []),
    enabled: open,
  });
  const teamNameById = useMemo(() => {
    const map = new Map<string, string>();
    for (const team of orgUnits) {
      map.set(team.id, team.name);
    }
    return map;
  }, [orgUnits]);
  const sourceTeamOptions = useMemo(() => {
    const seen = new Set<string>();
    const options: { id: string; name: string }[] = [];
    for (const row of assignmentRows) {
      if (row.isActive === false) continue;
      if (!row.orgUnitId || seen.has(row.orgUnitId)) continue;
      seen.add(row.orgUnitId);
      options.push({ id: row.orgUnitId, name: row.orgUnitName || teamNameById.get(row.orgUnitId) || row.orgUnitId });
    }
    options.sort((a, b) => a.name.localeCompare(b.name));
    return options;
  }, [assignmentRows, teamNameById]);
  const allTeamOptions = useMemo(() => {
    const seen = new Set<string>();
    const options: { id: string; name: string }[] = [];
    for (const team of orgUnits) {
      if (seen.has(team.id)) continue;
      seen.add(team.id);
      options.push({ id: team.id, name: team.name });
    }
    for (const team of sourceTeamOptions) {
      if (seen.has(team.id)) continue;
      seen.add(team.id);
      options.push(team);
    }
    options.sort((a, b) => a.name.localeCompare(b.name));
    return options;
  }, [orgUnits, sourceTeamOptions]);

  const patientList = useMemo(() => {
    const sourceRows = assignmentRows.filter((row) => {
      const active = row.isActive !== false;
      if (!active) return false;
      if (reassignType === 'clinician') {
        return rowIncludesClinician(row, fromClinician);
      }
      return !!fromTeam && resolveTeamId(row) === fromTeam;
    });
    const map = new Map<string, AssignedPatient>();
    for (const row of sourceRows) {
      const existing = map.get(row.patientId);
      const teamId = resolveTeamId(row);
      const teamName = (teamId ? teamNameById.get(teamId) : null) ?? row.orgUnitName ?? null;
      const candidate: AssignedPatient = {
        patientId: row.patientId,
        givenName: row.givenName ?? '',
        familyName: row.familyName ?? '',
        emrNumber: row.emrNumber ?? '—',
        episodeId: row.episodeId ?? row.openEpisodeId ?? null,
        team: teamName,
        teamId,
      };
      if (!existing || (!existing.episodeId && candidate.episodeId)) {
        map.set(row.patientId, candidate);
      }
    }
    return [...map.values()].sort((a, b) => `${a.familyName} ${a.givenName}`.localeCompare(`${b.familyName} ${b.givenName}`));
  }, [assignmentRows, fromClinician, fromTeam, reassignType, teamNameById]);

  const isLoadingList = loadingAssignments && ((reassignType === 'clinician' && !!fromClinician) || (reassignType === 'team' && !!fromTeam));

  const handleFromClinicianChange = (id: string) => {
    setFromClinician(id);
    setSelectedPatients([]);
    setResult('');
  };
  const handleFromTeamChange = (team: string) => {
    setFromTeam(team);
    setSelectedPatients([]);
    setResult('');
  };

  const togglePatient = (patientId: string) => {
    setSelectedPatients(prev =>
      prev.includes(patientId) ? prev.filter(p => p !== patientId) : [...prev, patientId]
    );
  };

  const toggleAll = () => {
    if (selectedPatients.length === patientList.length) {
      setSelectedPatients([]);
    } else {
      setSelectedPatients(patientList.map(p => p.patientId));
    }
  };

  const handleReassign = async () => {
    setSaving(true); setResult('');
    try {
      if (reassignType === 'clinician') {
        if (!fromClinician || !toClinician) { setResult('Select both source and destination clinician.'); setSaving(false); return; }
        const res = await apiClient.post<{ ok: boolean; count: number }>('staff-settings/bulk-reassign', {
          type: 'clinician',
          fromId: fromClinician,
          toId: toClinician,
          patientIds: scope === 'selected' ? selectedPatients : undefined,
        });
        const fromName = staffList?.find(s => s.id === fromClinician);
        const toName = staffList?.find(s => s.id === toClinician);
        setResult(`Successfully reassigned ${res.count} patient episode(s) from ${fromName?.givenName ?? ''} ${fromName?.familyName ?? ''} to ${toName?.givenName ?? ''} ${toName?.familyName ?? ''}.`);
      } else {
        if (!fromTeam || !toTeam) { setResult('Select both source and destination team.'); setSaving(false); return; }
        const res = await apiClient.post<{ ok: boolean; count: number }>('staff-settings/bulk-reassign', {
          type: 'team',
          fromTeam,
          toTeam,
          patientIds: scope === 'selected' ? selectedPatients : undefined,
        });
        const fromTeamName = teamNameById.get(fromTeam) ?? fromTeam;
        const toTeamName = teamNameById.get(toTeam) ?? toTeam;
        setResult(`Successfully reassigned ${res.count} patient episode(s) from ${fromTeamName} to ${toTeamName}.`);
      }
      qc.invalidateQueries({ queryKey: patientsKeys.all });
      qc.invalidateQueries({ queryKey: episodesKeys.all });
      qc.invalidateQueries({ queryKey: patientsKeys.bulkReassign.root() });
      qc.invalidateQueries({ queryKey: patientsKeys.detailAll() });
    } catch (err: unknown) {
      setResult(`Error: ${toErrorMessage(err, 'Reassignment failed')}`);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog aria-labelledby="dialog-title" open={open} onClose={onClose} maxWidth="md" fullWidth>
      <DialogTitle id="dialog-title" sx={{ fontWeight: 700, display: 'flex', alignItems: 'center', gap: 1 }}>
        <SwapHorizIcon sx={{ color: '#327C8D' }} />
        Bulk Patient Reassignment
      </DialogTitle>
      <Divider />
      <DialogContent>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
          Transfer patients between clinicians or teams. This updates the key clinician or team on all open episodes.
        </Typography>

        <Grid container spacing={2}>
          {/* Reassign Type */}
          <Grid size={{ xs: 12, sm: 6 }}>
            <FormControl fullWidth size="small">
              <InputLabel>Reassign By</InputLabel>
              <Select value={reassignType} onChange={e => { setReassignType(e.target.value as 'clinician' | 'team'); setResult(''); setSelectedPatients([]); }} label="Reassign By">
                <MenuItem value="clinician">Clinician to Clinician</MenuItem>
                <MenuItem value="team">Team to Team</MenuItem>
              </Select>
            </FormControl>
          </Grid>
          <Grid size={{ xs: 12, sm: 6 }}>
            <FormControl fullWidth size="small">
              <InputLabel>Scope</InputLabel>
              <Select value={scope} onChange={e => { setScope(e.target.value as 'all' | 'selected'); setSelectedPatients([]); }} label="Scope">
                <MenuItem value="all">All patients from source</MenuItem>
                <MenuItem value="selected">Selected patients only</MenuItem>
              </Select>
            </FormControl>
          </Grid>

          {/* Clinician Reassignment */}
          {reassignType === 'clinician' && (
            <>
              <Grid size={{ xs: 12, sm: 6 }}>
                <FormControl fullWidth size="small">
                  <InputLabel>From Clinician *</InputLabel>
                  <Select value={fromClinician} onChange={e => handleFromClinicianChange(e.target.value)} label="From Clinician *">
                    <MenuItem value="">— Select —</MenuItem>
                    {staffList?.map(s => <MenuItem key={s.id} value={s.id}>{s.givenName} {s.familyName}</MenuItem>)}
                  </Select>
                </FormControl>
              </Grid>
              <Grid size={{ xs: 12, sm: 6 }}>
                <FormControl fullWidth size="small">
                  <InputLabel>To Clinician *</InputLabel>
                  <Select value={toClinician} onChange={e => setToClinician(e.target.value)} label="To Clinician *">
                    <MenuItem value="">— Select —</MenuItem>
                    {staffList?.filter(s => s.id !== fromClinician).map(s => <MenuItem key={s.id} value={s.id}>{s.givenName} {s.familyName}</MenuItem>)}
                  </Select>
                </FormControl>
              </Grid>
            </>
          )}

          {/* Team Reassignment */}
          {reassignType === 'team' && (
            <>
              <Grid size={{ xs: 12, sm: 6 }}>
                <FormControl fullWidth size="small">
                  <InputLabel>From Team *</InputLabel>
                  <Select value={fromTeam} onChange={e => handleFromTeamChange(e.target.value)} label="From Team *">
                    <MenuItem value="">— Select —</MenuItem>
                    {sourceTeamOptions.map((t) => <MenuItem key={t.id} value={t.id}>{t.name}</MenuItem>)}
                  </Select>
                </FormControl>
              </Grid>
              <Grid size={{ xs: 12, sm: 6 }}>
                <FormControl fullWidth size="small">
                  <InputLabel>To Team *</InputLabel>
                  <Select value={toTeam} onChange={e => setToTeam(e.target.value)} label="To Team *">
                    <MenuItem value="">— Select —</MenuItem>
                    {allTeamOptions.filter((t) => t.id !== fromTeam).map((t) => <MenuItem key={t.id} value={t.id}>{t.name}</MenuItem>)}
                  </Select>
                </FormControl>
              </Grid>
            </>
          )}

          {/* Patient List — shows patients currently assigned to the source */}
          {(fromClinician || fromTeam) && patientList.length > 0 && (
            <Grid size={{ xs: 12 }}>
              <Paper variant="outlined" sx={{ p: 0, maxHeight: 280, overflow: 'auto' }}>
                <Box sx={{ display: 'flex', alignItems: 'center', px: 2, py: 1, bgcolor: '#f5f5f5', borderBottom: '1px solid', borderColor: 'divider' }}>
                  {scope === 'selected' && (
                    <Checkbox
                      size="small"
                      checked={selectedPatients.length === patientList.length && patientList.length > 0}
                      indeterminate={selectedPatients.length > 0 && selectedPatients.length < patientList.length}
                      onChange={toggleAll}
                      sx={{ p: 0.5, mr: 1 }}
                    />
                  )}
                  <Typography variant="caption" fontWeight={600} sx={{ flex: 1 }}>
                    {patientList.length} patient(s) currently assigned
                    {scope === 'selected' && selectedPatients.length > 0 && ` — ${selectedPatients.length} selected`}
                  </Typography>
                </Box>
                {patientList.map(p => (
                  <Box
                    key={p.patientId}
                    sx={{
                      display: 'flex', alignItems: 'center', px: 2, py: 0.75,
                      borderBottom: '1px solid', borderColor: 'divider',
                      bgcolor: selectedPatients.includes(p.patientId) ? '#E8F4F8' : 'transparent',
                      '&:hover': { bgcolor: '#f9f9f9' },
                    }}
                  >
                    {scope === 'selected' && (
                      <Checkbox
                        size="small"
                        checked={selectedPatients.includes(p.patientId)}
                        onChange={() => togglePatient(p.patientId)}
                        sx={{ p: 0.5, mr: 1 }}
                      />
                    )}
                    <Typography variant="body2" fontWeight={500} sx={{ flex: 1 }}>
                      {p.familyName}, {p.givenName}
                    </Typography>
                    <Chip label={p.emrNumber} size="small" variant="outlined" sx={{ fontSize: 11, mr: 1 }} />
                    {p.team && <Chip label={p.team} size="small" sx={{ fontSize: 11, bgcolor: '#E8F4F8' }} />}
                  </Box>
                ))}
              </Paper>
            </Grid>
          )}

          {/* Loading state */}
          {(fromClinician || fromTeam) && isLoadingList && (
            <Grid size={{ xs: 12 }}>
              <Box sx={{ display: 'flex', justifyContent: 'center', py: 2 }}>
                <CircularProgress role="progressbar" aria-label="Loading" size={20} sx={{ color: '#327C8D' }} />
                <Typography variant="body2" color="text.secondary" sx={{ ml: 1 }}>Loading assigned patients...</Typography>
              </Box>
            </Grid>
          )}

          {/* No patients found */}
          {(fromClinician || fromTeam) && !isLoadingList && patientList.length === 0 && (
            <Grid size={{ xs: 12 }}>
              <Alert severity="info" sx={{ fontSize: 12 }}>
                No open episodes found for the selected {reassignType === 'clinician' ? 'clinician' : 'team'}.
              </Alert>
            </Grid>
          )}

          {/* Summary */}
          <Grid size={{ xs: 12 }}>
            <Alert severity="info" sx={{ fontSize: 12 }}>
              {reassignType === 'clinician'
                ? `This will transfer clinician ownership on ${scope === 'all' ? `all ${patientList.length}` : selectedPatients.length} open episode(s) from the source clinician to the destination clinician.`
                : `This will update the team assignment on ${scope === 'all' ? `all ${patientList.length}` : selectedPatients.length} open episode(s) from ${fromTeam || '...'} to ${toTeam || '...'}.`}
            </Alert>
          </Grid>

          {result && (
            <Grid size={{ xs: 12 }}>
              <Alert severity={result.startsWith('Error') ? 'error' : 'success'}>{result}</Alert>
            </Grid>
          )}
        </Grid>
      </DialogContent>
      <Divider />
      <DialogActions sx={{ px: 3, py: 2 }}>
        <Button onClick={onClose} sx={{ color: 'text.secondary' }}>Cancel</Button>
        <Button variant="contained" onClick={handleReassign}
          disabled={saving || (scope === 'selected' && selectedPatients.length === 0) || patientList.length === 0}
          sx={{ bgcolor: '#327C8D', '&:hover': { bgcolor: '#265f6d' } }}>
          {saving ? <CircularProgress role="progressbar" aria-label="Loading" size={16} sx={{ color: '#fff' }} /> : `Reassign ${scope === 'all' ? patientList.length : selectedPatients.length} Patient(s)`}
        </Button>
      </DialogActions>
    </Dialog>
  );
}


interface TransitionPlan {
  id: string;
  fromStaffId: string;
  fromStaffName: string;
  reason: string;
  effective_date: string;
  status: string;
  created_by_name: string;
  approved_by_name: string | null;
  assignment_count: number;
  notes: string | null;
  createdAt: string;
}

interface TransitionAssignment {
  id: string;
  patientId: string;
  patientGivenName: string;
  patientFamilyName: string;
  emrNumber: string;
  toStaffId: string;
  toStaffName: string;
  toTeam: string | null;
  status: string;
  handover_notes: string | null;
  primaryDiagnosis: string | null;
  team: string | null;
}

const REASONS = [
  { value: 'resignation', label: 'Resignation' },
  { value: 'retirement', label: 'Retirement' },
  { value: 'parental_leave', label: 'Parental Leave' },
  { value: 'extended_leave', label: 'Extended Leave' },
  { value: 'transfer', label: 'Transfer to Another Service' },
  { value: 'secondment', label: 'Secondment' },
  { value: 'other', label: 'Other' },
];

interface PlannedTransitionDialogProps { open: boolean; onClose: () => void }
function PlannedTransitionDialog({ open, onClose }: PlannedTransitionDialogProps) {
  const qc = useQueryClient();
  const [view, setView] = useState<'list' | 'create' | 'detail'>('list');
  const [selectedPlan, setSelectedPlan] = useState<string | null>(null);

  const [fromStaff, setFromStaff] = useState('');
  const [reason, setReason] = useState('resignation');
  const [effectiveDate, setEffectiveDate] = useState('');
  const [notes, setNotes] = useState('');
  const [assignments, setAssignments] = useState<{ patientId: string; episodeId?: string; toStaffId: string; toTeam?: string }[]>([]);
  const [saving, setSaving] = useState(false);
  const [result, setResult] = useState('');

  const { data: staffList } = useQuery({
    queryKey: patientsKeys.staffLookup(),
    queryFn: () => apiClient.get<{ id: string; givenName: string; familyName: string; role: string }[]>('staff/lookup'),
    enabled: open,
  });

  const { data: transitions, isLoading } = useQuery({
    queryKey: patientsKeys.plannedTransitions(),
    queryFn: () => apiClient.get<{ transitions: TransitionPlan[] }>('staff-settings/transitions').then(r => r.transitions),
    enabled: open,
  });

  const { data: assignmentRows = [], isLoading: loadingAssignments } = useQuery({
    queryKey: patientsKeys.patientTeamAssignments(),
    queryFn: () => apiClient.get<{ assignments: TeamAssignmentRosterRow[] }>('patients/team-assignments').then((r) => r.assignments ?? []),
    enabled: open,
  });

  const staffPatients = useMemo(() => {
    if (!fromStaff) return [] as AssignedPatient[];
    const sourceRows = assignmentRows.filter((row) => (row.isActive !== false) && rowIncludesClinician(row, fromStaff));
    const map = new Map<string, AssignedPatient>();
    for (const row of sourceRows) {
      const existing = map.get(row.patientId);
      const teamId = resolveTeamId(row);
      const teamName = row.orgUnitName ?? null;
      const candidate: AssignedPatient = {
        patientId: row.patientId,
        givenName: row.givenName ?? '',
        familyName: row.familyName ?? '',
        emrNumber: row.emrNumber ?? '—',
        episodeId: row.episodeId ?? row.openEpisodeId ?? null,
        team: teamName,
        teamId,
      };
      if (!existing || (!existing.episodeId && candidate.episodeId)) {
        map.set(row.patientId, candidate);
      }
    }
    return [...map.values()].sort((a, b) => `${a.familyName} ${a.givenName}`.localeCompare(`${b.familyName} ${b.givenName}`));
  }, [assignmentRows, fromStaff]);

  const { data: planDetail } = useQuery({
    queryKey: patientsKeys.plannedTransitionDetail(selectedPlan),
    queryFn: () => apiClient.get<{ transition: TransitionPlan; assignments: TransitionAssignment[] }>(`staff-settings/transitions/${selectedPlan}`),
    enabled: !!selectedPlan,
  });

  const handleFromStaffChange = (id: string) => {
    setFromStaff(id);
    setAssignments([]);
  };

  const autoDistribute = (targetStaffIds: string[]) => {
    if (!staffPatients.length || !targetStaffIds.length) return;
    const newAssignments = staffPatients.map((p, i) => ({
      patientId: p.patientId,
      episodeId: p.episodeId ?? undefined,
      toStaffId: targetStaffIds[i % targetStaffIds.length],
      toTeam: p.teamId ?? undefined,
    }));
    setAssignments(newAssignments);
  };

  const handleCreate = async () => {
    if (!fromStaff || !effectiveDate || !assignments.length) {
      setResult('Please select departing staff, effective date, and assign all patients.');
      return;
    }
    setSaving(true); setResult('');
    try {
      await apiClient.post('staff-settings/transitions', {
        fromStaffId: fromStaff,
        reason,
        effectiveDate,
        notes: notes || null,
        assignments: assignments.map(a => ({
          patientId: a.patientId,
          episodeId: a.episodeId,
          toStaffId: a.toStaffId,
          toTeam: a.toTeam,
        })),
      });
      setResult('Transition plan created successfully.');
      qc.invalidateQueries({ queryKey: patientsKeys.plannedTransitions() });
      setTimeout(() => { setView('list'); setResult(''); setFromStaff(''); setAssignments([]); setNotes(''); }, 1500);
    } catch (err: unknown) {
      setResult(`Error: ${toErrorMessage(err, 'Failed to create plan')}`);
    } finally {
      setSaving(false);
    }
  };

  const handleExecute = async (planId: string) => {
    if (!confirm('This will move all patients to their assigned clinicians now. Continue?')) return;
    try {
      const res = await apiClient.post<{ ok: boolean; executed: number; total: number }>(`staff-settings/transitions/${planId}/execute`);
      setResult(`Executed: ${res.executed}/${res.total} patients transferred.`);
      qc.invalidateQueries({ queryKey: patientsKeys.plannedTransitions() });
      qc.invalidateQueries({ queryKey: patientsKeys.all });
      qc.invalidateQueries({ queryKey: episodesKeys.all });
    } catch (err: unknown) {
      setResult(`Error: ${toErrorMessage(err, 'Failed to execute plan')}`);
    }
  };

  const handleDelete = async (planId: string) => {
    if (!confirm('Cancel this transition plan?')) return;
    try {
      await apiClient.delete(`staff-settings/transitions/${planId}`);
      qc.invalidateQueries({ queryKey: patientsKeys.plannedTransitions() });
      setSelectedPlan(null);
      setView('list');
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error('BUG-520: failed to cancel transition plan', { err, planId });
      alert(`Failed to cancel transition plan: ${msg}`);
    }
  };

  return (
    <Dialog aria-labelledby="dialog-title" open={open} onClose={onClose} maxWidth="lg" fullWidth>
      <DialogTitle id="dialog-title" sx={{ fontWeight: 700, display: 'flex', alignItems: 'center', gap: 1 }}>
        <ScheduleIcon sx={{ color: '#7B1FA2' }} />
        Planned Staff Transitions
        <Box sx={{ ml: 'auto', display: 'flex', gap: 1 }}>
          {view !== 'list' && (
            <Button size="small" onClick={() => { setView('list'); setSelectedPlan(null); setResult(''); }}
              sx={{ textTransform: 'none', color: 'text.secondary' }}>Back to List</Button>
          )}
          {view === 'list' && (
            <Button size="small" variant="contained" onClick={() => setView('create')}
              sx={{ textTransform: 'none', bgcolor: '#7B1FA2', '&:hover': { bgcolor: '#6A1B9A' } }}>
              New Transition Plan
            </Button>
          )}
        </Box>
      </DialogTitle>
      <Divider />
      <DialogContent sx={{ minHeight: 400 }}>

        {/* ── LIST VIEW ── */}
        {view === 'list' && (
          <Box>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
              Plan ahead when a staff member is leaving. Distribute their caseload across one or more clinicians, to take effect on a future date.
            </Typography>
            {isLoading && <CircularProgress role="progressbar" aria-label="Loading" size={20} />}
            {transitions?.length === 0 && !isLoading && (
              <Alert severity="info">No planned transitions. Click "New Transition Plan" to create one.</Alert>
            )}
            {transitions?.map(t => (
              <Paper key={t.id} variant="outlined"
                role="button"
                tabIndex={0}
                aria-label={`Open transition plan for ${t.fromStaffName}`}
                onClick={() => { setSelectedPlan(t.id); setView('detail'); }}
                onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setSelectedPlan(t.id); setView('detail'); } }}
                sx={{ p: 2, mb: 1.5, cursor: 'pointer', '&:hover': { borderColor: '#7B1FA2' }, '&:focus-visible': { outline: '2px solid #7B1FA2', outlineOffset: 2 } }}>
                <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <Box>
                    <Typography variant="subtitle2" fontWeight={600}>{t.fromStaffName}</Typography>
                    <Typography variant="caption" color="text.secondary">
                      {REASONS.find(r => r.value === t.reason)?.label ?? t.reason} — Effective {new Date(t.effective_date).toLocaleDateString('en-AU')}
                    </Typography>
                  </Box>
                  <Box sx={{ display: 'flex', gap: 1, alignItems: 'center' }}>
                    <Chip label={`${t.assignment_count} patients`} size="small" />
                    <Chip label={t.status} size="small" sx={{
                      bgcolor: t.status === 'executed' ? '#E8F5E9' : t.status === 'approved' ? '#E3F2FD' : t.status === 'draft' ? '#FFF3E0' : '#eee',
                      color: t.status === 'executed' ? '#2E7D32' : t.status === 'approved' ? '#1565C0' : t.status === 'draft' ? '#E65100' : '#666',
                      fontWeight: 600,
                    }} />
                  </Box>
                </Box>
              </Paper>
            ))}
          </Box>
        )}

        {/* ── DETAIL VIEW ── */}
        {view === 'detail' && planDetail && (
          <Box>
            <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
              <Box>
                {/* Audit Tier 9.6 — the query is already typed {transition, assignments}; `as any` casts removed. */}
                <Typography variant="h6" fontWeight={600}>{planDetail.transition?.fromStaffName ?? 'Staff'}</Typography>
                <Typography variant="body2" color="text.secondary">
                  {REASONS.find(r => r.value === planDetail.transition?.reason)?.label} — Effective {planDetail.transition?.effective_date ? new Date(planDetail.transition.effective_date).toLocaleDateString('en-AU') : '—'}
                </Typography>
                {planDetail.transition?.notes && (
                  <Typography variant="body2" sx={{ mt: 0.5 }}>{planDetail.transition.notes}</Typography>
                )}
              </Box>
              <Box sx={{ display: 'flex', gap: 1 }}>
                {planDetail.transition?.status !== 'executed' && (
                  <>
                    <Tooltip title="Execute now — transfer all patients">
                      <Button size="small" variant="contained" startIcon={<PlayArrowIcon />}
                        onClick={() => handleExecute(planDetail.transition.id)}
                        sx={{ bgcolor: '#2E7D32', '&:hover': { bgcolor: '#1B5E20' }, textTransform: 'none' }}>
                        Execute Now
                      </Button>
                    </Tooltip>
                    <Tooltip title="Cancel this plan">
                      <IconButton size="small" color="error" onClick={() => handleDelete(planDetail.transition.id)}>
                        <DeleteOutlineIcon />
                      </IconButton>
                    </Tooltip>
                  </>
                )}
                {planDetail.transition?.status === 'executed' && (
                  <Chip icon={<CheckCircleIcon />} label="Executed" color="success" size="small" />
                )}
              </Box>
            </Box>

            <Paper variant="outlined" sx={{ overflow: 'auto' }}>
              <Box component="table" sx={{ width: '100%', fontSize: 12, '& th': { textAlign: 'left', py: 1, px: 1.5, bgcolor: '#f5f5f5', fontWeight: 600 }, '& td': { py: 0.75, px: 1.5, borderBottom: '1px solid #eee' } }}>
                <thead>
                  <tr><th>Patient</th><th>MRN</th><th>Diagnosis</th><th>Current Team</th><th>New Clinician</th><th>Status</th></tr>
                </thead>
                <tbody>
                  {planDetail.assignments?.map((a: TransitionAssignment) => (
                    <tr key={a.id}>
                      <td style={{ fontWeight: 500 }}>{a.patientFamilyName}, {a.patientGivenName}</td>
                      <td>{a.emrNumber}</td>
                      <td>{a.primaryDiagnosis ?? '—'}</td>
                      <td>{a.team ?? '—'}</td>
                      <td style={{ color: '#7B1FA2', fontWeight: 500 }}>{a.toStaffName}</td>
                      <td><Chip label={a.status} size="small" sx={{ fontSize: 10, height: 20 }} /></td>
                    </tr>
                  ))}
                </tbody>
              </Box>
            </Paper>
          </Box>
        )}

        {/* ── CREATE VIEW ── */}
        {view === 'create' && (
          <Box>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
              Select the departing staff member, set the effective date, then assign each patient to a new clinician.
            </Typography>
            <Grid container spacing={2} sx={{ mb: 2 }}>
              <Grid size={{ xs: 12, sm: 4 }}>
                <FormControl fullWidth size="small">
                  <InputLabel>Departing Staff *</InputLabel>
                  <Select value={fromStaff} onChange={e => handleFromStaffChange(e.target.value)} label="Departing Staff *">
                    <MenuItem value="">— Select —</MenuItem>
                    {staffList?.map(s => <MenuItem key={s.id} value={s.id}>{s.givenName} {s.familyName}</MenuItem>)}
                  </Select>
                </FormControl>
              </Grid>
              <Grid size={{ xs: 12, sm: 3 }}>
                <FormControl fullWidth size="small">
                  <InputLabel>Reason *</InputLabel>
                  <Select value={reason} onChange={e => setReason(e.target.value)} label="Reason *">
                    {REASONS.map(r => <MenuItem key={r.value} value={r.value}>{r.label}</MenuItem>)}
                  </Select>
                </FormControl>
              </Grid>
              <Grid size={{ xs: 12, sm: 3 }}>
                <TextField fullWidth size="small" type="date" label="Effective Date *" value={effectiveDate}
                  onChange={e => setEffectiveDate(e.target.value)} slotProps={{ inputLabel: { shrink: true } }} />
              </Grid>
              <Grid size={{ xs: 12, sm: 2 }}>
                <TextField fullWidth size="small" label="Notes" value={notes} onChange={e => setNotes(e.target.value)} />
              </Grid>
            </Grid>

            {/* Patient assignment list */}
            {fromStaff && staffPatients.length > 0 && (
              <>
                <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 1 }}>
                  <Typography variant="subtitle2" fontWeight={600}>
                    {staffPatients.length} patient(s) to reassign
                  </Typography>
                  <Box sx={{ display: 'flex', gap: 1 }}>
                    {staffList && staffList.filter(s => s.id !== fromStaff).length > 0 && (
                      <FormControl size="small" sx={{ minWidth: 200 }}>
                        <InputLabel>Auto-distribute to...</InputLabel>
                        <Select multiple value={[]} onChange={e => autoDistribute(e.target.value as string[])} label="Auto-distribute to...">
                          {staffList.filter(s => s.id !== fromStaff).map(s => (
                            <MenuItem key={s.id} value={s.id}>{s.givenName} {s.familyName}</MenuItem>
                          ))}
                        </Select>
                      </FormControl>
                    )}
                  </Box>
                </Box>

                <Paper variant="outlined" sx={{ maxHeight: 300, overflow: 'auto' }}>
                  {staffPatients.map((p) => {
                    const assigned = assignments.find(a => a.patientId === p.patientId);
                    return (
                      <Box key={p.patientId} sx={{ display: 'flex', alignItems: 'center', gap: 1.5, px: 2, py: 1, borderBottom: '1px solid', borderColor: 'divider' }}>
                        <Box sx={{ flex: 1 }}>
                          <Typography variant="body2" fontWeight={500}>{p.familyName}, {p.givenName}</Typography>
                          <Typography variant="caption" color="text.secondary">{p.emrNumber} — {p.team ?? 'No team'}</Typography>
                        </Box>
                        <FormControl size="small" sx={{ minWidth: 180 }}>
                          <InputLabel>Assign to</InputLabel>
                          <Select value={assigned?.toStaffId ?? ''} label="Assign to"
                            onChange={e => {
                              const newId = e.target.value;
                              setAssignments(prev => {
                                const filtered = prev.filter(a => a.patientId !== p.patientId);
                                if (newId) filtered.push({ patientId: p.patientId, episodeId: p.episodeId ?? undefined, toStaffId: newId, toTeam: p.teamId ?? undefined });
                                return filtered;
                              });
                            }}>
                            <MenuItem value="">— Select —</MenuItem>
                            {staffList?.filter(s => s.id !== fromStaff).map(s => (
                              <MenuItem key={s.id} value={s.id}>{s.givenName} {s.familyName}</MenuItem>
                            ))}
                          </Select>
                        </FormControl>
                        {assigned && <CheckCircleIcon sx={{ color: '#4CAF50', fontSize: 18 }} />}
                      </Box>
                    );
                  })}
                </Paper>

                <Box sx={{ mt: 1, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <Typography variant="caption" color={assignments.length === staffPatients.length ? 'success.main' : 'warning.main'} fontWeight={600}>
                    {assignments.length}/{staffPatients.length} patients assigned
                  </Typography>
                  <Chip label={effectiveDate ? `Takes effect ${new Date(effectiveDate).toLocaleDateString('en-AU')}` : 'Set effective date'} size="small"
                    sx={{ bgcolor: '#F3E5F5', color: '#7B1FA2' }} />
                </Box>
              </>
            )}

            {fromStaff && loadingAssignments && (
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                <CircularProgress role="progressbar" aria-label="Loading" size={18} />
                <Typography variant="body2" color="text.secondary">Loading assigned patients...</Typography>
              </Box>
            )}

            {fromStaff && !loadingAssignments && staffPatients.length === 0 && (
              <Alert severity="info">This staff member has no active assigned patients to reassign.</Alert>
            )}

            {result && <Alert severity={result.startsWith('Error') ? 'error' : 'success'} sx={{ mt: 2 }}>{result}</Alert>}
          </Box>
        )}

      </DialogContent>
      <Divider />
      <DialogActions sx={{ px: 3, py: 2 }}>
        <Button onClick={onClose} sx={{ color: 'text.secondary' }}>Close</Button>
        {view === 'create' && (
          <Button variant="contained" onClick={handleCreate} disabled={saving || !assignments.length || !effectiveDate}
            sx={{ bgcolor: '#7B1FA2', '&:hover': { bgcolor: '#6A1B9A' } }}>
            {saving ? <CircularProgress role="progressbar" aria-label="Loading" size={16} sx={{ color: '#fff' }} /> : `Create Plan (${assignments.length} patients)`}
          </Button>
        )}
      </DialogActions>
    </Dialog>
  );
}

export default PatientsPage;
