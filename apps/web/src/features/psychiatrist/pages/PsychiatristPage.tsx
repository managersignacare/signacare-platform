import React, { useState, useRef, useCallback } from 'react';
import {
  Alert, Box, Button, Checkbox, Chip, CircularProgress, Dialog, DialogActions,
  DialogContent, DialogTitle, Divider, FormControl, FormControlLabel,
  Grid, InputLabel, MenuItem,
  Paper, Select, Tab, Tabs, TextField, Typography,
} from '@mui/material';
import LocalHospitalIcon from '@mui/icons-material/LocalHospital';
import MicIcon from '@mui/icons-material/Mic';
import StopIcon from '@mui/icons-material/Stop';
import AutoAwesomeIcon from '@mui/icons-material/AutoAwesome';
import SaveIcon from '@mui/icons-material/Save';
import MedicationIcon from '@mui/icons-material/Medication';
import PsychologyIcon from '@mui/icons-material/Psychology';
import WarningAmberIcon from '@mui/icons-material/WarningAmber';
import AddIcon from '@mui/icons-material/Add';
import { useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { tryAsync, isErr, type SideEffectScheduleResponse } from '@signacare/shared';
import { apiClient } from '../../../shared/services/apiClient';
import { psychiatristKeys } from '../queryKeys';

const fmtTime = (iso: string) => {
  try { return new Date(iso).toLocaleTimeString('en-AU', { hour: '2-digit', minute: '2-digit' }); } catch { return iso; }
};
const fmtDate = (iso: string) => {
  try { return new Date(iso).toLocaleDateString('en-AU', { day: '2-digit', month: 'short', year: 'numeric' }); } catch { return iso; }
};
const today = () => new Date().toISOString().slice(0, 10);

type UnknownRecord = Record<string, unknown>;

type PsychiatristPatientRow = {
  id: string;
  displayName?: string | null;
  givenName?: string | null;
  familyName?: string | null;
};

type PatientListEnvelope = {
  patients?: PsychiatristPatientRow[];
  data?: PsychiatristPatientRow[];
};

type CurrentMedicationRow = string | { name?: string | null; medicationName?: string | null };

type AppointmentNoteRow = string | { content?: string | null; text?: string | null };

type ClinicAppointmentRow = {
  id?: string;
  patientId?: string;
  patientDisplayName?: string | null;
  patientName?: string | null;
  appointmentType?: string | null;
  type?: string | null;
  startTime?: string | null;
  time?: string | null;
  status?: string | null;
  diagnosis?: string | null;
  currentMedications?: CurrentMedicationRow[] | null;
  lastNote?: AppointmentNoteRow | null;
};

type ClinicTodayEnvelope = {
  appointments?: ClinicAppointmentRow[];
  data?: ClinicAppointmentRow[];
};

type FivePKey = 'presenting' | 'predisposing' | 'precipitating' | 'perpetuating' | 'protective';
type ConfidentialityLevel = 'standard' | 'confidential' | 'restricted';

type FivePFormState = Record<FivePKey, string>;

type ClinicalFormulationRow = {
  id?: string;
  type?: string | null;
  shared_with_clinicians?: boolean | null;
  sharedWithClinicians?: boolean | null;
  createdAt?: string | null;
} & Partial<Record<FivePKey, string>>;

type ClinicalFormulationsEnvelope = {
  formulations?: ClinicalFormulationRow[];
  data?: ClinicalFormulationRow[];
};

type LlmFivePResponse = Partial<Record<FivePKey, string>>;

const asRecord = (value: unknown): UnknownRecord | null => (
  value != null && typeof value === 'object' ? (value as UnknownRecord) : null
);

const readEnvelopeArray = <T,>(value: unknown, key: string): T[] => {
  if (Array.isArray(value)) return value as T[];
  const record = asRecord(value);
  if (!record) return [];
  const keyed = record[key];
  if (Array.isArray(keyed)) return keyed as T[];
  const data = record.data;
  return Array.isArray(data) ? (data as T[]) : [];
};

export default function PsychiatristPage(): React.ReactElement {
  const [tab, setTab] = useState(0);

  return (
    <Box sx={{ p: { xs: 2, md: 3 }, bgcolor: '#FBF8F5', minHeight: '100vh' }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, mb: 3 }}>
        <LocalHospitalIcon sx={{ color: '#327C8D', fontSize: 28 }} />
        <Box>
          <Typography variant="h5" fontWeight={700} fontFamily="Albert Sans, sans-serif" color="#3D484B">My Clinic</Typography>
          <Typography variant="body2" color="text.secondary">Psychiatrist clinic view, formulations, side effects, and voice memos</Typography>
        </Box>
      </Box>

      <Tabs aria-label="Navigation tabs" value={tab} onChange={(_, v) => setTab(v)} sx={{ mb: 3, '& .MuiTab-root': { textTransform: 'none', fontWeight: 600 } }}>
        <Tab label="My Clinic Today" />
        <Tab label="Formulations" />
        <Tab label="Side Effects" />
        <Tab label="Voice Memo" />
      </Tabs>

      {tab === 0 && <ClinicTodayTab />}
      {tab === 1 && <FormulationsTab />}
      {tab === 2 && <SideEffectsTab />}
      {tab === 3 && <VoiceMemoTab />}
    </Box>
  );
}

