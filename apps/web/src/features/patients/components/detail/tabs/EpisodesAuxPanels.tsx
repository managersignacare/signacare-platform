import EditIcon from '@mui/icons-material/Edit';
import PersonAddIcon from '@mui/icons-material/PersonAdd';
import WhatshotIcon from '@mui/icons-material/Whatshot';
import {
  Box,
  Button,
  Checkbox,
  Chip,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  FormControl,
  Grid,
  IconButton,
  InputLabel,
  MenuItem,
  Paper,
  Select,
  TextField,
  Typography,
} from '@mui/material';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import React, { useState } from 'react';
import { apiClient } from '../../../../../shared/services/apiClient';
import { episodesKeys, patientsKeys } from '../../../queryKeys';

interface Episode {
  id: string;
  title: string;
  team?: string;
}

interface StaffLookupItem {
  id: string;
  givenName: string;
  familyName: string;
  discipline?: string;
}

interface TaskItem {
  id: string;
  title: string;
  status?: string;
  priority?: string;
  assignedToName?: string;
  assignedToId?: string;
  dueAt?: string;
  dueDate?: string;
}

interface TaskUpdatePayload {
  id: string;
  title?: string;
  priority?: string;
  assignedToId?: string;
  dueDate?: string;
  status?: string;
}

type ApiListEnvelope<T> = T[] | { data?: T[] };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function readList<T>(payload: unknown): T[] {
  if (Array.isArray(payload)) return payload as T[];
  if (isRecord(payload) && Array.isArray(payload.data)) return payload.data as T[];
  return [];
}

function extractErrorMessage(error: unknown, fallback = 'Unknown'): string {
  if (!isRecord(error)) return fallback;
  const response = isRecord(error.response) ? error.response : undefined;
  const data = response && isRecord(response.data) ? response.data : undefined;
  const apiError = data && typeof data.error === 'string' ? data.error : undefined;
  const message = typeof error.message === 'string' ? error.message : undefined;
  return apiError ?? message ?? fallback;
}

function useStaffLookup() {
  return useQuery({
    queryKey: patientsKeys.staffLookup(),
    queryFn: () => apiClient.get<StaffLookupItem[]>('staff/lookup'),
    staleTime: 5 * 60 * 1000,
  });
}

interface AdditionalClinician {
  id: string;
  label: string;
  staffId: string;
}

export function AllocationDialog({
  episode,
  patientId,
  flatUnits,
  onClose,
}: {
  episode: Episode;
  patientId: string;
  flatUnits: { id: string; name: string }[];
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const { data: staffList } = useStaffLookup();
  const staffOptions = staffList ?? [];
  const normaliseUnitLabel = (value: string) => value.replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim().toLowerCase();
  const coerceOrgUnitId = (value: string | null | undefined): string => {
    if (!value) return '';
    if (flatUnits.some((unit) => unit.id === value)) return value;
    const byName = flatUnits.find((unit) => normaliseUnitLabel(unit.name) === normaliseUnitLabel(value));
    return byName?.id ?? value;
  };

  const [orgUnitId, setOrgUnitId] = useState(coerceOrgUnitId(episode.team));
  const [primaryClinicianId, setPrimaryClinicianId] = useState('');
  const [consultantId, setConsultantId] = useState('');
  const [juniorMedicalId, setJuniorMedicalId] = useState('');
  const [clinicalSpecialistId, setClinicalSpecialistId] = useState('');
  const [additional, setAdditional] = useState<AdditionalClinician[]>([]);

  const { data: existingAlloc } = useQuery({
    queryKey: episodesKeys.allocation(episode.id),
    queryFn: () =>
      apiClient.get<{
        orgUnitId: string | null;
        primaryClinicianId: string | null;
        keyWorkerId: string | null;
        mdt: { staffId: string; roleName: string }[];
      }>(`episodes/${episode.id}/allocation`),
    enabled: !!episode.id,
  });

  React.useEffect(() => {
    if (existingAlloc) {
      if (existingAlloc.orgUnitId) setOrgUnitId(coerceOrgUnitId(existingAlloc.orgUnitId));
      if (existingAlloc.primaryClinicianId) setPrimaryClinicianId(existingAlloc.primaryClinicianId);
      const extras: AdditionalClinician[] = [];
      for (const m of existingAlloc.mdt ?? []) {
        const rolename = typeof m.roleName === 'string' ? m.roleName : '';
        const staffid = typeof m.staffId === 'string' ? m.staffId : '';
        if (rolename === 'Consultant Psychiatrist') setConsultantId(staffid);
        else if (rolename === 'Psychiatry Registrar') setJuniorMedicalId(staffid);
        else if (rolename === 'Senior Clinician') setClinicalSpecialistId(staffid);
        else extras.push({ id: crypto.randomUUID(), label: rolename, staffId: staffid });
      }
      if (extras.length) setAdditional(extras);
    }
  }, [existingAlloc, flatUnits]);

  React.useEffect(() => {
    setOrgUnitId((current) => coerceOrgUnitId(current));
  }, [flatUnits]);

  const addAdditional = () => setAdditional((prev) => [...prev, { id: crypto.randomUUID(), label: '', staffId: '' }]);
  const removeAdditional = (id: string) => setAdditional((prev) => prev.filter((a) => a.id !== id));
  const updateAdditional = (id: string, field: 'label' | 'staffId', value: string) => {
    setAdditional((prev) => prev.map((a) => (a.id === id ? { ...a, [field]: value } : a)));
  };

  const allocMut = useMutation({
    mutationFn: () =>
      apiClient.post(`episodes/${episode.id}/allocate`, {
        orgUnitId,
        primaryClinicianId: primaryClinicianId || undefined,
        consultantId: consultantId || undefined,
        juniorMedicalId: juniorMedicalId || undefined,
        clinicalSpecialistId: clinicalSpecialistId || undefined,
        additionalMdt: additional
          .map((a) => ({
            role: typeof a.label === 'string' ? a.label.trim() : '',
            staffId: typeof a.staffId === 'string' ? a.staffId.trim() : '',
          }))
          .filter((a) => a.role.length > 0 && a.staffId.length > 0),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: episodesKeys.byPatient(patientId) });
      qc.invalidateQueries({ queryKey: episodesKeys.allocation(episode.id) });
      onClose();
    },
    onError: (err: unknown) => {
      alert(`Failed to save MDT allocation: ${extractErrorMessage(err, 'Unknown error')}`);
    },
  });

  const ROLE_DISCIPLINES: Record<string, string[]> = {
    'Consultant Psychiatrist': ['psychiatrist', 'consultant'],
    'Junior Medical Staff': ['registrar', 'junior medical', 'rmo', 'intern', 'resident'],
    'Clinical Specialist': ['psychologist', 'senior clinician', 'occupational therapist', 'senior social worker'],
    'Key Clinician': ['nurse', 'psychologist', 'social worker', 'occupational therapist', 'clinician'],
  };

  const getFilteredStaff = (roleLabel: string) => {
    const keywords = ROLE_DISCIPLINES[roleLabel];
    if (!keywords) return staffOptions;
    const filtered = staffOptions.filter((s) => {
      const disc = (s.discipline ?? '').toLowerCase();
      return keywords.some((k) => disc.includes(k));
    });
    return filtered.length > 0 ? filtered : staffOptions;
  };

  const StaffSelect = ({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) => {
    const options = getFilteredStaff(label);
    const labelSlug = label.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
    const labelId = `allocation-${labelSlug}-label`;
    const selectId = `allocation-${labelSlug}-select`;
    return (
      <FormControl fullWidth size="small">
        <InputLabel id={labelId}>{label}</InputLabel>
        <Select labelId={labelId} id={selectId} value={value} onChange={(e) => onChange(e.target.value)} label={label} inputProps={{ 'aria-label': label }}>
          <MenuItem value="">— None —</MenuItem>
          {options.map((s) => (
            <MenuItem key={s.id} value={s.id}>
              {s.givenName} {s.familyName}
              {s.discipline ? ` (${s.discipline})` : ''}
            </MenuItem>
          ))}
        </Select>
      </FormControl>
    );
  };

  const hasOrgUnitOption = orgUnitId === '' || flatUnits.some((unit) => unit.id === orgUnitId);

  return (
    <Dialog open onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle id="dialog-title" sx={{ fontFamily: 'Albert Sans, sans-serif', fontWeight: 700 }}>
        Allocate Team & MDT — {episode.title}
      </DialogTitle>
      <Divider />
      <DialogContent>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          Assign this episode to a team and allocate clinicians.
        </Typography>
        <Grid container spacing={2}>
          <Grid size={{ xs: 12 }}>
            <FormControl fullWidth size="small" required>
              <InputLabel id="allocation-team-unit-label">Team / Unit *</InputLabel>
              <Select labelId="allocation-team-unit-label" id="allocation-team-unit-select" value={orgUnitId} onChange={(e) => setOrgUnitId(e.target.value)} label="Team / Unit *" inputProps={{ 'aria-label': 'Team / Unit' }}>
                <MenuItem value="">— Select —</MenuItem>
                {!hasOrgUnitOption && <MenuItem value={orgUnitId}>{orgUnitId}</MenuItem>}
                {flatUnits.map((u) => (
                  <MenuItem key={u.id} value={u.id}>
                    {u.name}
                  </MenuItem>
                ))}
              </Select>
            </FormControl>
          </Grid>
          <Grid size={{ xs: 12 }}>
            <Typography variant="subtitle2" color="text.secondary" sx={{ mt: 1, mb: 0.5 }}>
              MDT Clinicians
            </Typography>
          </Grid>
          <Grid size={{ xs: 12, sm: 6 }}>
            <StaffSelect label="Key Clinician" value={primaryClinicianId} onChange={setPrimaryClinicianId} />
          </Grid>
          <Grid size={{ xs: 12, sm: 6 }}>
            <StaffSelect label="Consultant Psychiatrist" value={consultantId} onChange={setConsultantId} />
          </Grid>
          <Grid size={{ xs: 12, sm: 6 }}>
            <StaffSelect label="Junior Medical Staff" value={juniorMedicalId} onChange={setJuniorMedicalId} />
          </Grid>
          <Grid size={{ xs: 12, sm: 6 }}>
            <StaffSelect label="Clinical Specialist" value={clinicalSpecialistId} onChange={setClinicalSpecialistId} />
          </Grid>

          {additional.map((a) => (
            <React.Fragment key={a.id}>
              <Grid size={{ xs: 12, sm: 5 }}>
                <TextField label="Role" fullWidth size="small" value={a.label} onChange={(e) => updateAdditional(a.id, 'label', e.target.value)} placeholder="e.g. OT, Social Worker" />
              </Grid>
              <Grid size={{ xs: 10, sm: 5 }}>
                <StaffSelect label="Clinician" value={a.staffId} onChange={(v) => updateAdditional(a.id, 'staffId', v)} />
              </Grid>
              <Grid size={{ xs: 2 }} sx={{ display: 'flex', alignItems: 'center' }}>
                <IconButton size="small" color="error" aria-label="Remove team member" onClick={() => removeAdditional(a.id)}>
                  <EditIcon fontSize="small" />
                </IconButton>
              </Grid>
            </React.Fragment>
          ))}
          <Grid size={{ xs: 12 }}>
            <Button size="small" startIcon={<PersonAddIcon />} onClick={addAdditional} sx={{ color: '#b8621a', fontSize: 12 }}>
              Add Additional Clinician
            </Button>
          </Grid>
        </Grid>
      </DialogContent>
      <Divider />
      <DialogActions sx={{ px: 3, py: 2 }}>
        <Button onClick={onClose} sx={{ color: 'text.secondary' }}>
          Cancel
        </Button>
        <Button variant="contained" onClick={() => allocMut.mutate()} disabled={allocMut.isPending || !orgUnitId} sx={{ bgcolor: '#b8621a', '&:hover': { bgcolor: '#d6741f' } }}>
          {allocMut.isPending ? <CircularProgress role="progressbar" aria-label="Loading" size={18} sx={{ color: '#fff' }} /> : 'Save Allocation'}
        </Button>
      </DialogActions>
    </Dialog>
  );
}

export function HotSpotButton({ patientId }: { patientId: string }) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  const qc = useQueryClient();

  const addMut = useMutation({
    mutationFn: () => apiClient.post(`patients/${patientId}/hotspot`, { reason: reason.trim() }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: patientsKeys.hotspotsInvalidate() });
      setOpen(false);
      setReason('');
    },
  });

  return (
    <>
      <Button size="small" variant="outlined" startIcon={<WhatshotIcon />} onClick={() => setOpen(true)} sx={{ borderColor: '#D32F2F', color: '#D32F2F', textTransform: 'none', fontSize: 12 }}>
        Add to Hot Spots
      </Button>
      <Dialog aria-labelledby="dialog-title" open={open} onClose={() => setOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle id="dialog-title" sx={{ fontFamily: 'Albert Sans, sans-serif', fontWeight: 700 }}>
          Add to Hot Spots
        </DialogTitle>
        <Divider />
        <DialogContent>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            Adding this patient to hot spots indicates early warning signs or concerns requiring heightened monitoring.
          </Typography>
          <TextField autoFocus label="Reason for Hot Spot *" fullWidth multiline rows={3} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Describe the concerns or early warning signs..." />
        </DialogContent>
        <DialogActions sx={{ px: 3, py: 2 }}>
          <Button onClick={() => setOpen(false)} sx={{ color: 'text.secondary' }}>
            Cancel
          </Button>
          <Button variant="contained" onClick={() => addMut.mutate()} disabled={!reason.trim() || addMut.isPending} sx={{ bgcolor: '#D32F2F', '&:hover': { bgcolor: '#B71C1C' } }}>
            {addMut.isPending ? <CircularProgress role="progressbar" aria-label="Loading" size={16} sx={{ color: '#fff' }} /> : 'Add to Hot Spots'}
          </Button>
        </DialogActions>
      </Dialog>
    </>
  );
}