/* ─── My Clinic Today ─── */
function ClinicTodayTab() {
  const navigate = useNavigate();
  const { data: appointments = [], isLoading, error } = useQuery({
    queryKey: psychiatristKeys.clinicToday(today()),
    queryFn: async (): Promise<ClinicAppointmentRow[]> => {
      try {
        const response = await apiClient.get<ClinicTodayEnvelope | ClinicAppointmentRow[]>('dashboard/my-clinic-today');
        return readEnvelopeArray<ClinicAppointmentRow>(response, 'appointments');
      } catch (err) {
        console.warn('PsychiatristPage: query failed', err);
        return [];
      }
    },
  });

  if (isLoading) return <CircularProgress role="progressbar" aria-label="Loading" sx={{ display: 'block', mx: 'auto', mt: 4 }} />;
  if (error) return <Alert role="alert" severity="error" sx={{ mt: 2 }}>Failed to load clinic schedule</Alert>;

  return (
    <Box>
      {appointments.length === 0 && (
        <Typography color="text.secondary" sx={{ py: 4, textAlign: 'center' }}>No appointments today</Typography>
      )}
      {appointments.map((appt, i: number) => (
        <Paper key={appt.id ?? i} variant="outlined"
          {...(appt.patientId ? {
            role: 'button' as const,
            tabIndex: 0,
            'aria-label': `Open patient ${appt.patientName ?? 'patient'} for ${appt.appointmentType ?? appt.type ?? 'appointment'}`,
            onClick: () => navigate(`/patients/${appt.patientId}`),
            onKeyDown: (e: React.KeyboardEvent) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); navigate(`/patients/${appt.patientId}`); } },
          } : {})}
          sx={{
            p: 2, mb: 1.5, cursor: appt.patientId ? 'pointer' : 'default', '&:hover': appt.patientId ? { boxShadow: 2 } : {}, transition: 'box-shadow 0.2s',
            '&:focus-visible': appt.patientId ? { outline: '2px solid #327C8D', outlineOffset: 2 } : {},
          }}>
          <Box sx={{ display: 'flex', gap: 2, alignItems: 'flex-start' }}>
            <Box sx={{ minWidth: 60, textAlign: 'center' }}>
              <Typography variant="h6" fontWeight={700} color="#327C8D" fontFamily="Albert Sans, sans-serif">
                {fmtTime(appt.startTime ?? appt.time ?? '')}
              </Typography>
              <Chip label={appt.status ?? 'scheduled'} size="small" sx={{
                bgcolor: appt.status === 'completed' ? '#E8F5E9' : appt.status === 'checked-in' ? '#E8F5F7' : '#F5F5F5',
                color: appt.status === 'completed' ? '#2E7D32' : appt.status === 'checked-in' ? '#327C8D' : '#555',
                fontSize: 9, fontWeight: 600, textTransform: 'capitalize',
              }} />
            </Box>
            <Divider orientation="vertical" flexItem />
            <Box sx={{ flex: 1 }}>
              <Typography variant="body1" fontWeight={700} color="#3D484B" fontFamily="Albert Sans, sans-serif">
                {appt.patientDisplayName ?? appt.patientName ?? 'Patient'}
              </Typography>
              <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap', mt: 0.5 }}>
                {appt.diagnosis && <Chip icon={<PsychologyIcon sx={{ fontSize: 14 }} />} label={appt.diagnosis} size="small" sx={{ fontSize: 10, height: 22, bgcolor: '#F3E8FF', color: '#7B1FA2' }} />}
                {appt.type && <Chip label={appt.type} size="small" sx={{ fontSize: 10, height: 22, bgcolor: '#E8F5F7', color: '#327C8D' }} />}
              </Box>
              {/* Current medications */}
              {appt.currentMedications && appt.currentMedications.length > 0 && (
                <Box sx={{ display: 'flex', gap: 0.5, flexWrap: 'wrap', mt: 0.5 }}>
                  <MedicationIcon sx={{ fontSize: 14, color: '#999', mt: 0.3 }} />
                  {appt.currentMedications.slice(0, 3).map((m, j: number) => (
                    <Chip key={j} label={typeof m === 'string' ? m : (m.name ?? m.medicationName ?? 'Medication')} size="small" variant="outlined" sx={{ fontSize: 9, height: 20 }} />
                  ))}
                  {appt.currentMedications.length > 3 && <Typography variant="caption" color="text.secondary">+{appt.currentMedications.length - 3} more</Typography>}
                </Box>
              )}
              {/* Last note preview */}
              {appt.lastNote && (
                <Typography variant="caption" color="text.secondary" sx={{ mt: 0.5, display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 500 }}>
                  {typeof appt.lastNote === 'string' ? appt.lastNote.split('\n').slice(0, 2).join(' ') : (appt.lastNote.content ?? appt.lastNote.text ?? '').split('\n').slice(0, 2).join(' ')}
                </Typography>
              )}
            </Box>
          </Box>
        </Paper>
      ))}
    </Box>
  );
}