export function DischargeSummaryDialog({
  open,
  onClose,
  episodeId,
  patientId,
}: {
  open: boolean;
  onClose: () => void;
  episodeId: string;
  patientId: string;
}) {
  const qc = useQueryClient();
  const [content, setContent] = useState('');
  const [loading, setLoading] = useState(false);
  const [consultantId, setConsultantId] = useState('');
  const [step, setStep] = useState<'generate' | 'edit' | 'submit'>('generate');
  const { data: staffList } = useQuery({
    queryKey: patientsKeys.staffLookupShort(),
    queryFn: () =>
      apiClient.get<StaffLookupItem[]>('staff/lookup').catch((err) => {
        console.warn('EpisodesTab: query failed', err);
        return [];
      }),
  });

  return (
    <Dialog aria-labelledby="dialog-title" open={open} onClose={onClose} maxWidth="md" fullWidth>
      <DialogTitle id="dialog-title" sx={{ fontWeight: 700 }}>
        Discharge Summary
      </DialogTitle>
      <Divider />
      <DialogContent>
        {step === 'generate' && (
          <Box sx={{ textAlign: 'center', py: 4 }}>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
              Generate a discharge summary from clinical data using AI, then edit and submit for consultant signature.
            </Typography>
            <Button
              variant="contained"
              disabled={loading}
              onClick={async () => {
                setLoading(true);
                try {
                  const r = await apiClient.post<{ content: string }>(`episodes/${episodeId}/discharge-summary/generate`, {});
                  setContent(r.content ?? '');
                  setStep('edit');
                } catch {
                  setContent('[AI unavailable — write manually]');
                  setStep('edit');
                }
                setLoading(false);
              }}
              sx={{ bgcolor: '#327C8D' }}
            >
              {loading ? 'Generating...' : 'Generate with AI'}
            </Button>
          </Box>
        )}
        {step === 'edit' && <TextField fullWidth multiline rows={18} value={content} onChange={(e) => setContent(e.target.value)} sx={{ mt: 1, '& .MuiInputBase-input': { fontFamily: 'monospace', fontSize: 12 } }} />}
        {step === 'submit' && (
          <Box sx={{ py: 2 }}>
            <Typography variant="body2" sx={{ mb: 2 }}>
              Select the consultant psychiatrist to vet and sign this discharge summary:
            </Typography>
            <FormControl fullWidth size="small">
              <InputLabel>Consultant Psychiatrist</InputLabel>
              <Select value={consultantId} onChange={(e) => setConsultantId(e.target.value)} label="Consultant Psychiatrist">
                {(Array.isArray(staffList) ? staffList : []).map((s) => (
                  <MenuItem key={s.id} value={s.id}>
                    {s.givenName} {s.familyName}
                  </MenuItem>
                ))}
              </Select>
            </FormControl>
          </Box>
        )}
      </DialogContent>
      <Divider />
      <DialogActions sx={{ px: 3, py: 2 }}>
        <Button onClick={onClose} sx={{ color: 'text.secondary' }}>
          Cancel
        </Button>
        {step === 'edit' && (
          <Button variant="contained" onClick={() => setStep('submit')} sx={{ bgcolor: '#b8621a' }}>
            Next: Select Consultant
          </Button>
        )}
        {step === 'submit' && (
          <Button
            variant="contained"
            disabled={!consultantId}
            onClick={async () => {
              await apiClient.post(`episodes/${episodeId}/discharge-summary/submit`, { content, consultantId });
              qc.invalidateQueries({ queryKey: episodesKeys.byPatient(patientId) });
              onClose();
            }}
            sx={{ bgcolor: '#327C8D' }}
          >
            Submit for Vetting
          </Button>
        )}
      </DialogActions>
    </Dialog>
  );
}