/* ─── Formulations ─── */
function FormulationsTab() {
  const qc = useQueryClient();
  const [patientId, setPatientId] = useState('');
  const [formOpen, setFormOpen] = useState(false);
  const [fiveP, setFiveP] = useState<FivePFormState>({ presenting: '', predisposing: '', precipitating: '', perpetuating: '', protective: '' });
  const [sharedWithClinicians, setSharedWithClinicians] = useState(false);
  // Tier 6.1 (MED-H1) — per-formulation 3-tier confidentiality. 'standard'
  // is legacy behaviour (author + shared visibility). 'confidential'
  // narrows to author + admin. 'restricted' narrows to author only.
  const [confidentialityLevel, setConfidentialityLevel] = useState<ConfidentialityLevel>('standard');
  const [aiLoading, setAiLoading] = useState(false);

  const { data: patientList = [] } = useQuery({
    queryKey: psychiatristKeys.patients(),
    queryFn: async (): Promise<PsychiatristPatientRow[]> => {
      try {
        const response = await apiClient.get<PatientListEnvelope | PsychiatristPatientRow[]>('patients', { limit: 200, mine: true });
        return readEnvelopeArray<PsychiatristPatientRow>(response, 'patients');
      } catch (err) {
        console.warn('PsychiatristPage: query failed', err);
        return [];
      }
    },
  });
  const { data: formulations = [], isLoading, error: formError } = useQuery({
    queryKey: psychiatristKeys.formulations(patientId),
    queryFn: async (): Promise<ClinicalFormulationRow[]> => {
      const response = await apiClient.get<ClinicalFormulationsEnvelope | ClinicalFormulationRow[]>('clinical-formulations', { patientId });
      return readEnvelopeArray<ClinicalFormulationRow>(response, 'formulations');
    },
    enabled: !!patientId,
    retry: false,
  });
  const formErrorCode = (formError as { code?: string } | null)?.code;
  const specialtyRequired = formErrorCode === 'SPECIALTY_REQUIRED';

  const saveMut = useMutation({
    mutationFn: (d: FivePFormState & { sharedWithClinicians: boolean; confidentialityLevel: ConfidentialityLevel }) =>
      apiClient.post('clinical-formulations', { patientId, ...d }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: psychiatristKeys.formulations(patientId) });
      setFormOpen(false);
      setFiveP({ presenting: '', predisposing: '', precipitating: '', perpetuating: '', protective: '' });
      setSharedWithClinicians(false);
      setConfidentialityLevel('standard');
    },
  });

  const handleAiAssist = async () => {
    if (!patientId) return;
    setAiLoading(true);
    try {
      const resp = await apiClient.post<LlmFivePResponse>('llm/generate', { prompt: `Generate a 5P formulation for patient ${patientId}`, type: '5p-formulation' });
      if (resp.presenting) setFiveP((p) => ({ ...p, presenting: resp.presenting ?? '' }));
      if (resp.predisposing) setFiveP((p) => ({ ...p, predisposing: resp.predisposing ?? '' }));
      if (resp.precipitating) setFiveP((p) => ({ ...p, precipitating: resp.precipitating ?? '' }));
      if (resp.perpetuating) setFiveP((p) => ({ ...p, perpetuating: resp.perpetuating ?? '' }));
      if (resp.protective) setFiveP((p) => ({ ...p, protective: resp.protective ?? '' }));
    } catch (_assistErr) {
      // intentional silent — AI assist is optional and should not block manual entry.
      void _assistErr;
    }
    setAiLoading(false);
  };

  const P_LABELS: Array<{ key: FivePKey; label: string; color: string }> = [
    { key: 'presenting', label: 'Presenting', color: '#327C8D' },
    { key: 'predisposing', label: 'Predisposing', color: '#7B1FA2' },
    { key: 'precipitating', label: 'Precipitating', color: '#b8621a' },
    { key: 'perpetuating', label: 'Perpetuating', color: '#D32F2F' },
    { key: 'protective', label: 'Protective', color: '#2E7D32' },
  ];

  return (
    <Box>
      <Box sx={{ display: 'flex', gap: 2, mb: 3, alignItems: 'center' }}>
        <FormControl size="small" sx={{ minWidth: 280 }}>
          <InputLabel>Select Patient</InputLabel>
          <Select label="Select Patient" value={patientId} onChange={(e) => setPatientId(e.target.value)}>
            {patientList.map((p) => (
              <MenuItem key={p.id} value={p.id}>{p.displayName ?? `${p.givenName ?? ''} ${p.familyName ?? ''}`.trim()}</MenuItem>
            ))}
          </Select>
        </FormControl>
        {patientId && (
          <Button startIcon={<AddIcon />} variant="contained" size="small" onClick={() => setFormOpen(true)}
            sx={{ bgcolor: '#327C8D', textTransform: 'none', '&:hover': { bgcolor: '#286A78' } }}>
            New 5P Formulation
          </Button>
        )}
      </Box>

      {!patientId && <Typography color="text.secondary" sx={{ py: 4, textAlign: 'center' }}>Select a patient to view formulations</Typography>}
      {isLoading && <CircularProgress role="progressbar" aria-label="Loading" sx={{ display: 'block', mx: 'auto', mt: 4 }} />}

      {specialtyRequired && (
        <Alert role="alert" severity="warning" sx={{ my: 2 }}>
          Clinical formulations are restricted to clinicians with a psychiatry specialty enrollment. Contact your clinic administrator if your specialty record is incorrect.
        </Alert>
      )}

      {formulations.map((f, i: number) => (
        <Paper key={f.id ?? i} variant="outlined" sx={{ p: 2.5, mb: 2 }}>
          <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 1.5 }}>
            <Box sx={{ display: 'flex', gap: 1, alignItems: 'center' }}>
              <Typography variant="subtitle1" fontWeight={700} color="#3D484B" fontFamily="Albert Sans, sans-serif">
                {f.type === '5p' ? '5P Formulation' : f.type ?? 'Formulation'}
              </Typography>
              {f.shared_with_clinicians || f.sharedWithClinicians
                ? <Chip size="small" label="Shared with team" color="info" sx={{ fontSize: 10, height: 20 }} />
                : <Chip size="small" label="Private" color="default" sx={{ fontSize: 10, height: 20 }} />
              }
            </Box>
            <Typography variant="caption" color="text.secondary">{f.createdAt ? fmtDate(f.createdAt) : ''}</Typography>
          </Box>
          <Grid container spacing={1.5}>
            {P_LABELS.map((p) => {
              const val = f[p.key] ?? '';
              if (!val) return null;
              return (
                <Grid size={{ xs: 12, sm: 6 }} key={p.key}>
                  <Box sx={{ borderLeft: `3px solid ${p.color}`, pl: 1.5, py: 0.5 }}>
                    <Typography variant="caption" fontWeight={700} color={p.color}>{p.label}</Typography>
                    <Typography variant="body2" color="#3D484B" sx={{ fontSize: 12 }}>{val}</Typography>
                  </Box>
                </Grid>
              );
            })}
          </Grid>
        </Paper>
      ))}

      {/* 5P Dialog */}
      <Dialog aria-labelledby="dialog-title" open={formOpen} onClose={() => setFormOpen(false)} maxWidth="md" fullWidth>
        <DialogTitle id="dialog-title" sx={{ fontFamily: 'Albert Sans, sans-serif', fontWeight: 700, color: '#3D484B', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          5P Formulation
          <Button startIcon={aiLoading ? <CircularProgress role="progressbar" aria-label="Loading" size={16} /> : <AutoAwesomeIcon />} size="small"
            disabled={aiLoading} onClick={handleAiAssist}
            sx={{ textTransform: 'none', color: '#b8621a', borderColor: '#b8621a' }} variant="outlined">
            AI Assist
          </Button>
        </DialogTitle>
        <DialogContent sx={{ display: 'flex', flexDirection: 'column', gap: 2, pt: '12px !important' }}>
          {P_LABELS.map(p => (
            <TextField key={p.key} label={p.label} size="small" fullWidth multiline rows={2}
              value={fiveP[p.key as keyof typeof fiveP]}
              onChange={(e) => setFiveP(prev => ({ ...prev, [p.key]: e.target.value }))}
              sx={{ '& .MuiOutlinedInput-root': { '&.Mui-focused fieldset': { borderColor: p.color } } }} />
          ))}
          <FormControlLabel
            control={<Checkbox checked={sharedWithClinicians} onChange={(e) => setSharedWithClinicians(e.target.checked)} />}
            label={
              <Box>
                <Typography variant="body2">Share with the wider clinical team</Typography>
                <Typography variant="caption" color="text.secondary">
                  Default: only you can read this formulation. Enable to let other psychiatrists on the team view it.
                </Typography>
              </Box>
            }
          />
          {/* Tier 6.1 — confidentiality level. Narrows visibility beyond the
               "shared with team" toggle: confidential excludes non-admin
               psychiatrists even when the share toggle is on; restricted
               hides the formulation from everyone except the author. */}
          <Box>
            <Typography variant="body2" sx={{ mb: 0.5 }}>Confidentiality</Typography>
            <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
              {(['standard', 'confidential', 'restricted'] as const).map(level => (
                <Chip key={level} label={level} size="small"
                  onClick={() => setConfidentialityLevel(level)}
                  color={confidentialityLevel === level ? 'primary' : 'default'}
                  variant={confidentialityLevel === level ? 'filled' : 'outlined'}
                  sx={{ cursor: 'pointer', textTransform: 'capitalize' }} />
              ))}
            </Box>
            <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.5 }}>
              {confidentialityLevel === 'standard' && 'Default. Author + team (when the share toggle above is on).'}
              {confidentialityLevel === 'confidential' && 'Author + admin / superadmin only. Overrides the share toggle.'}
              {confidentialityLevel === 'restricted' && 'Author only. Even admin cannot read this formulation.'}
            </Typography>
          </Box>
          {saveMut.isError && <Alert role="alert" severity="error">Failed to save formulation</Alert>}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setFormOpen(false)} sx={{ textTransform: 'none' }}>Cancel</Button>
          <Button variant="contained" disabled={saveMut.isPending}
            onClick={() => saveMut.mutate({ ...fiveP, sharedWithClinicians, confidentialityLevel })}
            sx={{ bgcolor: '#327C8D', textTransform: 'none', '&:hover': { bgcolor: '#286A78' } }}>
            {saveMut.isPending ? <CircularProgress role="progressbar" aria-label="Loading" size={20} /> : 'Save Formulation'}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}

/* ─── Side Effects ─── */
function SideEffectsTab() {
  const [patientId, setPatientId] = useState('');
  const { data: patientList = [] } = useQuery({
    queryKey: psychiatristKeys.patients(),
    queryFn: async (): Promise<PsychiatristPatientRow[]> => {
      try {
        const response = await apiClient.get<PatientListEnvelope | PsychiatristPatientRow[]>('patients', { limit: 200, mine: true });
        return readEnvelopeArray<PsychiatristPatientRow>(response, 'patients');
      } catch (err) {
        console.warn('PsychiatristPage: query failed', err);
        return [];
      }
    },
  });
  // BUG-619 closes the lie-about-success class on this clinical-safety
  // surface. Pre-fix the queryFn: (a) silently caught any failure
  // returning the broken empty-shape `{ aims: [], metabolic: [] }`
  // (BUG-441/445/548 silent fallback class); (b) the consumer read
  // top-level `aims` / `metabolic` fields BUT the
  // endpoint returned `{ data: [...] }` (the canonical envelope per
  // BUG-613 mapper output) — both reads ALWAYS returned undefined →
  // psychiatrist's primary AIMS+metabolic monitoring view NEVER
  // displayed any data. A clinician triaging clozapine/antipsychotic
  // patients would never see overdue tardive-dyskinesia / lipid panel
  // / glucose monitoring items. Post-fix: tryAsync per BUG-530 SSoT
  // (CLAUDE.md §16.2) + canonical envelope + client-side filter by
  // scheduleType.
  const { data: sideEffectsData, isLoading, isError: sideEffectsError } = useQuery({
    queryKey: psychiatristKeys.sideEffects(patientId),
    queryFn: async () => {
      const r = await tryAsync(() => apiClient.get<{ data: SideEffectScheduleResponse[] } | SideEffectScheduleResponse[]>('side-effect-schedules', { patientId }));
      if (isErr(r)) throw r.error;
      return Array.isArray(r.value) ? r.value : (r.value?.data ?? []);
    },
    enabled: !!patientId,
  });

  // BUG-619 — filter the canonical SideEffectScheduleResponse[] by
  // scheduleType (matches the SideEffectScheduleTypeEnum from
  // @signacare/shared: AIMS / metabolic / extrapyramidal / clozapine_fbc
  // / lipid / glucose / weight / other).
  const schedules: SideEffectScheduleResponse[] = sideEffectsData ?? [];
  const aims = schedules.filter((s) => s.scheduleType === 'AIMS');
  const metabolic = schedules.filter((s) => s.scheduleType === 'metabolic');

  const dueColor = (dueDate: string): string => {
    if (!dueDate) return '#999';
    const days = Math.floor((new Date(dueDate).getTime() - Date.now()) / 86400000);
    if (days < 0) return '#D32F2F';
    if (days <= 7) return '#b8621a';
    return '#2E7D32';
  };

  return (
    <Box>
      <FormControl size="small" sx={{ minWidth: 280, mb: 3 }}>
        <InputLabel>Select Patient</InputLabel>
        <Select label="Select Patient" value={patientId} onChange={(e) => setPatientId(e.target.value)}>
          {patientList.map((p) => (
            <MenuItem key={p.id} value={p.id}>{p.displayName ?? `${p.givenName ?? ''} ${p.familyName ?? ''}`.trim()}</MenuItem>
          ))}
        </Select>
      </FormControl>

      {!patientId && <Typography color="text.secondary" sx={{ py: 4, textAlign: 'center' }}>Select a patient to view side effect monitoring</Typography>}
      {isLoading && <CircularProgress role="progressbar" aria-label="Loading" sx={{ display: 'block', mx: 'auto', mt: 4 }} />}

      {/* BUG-619 — fail-loud rail per BUG-530 SSoT (CLAUDE.md §16.2).
          On fetch failure render an explicit Alert with clinical-safety
          belt copy; psychiatrist must NOT assume monitoring is current
          while the error persists. Pre-fix the silent catch fell back
          to a broken empty shape so the error path was invisible. */}
      {sideEffectsError && (
        <Alert role="alert" severity="error" sx={{ mb: 2 }}>
          Failed to load side-effect monitoring schedules. The display may be stale or empty — refresh to retry. Do not assume AIMS, metabolic, or other monitoring is current while the error persists.
        </Alert>
      )}

      {patientId && (
        <Grid container spacing={3}>
          {/* AIMS */}
          <Grid size={{ xs: 12, md: 6 }}>
            <Paper variant="outlined" sx={{ p: 2.5 }}>
              <Typography variant="subtitle1" fontWeight={700} color="#3D484B" sx={{ mb: 2, fontFamily: 'Albert Sans, sans-serif' }}>
                <WarningAmberIcon sx={{ fontSize: 18, mr: 0.5, verticalAlign: 'text-bottom', color: '#b8621a' }} />
                AIMS Assessment Schedule
              </Typography>
              {aims.length === 0 && <Typography variant="body2" color="text.secondary" sx={{ py: 2, textAlign: 'center' }}>No AIMS assessments scheduled</Typography>}
              {aims.map((a, i) => {
                // BUG-619 — read structured display data from the
                // `parameters` JSONB field; the canonical Response
                // schema declares this as `Record<string, unknown> |
                // null` so consumer parses defensively.
                const params = (a.parameters ?? {}) as Record<string, unknown>;
                const medication = typeof params.medication === 'string' ? params.medication : '';
                const lastScore = typeof params.lastScore === 'number' ? params.lastScore : null;
                return (
                  <Box key={a.id ?? i} sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', py: 1, borderBottom: '1px solid #eee' }}>
                    <Box>
                      <Typography variant="body2" fontWeight={600} color="#3D484B">AIMS</Typography>
                      <Typography variant="caption" color="text.secondary">{medication}</Typography>
                    </Box>
                    <Box sx={{ textAlign: 'right' }}>
                      <Chip label={a.nextDueDate ? fmtDate(a.nextDueDate) : 'Not scheduled'} size="small" sx={{
                        bgcolor: a.nextDueDate ? (dueColor(a.nextDueDate) === '#D32F2F' ? '#FDECEA' : dueColor(a.nextDueDate) === '#b8621a' ? '#FFF3E0' : '#E8F5E9') : '#F5F5F5',
                        color: dueColor(a.nextDueDate ?? ''), fontWeight: 600, fontSize: 10,
                      }} />
                      {lastScore != null && <Typography variant="caption" display="block" color="text.secondary">Last: {lastScore}</Typography>}
                    </Box>
                  </Box>
                );
              })}
            </Paper>
          </Grid>

          {/* Metabolic */}
          <Grid size={{ xs: 12, md: 6 }}>
            <Paper variant="outlined" sx={{ p: 2.5 }}>
              <Typography variant="subtitle1" fontWeight={700} color="#3D484B" sx={{ mb: 2, fontFamily: 'Albert Sans, sans-serif' }}>
                <MedicationIcon sx={{ fontSize: 18, mr: 0.5, verticalAlign: 'text-bottom', color: '#327C8D' }} />
                Metabolic Monitoring
              </Typography>
              {metabolic.length === 0 && <Typography variant="body2" color="text.secondary" sx={{ py: 2, textAlign: 'center' }}>No metabolic monitoring scheduled</Typography>}
              {metabolic.map((m, i) => {
                const params = (m.parameters ?? {}) as Record<string, unknown>;
                const medication = typeof params.medication === 'string' ? params.medication : '';
                const lastResult = typeof params.lastResult === 'string' ? params.lastResult : (typeof params.lastResult === 'number' ? String(params.lastResult) : '');
                const testName = typeof params.test === 'string' ? params.test : 'Metabolic';
                return (
                  <Box key={m.id ?? i} sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', py: 1, borderBottom: '1px solid #eee' }}>
                    <Box>
                      <Typography variant="body2" fontWeight={600} color="#3D484B">{testName}</Typography>
                      <Typography variant="caption" color="text.secondary">{medication}</Typography>
                    </Box>
                    <Box sx={{ textAlign: 'right' }}>
                      <Chip label={m.nextDueDate ? fmtDate(m.nextDueDate) : 'Not scheduled'} size="small" sx={{
                        bgcolor: m.nextDueDate ? (dueColor(m.nextDueDate) === '#D32F2F' ? '#FDECEA' : dueColor(m.nextDueDate) === '#b8621a' ? '#FFF3E0' : '#E8F5E9') : '#F5F5F5',
                        color: dueColor(m.nextDueDate ?? ''), fontWeight: 600, fontSize: 10,
                      }} />
                      {lastResult && <Typography variant="caption" display="block" color="text.secondary">Last: {lastResult}</Typography>}
                    </Box>
                  </Box>
                );
              })}
            </Paper>
          </Grid>
        </Grid>
      )}
    </Box>
  );
}