export function CloseEpisodeDialog({
  open,
  onClose,
  episodeId,
  patientId,
}: {
  open: boolean;
  onClose: () => void;
  episodeId: string;
  patientId: string;
}) {
  const qc = useQueryClient();
  const [reason, setReason] = useState('');
  const [consultantId, setConsultantId] = useState('');
  const { data: staffList } = useQuery({
    queryKey: patientsKeys.staffLookupShort(),
    queryFn: () =>
      apiClient.get<StaffLookupItem[]>('staff/lookup').catch((err) => {
        console.warn('EpisodesTab: query failed', err);
        return [];
      }),
  });

  return (
    <Dialog aria-labelledby="dialog-title" open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle id="dialog-title" sx={{ fontWeight: 700, color: '#D32F2F' }}>
        Close Episode
      </DialogTitle>
      <Divider />
      <DialogContent>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2, mt: 1 }}>
          Closing an episode requires approval from the MDT consultant psychiatrist. The episode will be placed on hold until signed.
        </Typography>
        <TextField label="Closure Reason" fullWidth multiline rows={3} value={reason} onChange={(e) => setReason(e.target.value)} sx={{ mb: 2 }} />
        <FormControl fullWidth size="small">
          <InputLabel>Consultant Psychiatrist</InputLabel>
          <Select value={consultantId} onChange={(e) => setConsultantId(e.target.value)} label="Consultant Psychiatrist">
            {(Array.isArray(staffList) ? staffList : []).map((s) => (
              <MenuItem key={s.id} value={s.id}>
                {s.givenName} {s.familyName}
              </MenuItem>
            ))}
          </Select>
        </FormControl>
      </DialogContent>
      <Divider />
      <DialogActions sx={{ px: 3, py: 2 }}>
        <Button onClick={onClose} sx={{ color: 'text.secondary' }}>
          Cancel
        </Button>
        <Button
          variant="contained"
          color="error"
          disabled={!consultantId || !reason.trim()}
          onClick={async () => {
            await apiClient.post(`episodes/${episodeId}/close-with-vetting`, { closureReason: reason, consultantId });
            qc.invalidateQueries({ queryKey: episodesKeys.byPatient(patientId) });
            onClose();
          }}
        >
          Submit for Approval
        </Button>
      </DialogActions>
    </Dialog>
  );
}