/* ─── Voice Memo ─── */
function VoiceMemoTab() {
  const qc = useQueryClient();
  const [recording, setRecording] = useState(false);
  const [transcript, setTranscript] = useState('');
  const [transcribing, setTranscribing] = useState(false);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);

  const saveMut = useMutation({
    mutationFn: (d: { transcript: string }) => apiClient.post('clinical-notes', { content: d.transcript, type: 'voice-memo' }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: psychiatristKeys.clinicToday(today()) });
    },
  });

  const startRecording = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mr = new MediaRecorder(stream);
      chunksRef.current = [];
      mr.ondataavailable = (e) => { if (e.data.size > 0) chunksRef.current.push(e.data); };
      mr.onstop = async () => {
        stream.getTracks().forEach(t => t.stop());
        const blob = new Blob(chunksRef.current, { type: 'audio/webm' });
        // Send to Whisper
        setTranscribing(true);
        try {
          const fd = new FormData();
          fd.append('audio', blob, 'memo.webm');
          const resp = await apiClient.instance.post<{ transcript?: string; text?: string }>('voice/transcribe', fd);
          setTranscript(resp.data?.transcript ?? resp.data?.text ?? '');
        } catch (_transcribeErr) {
          // intentional silent — transcription fallback keeps the note editor usable.
          void _transcribeErr;
          setTranscript('[Transcription failed - you may type your note here]');
        }
        setTranscribing(false);
      };
      mr.start();
      mediaRecorderRef.current = mr;
      setRecording(true);
    } catch (_mediaErr) {
      // intentional silent — permission denial is handled by leaving recording off.
      void _mediaErr;
    }
  }, []);

  const stopRecording = useCallback(() => {
    mediaRecorderRef.current?.stop();
    setRecording(false);
  }, []);

  return (
    <Box sx={{ maxWidth: 700 }}>
      <Paper variant="outlined" sx={{ p: 3 }}>
        <Typography variant="subtitle1" fontWeight={700} color="#3D484B" sx={{ mb: 2, fontFamily: 'Albert Sans, sans-serif' }}>
          <MicIcon sx={{ fontSize: 18, mr: 0.5, verticalAlign: 'text-bottom', color: '#327C8D' }} />
          Voice Memo
        </Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
          Record a voice memo and automatically transcribe it using Whisper. The transcript can be edited and saved as a clinical note.
        </Typography>

        {/* Record button */}
        <Box sx={{ display: 'flex', justifyContent: 'center', mb: 3 }}>
          {recording ? (
            <Button variant="contained" startIcon={<StopIcon />} onClick={stopRecording} size="large"
              sx={{ bgcolor: '#D32F2F', textTransform: 'none', px: 4, '&:hover': { bgcolor: '#B71C1C' }, animation: 'pulse 1.5s infinite' }}>
              Stop Recording
            </Button>
          ) : (
            <Button variant="contained" startIcon={<MicIcon />} onClick={startRecording} size="large"
              disabled={transcribing}
              sx={{ bgcolor: '#327C8D', textTransform: 'none', px: 4, '&:hover': { bgcolor: '#286A78' } }}>
              {transcribing ? 'Transcribing...' : 'Start Recording'}
            </Button>
          )}
        </Box>

        {recording && (
          <Box sx={{ textAlign: 'center', mb: 2 }}>
            <Box sx={{ display: 'inline-flex', alignItems: 'center', gap: 1, px: 2, py: 0.5, borderRadius: 2, bgcolor: '#FDECEA' }}>
              <Box sx={{ width: 8, height: 8, borderRadius: '50%', bgcolor: '#D32F2F', animation: 'pulse 1s infinite' }} />
              <Typography variant="caption" color="#D32F2F" fontWeight={600}>Recording...</Typography>
            </Box>
          </Box>
        )}

        {transcribing && <CircularProgress role="progressbar" aria-label="Loading" sx={{ display: 'block', mx: 'auto', mb: 2 }} />}

        {/* Transcript */}
        {(transcript || transcribing) && (
          <>
            <Typography variant="subtitle2" fontWeight={600} color="#3D484B" sx={{ mb: 1 }}>Transcript</Typography>
            <TextField fullWidth multiline rows={8} value={transcript} onChange={(e) => setTranscript(e.target.value)}
              disabled={transcribing} placeholder="Transcript will appear here..."
              sx={{ mb: 2 }} />
            {saveMut.isError && <Alert role="alert" severity="error" sx={{ mb: 1 }}>Failed to save note</Alert>}
            {saveMut.isSuccess && <Alert severity="success" sx={{ mb: 1 }}>Note saved successfully</Alert>}
            <Button variant="contained" startIcon={<SaveIcon />} disabled={saveMut.isPending || !transcript || transcribing}
              onClick={() => saveMut.mutate({ transcript })}
              sx={{ bgcolor: '#327C8D', textTransform: 'none', '&:hover': { bgcolor: '#286A78' } }}>
              {saveMut.isPending ? <CircularProgress role="progressbar" aria-label="Loading" size={20} /> : 'Save as Note'}
            </Button>
          </>
        )}
      </Paper>

      <style>{`
        @keyframes pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.5; }
        }
      `}</style>
    </Box>
  );
}