export function IntakeTaskList({ patientId, episodeId }: { patientId: string; episodeId: string }) {
  const qc = useQueryClient();
  const [newTask, setNewTask] = React.useState('');
  const [newPriority, setNewPriority] = React.useState('medium');
  const [newAssign, setNewAssign] = React.useState('');
  const [newDue, setNewDue] = React.useState('');
  const [editId, setEditId] = React.useState<string | null>(null);
  const [editTitle, setEditTitle] = React.useState('');
  const [editPriority, setEditPriority] = React.useState('medium');
  const [editAssign, setEditAssign] = React.useState('');
  const [editDue, setEditDue] = React.useState('');

  const { data: tasks } = useQuery({
    queryKey: patientsKeys.tasksByEpisode(patientId, episodeId),
    queryFn: () =>
      apiClient
        .get<ApiListEnvelope<TaskItem>>('tasks', { patientId, episodeId })
        .then((r) => readList<TaskItem>(r)),
    enabled: !!episodeId,
  });

  const { data: staffList } = useQuery({
    queryKey: patientsKeys.staffLookup(),
    queryFn: () => apiClient.get<StaffLookupItem[]>('staff/lookup'),
    staleTime: 5 * 60 * 1000,
  });

  const createMut = useMutation({
    mutationFn: () =>
      apiClient.post('tasks', {
        patientId,
        episodeId,
        title: newTask.trim(),
        priority: newPriority,
        assignedToId: newAssign || undefined,
        dueDate: newDue || undefined,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: patientsKeys.tasksByEpisode(patientId, episodeId) });
      setNewTask('');
      setNewPriority('medium');
      setNewAssign('');
      setNewDue('');
    },
  });

  const updateMut = useMutation({
    mutationFn: (data: TaskUpdatePayload) => apiClient.patch(`tasks/${data.id}`, data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: patientsKeys.tasksByEpisode(patientId, episodeId) });
      setEditId(null);
    },
  });

  const completeMut = useMutation({
    mutationFn: (id: string) => apiClient.patch(`tasks/${id}`, { status: 'completed' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: patientsKeys.tasksByEpisode(patientId, episodeId) }),
  });

  const openTasks = (tasks ?? []).filter((t) => t.status !== 'completed');
  const doneTasks = (tasks ?? []).filter((t) => t.status === 'completed');
  const PRIORITIES = [
    { v: 'low', c: '#327C8D' },
    { v: 'medium', c: '#b8621a' },
    { v: 'high', c: '#D32F2F' },
    { v: 'urgent', c: '#B71C1C' },
  ];

  return (
    <Paper variant="outlined" sx={{ p: 2 }}>
      <Typography variant="subtitle2" fontWeight={600} sx={{ mb: 1 }}>
        Tasks ({openTasks.length} open)
      </Typography>
      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.75 }}>
        {openTasks.map((t) => {
          const dueValue = t.dueAt ?? t.dueDate;
          return (
            <Box key={t.id} sx={{ display: 'flex', alignItems: 'center', gap: 0.75, py: 0.3, borderBottom: '1px solid #f5f5f5' }}>
              <Checkbox size="small" checked={false} onChange={() => completeMut.mutate(t.id)} sx={{ p: 0, color: '#b8621a', '&.Mui-checked': { color: '#b8621a' } }} />
              {editId === t.id ? (
                <Box sx={{ flex: 1, display: 'flex', gap: 0.5, flexWrap: 'wrap' }}>
                  <TextField size="small" value={editTitle} onChange={(e) => setEditTitle(e.target.value)} sx={{ flex: 1, '& .MuiInputBase-input': { fontSize: 11 } }} />
                  <Select size="small" value={editPriority} onChange={(e) => setEditPriority(e.target.value)} sx={{ minWidth: 80, fontSize: 10 }}>
                    {PRIORITIES.map((p) => (
                      <MenuItem key={p.v} value={p.v} sx={{ fontSize: 11 }}>
                        {p.v}
                      </MenuItem>
                    ))}
                  </Select>
                  <Select size="small" value={editAssign} onChange={(e) => setEditAssign(e.target.value)} displayEmpty sx={{ minWidth: 100, fontSize: 10 }}>
                    <MenuItem value="" sx={{ fontSize: 11 }}>
                      Unassigned
                    </MenuItem>
                    {(staffList ?? []).map((s) => (
                      <MenuItem key={s.id} value={s.id} sx={{ fontSize: 11 }}>
                        {s.givenName} {s.familyName}
                      </MenuItem>
                    ))}
                  </Select>
                  <TextField size="small" type="date" value={editDue} onChange={(e) => setEditDue(e.target.value)} sx={{ width: 130, '& .MuiInputBase-input': { fontSize: 10 } }} slotProps={{ inputLabel: { shrink: true } }} />
                  <Button
                    size="small"
                    onClick={() =>
                      updateMut.mutate({
                        id: t.id,
                        title: editTitle,
                        priority: editPriority,
                        assignedToId: editAssign || undefined,
                        dueDate: editDue || undefined,
                      })
                    }
                    sx={{ fontSize: 10, minWidth: 0, color: '#2E7D32' }}
                  >
                    ✓
                  </Button>
                  <Button size="small" onClick={() => setEditId(null)} sx={{ fontSize: 10, minWidth: 0, color: '#999' }}>
                    ✕
                  </Button>
                </Box>
              ) : (
                <>
                  <Box sx={{ flex: 1 }}>
                    <Typography variant="body2" sx={{ fontSize: 12 }}>
                      {t.title}
                    </Typography>
                    <Box sx={{ display: 'flex', gap: 0.5, mt: 0.25 }}>
                      <Chip label={t.priority ?? 'medium'} size="small" sx={{ fontSize: 8, height: 16, bgcolor: PRIORITIES.find((p) => p.v === t.priority)?.c ?? '#b8621a', color: '#fff' }} />
                      {t.assignedToName && <Chip label={t.assignedToName} size="small" variant="outlined" sx={{ fontSize: 8, height: 16 }} />}
                      {dueValue && (
                        <Typography variant="caption" sx={{ fontSize: 9, color: new Date(dueValue) < new Date() ? '#D32F2F' : '#999' }}>
                          Due: {new Date(dueValue).toLocaleDateString('en-AU', { day: 'numeric', month: 'short' })}
                        </Typography>
                      )}
                    </Box>
                  </Box>
                  <Button
                    size="small"
                    onClick={() => {
                      setEditId(t.id);
                      setEditTitle(t.title);
                      setEditPriority(t.priority ?? 'medium');
                      setEditAssign(t.assignedToId ?? '');
                      setEditDue(t.dueAt ?? t.dueDate ?? '');
                    }}
                    sx={{ fontSize: 10, minWidth: 0, color: '#999' }}
                  >
                    ✏️
                  </Button>
                </>
              )}
            </Box>
          );
        })}
        {doneTasks.length > 0 && (
          <Typography variant="caption" color="text.secondary" sx={{ mt: 0.5, fontSize: 10 }}>
            {doneTasks.length} completed
          </Typography>
        )}
        <Box sx={{ display: 'flex', gap: 0.5, mt: 1, flexWrap: 'wrap' }}>
          <TextField
            size="small"
            placeholder="New task..."
            value={newTask}
            onChange={(e) => setNewTask(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && newTask.trim() && createMut.mutate()}
            sx={{ flex: 1, minWidth: 120, '& .MuiInputBase-input': { fontSize: 11 } }}
          />
          <Select size="small" value={newPriority} onChange={(e) => setNewPriority(e.target.value)} sx={{ minWidth: 80, fontSize: 10 }}>
            {PRIORITIES.map((p) => (
              <MenuItem key={p.v} value={p.v} sx={{ fontSize: 11 }}>
                {p.v}
              </MenuItem>
            ))}
          </Select>
          <Select size="small" value={newAssign} onChange={(e) => setNewAssign(e.target.value)} displayEmpty sx={{ minWidth: 100, fontSize: 10 }}>
            <MenuItem value="" sx={{ fontSize: 11 }}>
              Assign to...
            </MenuItem>
            {(staffList ?? []).map((s) => (
              <MenuItem key={s.id} value={s.id} sx={{ fontSize: 11 }}>
                {s.givenName} {s.familyName}
              </MenuItem>
            ))}
          </Select>
          <TextField size="small" type="date" value={newDue} onChange={(e) => setNewDue(e.target.value)} sx={{ width: 130, '& .MuiInputBase-input': { fontSize: 10 } }} slotProps={{ inputLabel: { shrink: true } }} />
          <Button size="small" variant="outlined" onClick={() => newTask.trim() && createMut.mutate()} disabled={!newTask.trim()} sx={{ fontSize: 10, textTransform: 'none', borderColor: '#b8621a', color: '#b8621a' }}>
            Add
          </Button>
        </Box>
      </Box>
    </Paper>
  );
}
