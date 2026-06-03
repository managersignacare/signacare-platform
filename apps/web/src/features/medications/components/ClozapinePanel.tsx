// apps/web/src/features/medications/components/ClozapinePanel.tsx
//
// BUG-524-C — extracted from MedicationsTab.tsx (was L1103-2068) per
// the hybrid 2-tab split plan. The largest single panel in the file
// (~865 LOC). NIMC-compliant clozapine monitoring surface — clinical-
// safety HAZARD-class (clozapine-induced agranulocytosis is fatal
// without monitoring; cardiomyopathy / myocarditis / CIGH likewise).
//
// Imported by ActiveMedicationsTab as a sub-section inside the Active
// Medications tab (per the user-locked design 2026-04-29: clozapine
// is a sub-section, not a top-level patient-detail tab; clinicians
// see it under Active Medications when prescribed).

import AddIcon from '@mui/icons-material/Add';
import NoteAddIcon from '@mui/icons-material/NoteAdd';
import {
    Alert, Box, Button, Chip, Dialog, DialogActions, DialogContent, DialogTitle,
    Divider, FormControl, Grid, InputLabel, MenuItem, Paper, Select,
    Tab, Tabs, TextField, Typography
} from '@mui/material';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import React from 'react';
import {
  tryAsync,
  isErr,
  type ClozapineRegistrationResponse,
  type ClozapineBloodResultResponse,
  type ClozapineTitrationDayResponse,
  type ClozapineAdministrationResponse,
  type ClozapineObservationResponse,
  type ClozapineMonitoringCheckResponse,
  type ClozapineRegistrationCreateDTO,
  type ClozapineBloodResultCreateDTO,
  type ClozapineAdministrationCreateDTO,
  type ClozapineObservationCreateDTO,
  type ClozapineMonitoringCheckCreateDTO,
  type ClozapineTitrationDayCreateDTO,
} from '@signacare/shared';
import { apiClient, SignacareApiError } from '../../../shared/services/apiClient';
import { clozapineKeys } from '../../patients/queryKeys';
import { AddNoteDialog } from '../../patients/components/notes/AddNoteDialog';
import { usePrintPrescription } from '../hooks/usePrescriber';
import type { MedicationRow } from '../types';
// BUG-607 — inner-tab panels extracted to feature folder. Constants
// (NIMC_TITRATION_SCHEDULE, ANC_THRESHOLDS, NON_ADMIN_CODES,
// MONITORING_INVESTIGATIONS, ADVERSE_EFFECTS, PRE_COMMENCEMENT_ITEMS,
// ancColor, ClozapineInnerTab) live in `clozapineConstants.ts`.
// Each panel takes the data it consumes via props + a callback for
// any inline mutation or dialog-open action; mutations + dialog
// state remain in this composer (parent owns BUG-605/618 unified
// error Alerts).
import { NON_ADMIN_CODES, ancColor, type ClozapineInnerTab } from './clozapine/clozapineConstants';
import { ClozapineOverviewPanel } from './clozapine/ClozapineOverviewPanel';
import { ClozapineTitrationPanel } from './clozapine/ClozapineTitrationPanel';
import { ClozapineBloodPanel } from './clozapine/ClozapineBloodPanel';
import { ClozapineAdministrationPanel } from './clozapine/ClozapineAdministrationPanel';
import { ClozapineObservationsPanel } from './clozapine/ClozapineObservationsPanel';
import { ClozapineMonitoringPanel } from './clozapine/ClozapineMonitoringPanel';
import { ClozapineAdversePanel } from './clozapine/ClozapineAdversePanel';
import { ClozapinePrecommencementPanel } from './clozapine/ClozapinePrecommencementPanel';

interface ClozapinePanelProps { clozMeds: MedicationRow[]; patientId: string }

function isPrescribingDisciplineDenied(error: unknown): boolean {
  return error instanceof SignacareApiError
    && error.code === 'PRESCRIBING_DISCIPLINE_REQUIRED';
}

export function ClozapinePanel({ clozMeds, patientId }: ClozapinePanelProps) {
  const [noteOpen, setNoteOpen] = React.useState(false);
  const [innerTab, setInnerTab] = React.useState<ClozapineInnerTab>('overview');
  const [bloodOpen, setBloodOpen] = React.useState(false);
  const [obsOpen, setObsOpen] = React.useState(false);
  const [adminOpen, setAdminOpen] = React.useState(false);
  const qc = useQueryClient();
  const {
    isPrescriber,
    canPrescribeClozapine,
    isDisciplineEligible,
  } = usePrintPrescription(patientId);

  // BUG-618 — backend now returns canonical camelCase per CLAUDE.md
  // §5.2; consumer no longer needs `?? snake_case` dual-shape access.
  // BUG-617 — all 6 queryFns now use tryAsync + isError surfacing per
  // BUG-530 SSoT (CLAUDE.md §16.2), mirroring the BUG-610 LaiPanel
  // closure pattern. The defensive `Array.isArray(r) ? r : r?.data ?? []`
  // shape acceptance is preserved because some endpoints (registrations
  // wrapper) historically returned a `{data:[...]}` envelope.

  // Fetch registrations
  const { data: registrations = [], isError: regsError } = useQuery({
    queryKey: clozapineKeys.registrations(patientId),
    queryFn: async () => {
      const r = await tryAsync(() => apiClient.get<ClozapineRegistrationResponse[] | { data: ClozapineRegistrationResponse[] }>(`clozapine/patients/${patientId}/clozapine`));
      if (isErr(r)) throw r.error;
      return Array.isArray(r.value) ? r.value : (r.value?.data ?? []);
    },
    enabled: !!patientId,
  });
  const activeReg = registrations.find((r: ClozapineRegistrationResponse) => r.titrationPhase !== 'ceased') ?? registrations[0];

  // Fetch child data when registration exists
  const regId = activeReg?.id;
  const { data: bloodResults = [], isError: bloodError } = useQuery({
    queryKey: clozapineKeys.blood(regId),
    queryFn: async () => {
      const r = await tryAsync(() => apiClient.get<ClozapineBloodResultResponse[]>(`clozapine/${regId}/blood-results`));
      if (isErr(r)) throw r.error;
      return Array.isArray(r.value) ? r.value : [];
    },
    enabled: !!regId,
  });
  const { data: titrationDays = [], isError: titDaysError } = useQuery({
    queryKey: clozapineKeys.titration(regId),
    queryFn: async () => {
      const r = await tryAsync(() => apiClient.get<ClozapineTitrationDayResponse[]>(`clozapine/${regId}/titration-days`));
      if (isErr(r)) throw r.error;
      return Array.isArray(r.value) ? r.value : [];
    },
    enabled: !!regId,
  });
  const { data: administrations = [], isError: adminError } = useQuery({
    queryKey: clozapineKeys.admin(regId),
    queryFn: async () => {
      const r = await tryAsync(() => apiClient.get<ClozapineAdministrationResponse[]>(`clozapine/${regId}/administrations`));
      if (isErr(r)) throw r.error;
      return Array.isArray(r.value) ? r.value : [];
    },
    enabled: !!regId,
  });
  const { data: observations = [], isError: obsError } = useQuery({
    queryKey: clozapineKeys.obs(regId),
    queryFn: async () => {
      const r = await tryAsync(() => apiClient.get<ClozapineObservationResponse[]>(`clozapine/${regId}/observations`));
      if (isErr(r)) throw r.error;
      return Array.isArray(r.value) ? r.value : [];
    },
    enabled: !!regId,
  });
  const { data: monitoringChecks = [], isError: monChecksError } = useQuery({
    queryKey: clozapineKeys.monitoring(regId),
    queryFn: async () => {
      const r = await tryAsync(() => apiClient.get<ClozapineMonitoringCheckResponse[]>(`clozapine/${regId}/monitoring-checks`));
      if (isErr(r)) throw r.error;
      return Array.isArray(r.value) ? r.value : [];
    },
    enabled: !!regId,
  });

  // ── New Registration Dialog ─────────────────────────────────────────────
  const [regOpen, setRegOpen] = React.useState(false);
  const [regDate, setRegDate] = React.useState(new Date().toISOString().split('T')[0]);
  const [cpn, setCpn] = React.useState('');
  const [pharmacy, setPharmacy] = React.useState('');
  const [regDose, setRegDose] = React.useState(12.5);

  // BUG-605 — all 6 mutations on this HAZARD-class clinical-safety
  // surface (clozapine: agranulocytosis / cardiomyopathy / CIGH harm
  // classes when monitoring is missed) now use tryAsync per BUG-530
  // SSoT (CLAUDE.md §16.2) so the mutationFn either succeeds or throws
  // a typed AppError. React-Query exposes the error via `.isError` +
  // `.error` which the dialogs/panel surface via <Alert severity="error">.
  // Pre-fix the failure path relied on the global apiClient toast — a
  // silent miss on a clozapine FBC POST means the clinician thinks they
  // recorded a result that the backend rejected.
  const createRegMut = useMutation({
    mutationFn: async (data: ClozapineRegistrationCreateDTO) => {
      const r = await tryAsync(() => apiClient.post('clozapine', data));
      if (isErr(r)) throw r.error;
      return r.value;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: clozapineKeys.registrations(patientId) }); setRegOpen(false); },
  });

  // ── Blood Result Dialog state ───────────────────────────────────────────
  const [brDate, setBrDate] = React.useState(new Date().toISOString().split('T')[0]);
  const [brAnc, setBrAnc] = React.useState('');
  const [brWbc, setBrWbc] = React.useState('');
  const [brNeutPct, setBrNeutPct] = React.useState('');
  const [brLab, setBrLab] = React.useState('');
  const [brNotes, setBrNotes] = React.useState('');

  const bloodMut = useMutation({
    mutationFn: async (data: ClozapineBloodResultCreateDTO) => {
      const r = await tryAsync(() => apiClient.post('clozapine/blood-results', data));
      if (isErr(r)) throw r.error;
      return r.value;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: clozapineKeys.blood(regId) });
      qc.invalidateQueries({ queryKey: clozapineKeys.registrations(patientId) });
      setBloodOpen(false); setBrAnc(''); setBrWbc(''); setBrNeutPct(''); setBrNotes('');
    },
  });

  // ── Administration Dialog state ─────────────────────────────────────────
  const [admDate, setAdmDate] = React.useState(new Date().toISOString().split('T')[0]);
  const [admSlot, setAdmSlot] = React.useState<'morning' | 'evening'>('morning');
  const [admDose, setAdmDose] = React.useState('');
  const [admGiven, setAdmGiven] = React.useState(true);
  const [admCode, setAdmCode] = React.useState('');
  const [admInitials, setAdmInitials] = React.useState('');
  const [admNotes, setAdmNotes] = React.useState('');

  const adminMut = useMutation({
    mutationFn: async (data: ClozapineAdministrationCreateDTO) => {
      const r = await tryAsync(() => apiClient.post('clozapine/administrations', data));
      if (isErr(r)) throw r.error;
      return r.value;
    },
    // Audit Tier 9.1 (HIGH-C1) — invalidate BOTH the per-regId admin
    // list AND the parent registration list. The registration summary
    // includes last-dose + next-dose-due fields that change on every
    // administration, so the list must refresh.
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: clozapineKeys.admin(regId) });
      qc.invalidateQueries({ queryKey: clozapineKeys.registrations(patientId) });
      setAdminOpen(false); setAdmDose(''); setAdmNotes('');
    },
  });

  // ── Observation Dialog state ────────────────────────────────────────────
  const [obsDate, setObsDate] = React.useState(new Date().toISOString().split('T')[0]);
  const [obsTime, setObsTime] = React.useState('');
  const [obsTemp, setObsTemp] = React.useState('');
  const [obsPulse, setObsPulse] = React.useState('');
  const [obsBpSysL, setObsBpSysL] = React.useState('');
  const [obsBpDiaL, setObsBpDiaL] = React.useState('');
  const [obsBpSysS, setObsBpSysS] = React.useState('');
  const [obsBpDiaS, setObsBpDiaS] = React.useState('');
  const [obsRR, setObsRR] = React.useState('');
  const [obsSmoking, setObsSmoking] = React.useState('');
  const [obsCigs, setObsCigs] = React.useState('');
  const [obsNotes, setObsNotes] = React.useState('');

  const obsMut = useMutation({
    mutationFn: async (data: ClozapineObservationCreateDTO) => {
      const r = await tryAsync(() => apiClient.post('clozapine/observations', data));
      if (isErr(r)) throw r.error;
      return r.value;
    },
    // Audit Tier 9.1 — parent list invalidated alongside obs key so
    // the "last observation" summary in the registration header refreshes.
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: clozapineKeys.obs(regId) });
      qc.invalidateQueries({ queryKey: clozapineKeys.registrations(patientId) });
      setObsOpen(false); setObsTemp(''); setObsPulse(''); setObsNotes('');
    },
  });

  // ── Monitoring Check mutation ───────────────────────────────────────────
  const monMut = useMutation({
    mutationFn: async (data: ClozapineMonitoringCheckCreateDTO) => {
      const r = await tryAsync(() => apiClient.post('clozapine/monitoring-checks', data));
      if (isErr(r)) throw r.error;
      return r.value;
    },
    // Audit Tier 9.1 — monitoring-check status is surfaced in the
    // registration list (e.g. "next check due 3 days") so the list
    // must invalidate too.
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: clozapineKeys.monitoring(regId) });
      qc.invalidateQueries({ queryKey: clozapineKeys.registrations(patientId) });
    },
  });

  // ── Titration upsert mutation ───────────────────────────────────────────
  const titMut = useMutation({
    mutationFn: async (data: ClozapineTitrationDayCreateDTO) => {
      const r = await tryAsync(() => apiClient.post('clozapine/titration-days', data));
      if (isErr(r)) throw r.error;
      return r.value;
    },
    // Audit Tier 9.1 — current titration day appears in the list.
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: clozapineKeys.titration(regId) });
      qc.invalidateQueries({ queryKey: clozapineKeys.registrations(patientId) });
    },
  });

  // ── Helper: ANC status colour ──────────────────────────────────────────
  // BUG-607 — `ancColor` extracted to `clozapine/clozapineConstants.ts`.

  // ── Helper: days since registration ────────────────────────────────────
  const daysSinceStart = activeReg ? Math.floor((Date.now() - new Date(activeReg.registrationDate).getTime()) / 86400000) + 1 : 0;

  return (
    <Box>
      {/* Header */}
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 1 }}>
        <Typography variant="subtitle2" fontWeight={600}>Clozapine Monitoring (NIMC)</Typography>
        <Box sx={{ display: 'flex', gap: 1 }}>
          {!activeReg && canPrescribeClozapine && (
            <Button size="small" variant="contained" startIcon={<AddIcon />} onClick={() => setRegOpen(true)}
              sx={{ bgcolor: '#C62828', '&:hover': { bgcolor: '#B71C1C' }, fontSize: 12, textTransform: 'none' }}>
              Register Clozapine
            </Button>
          )}
          <Button size="small" variant="outlined" startIcon={<NoteAddIcon />} onClick={() => setNoteOpen(true)}
            sx={{ fontSize: 12, textTransform: 'none' }}>Note</Button>
        </Box>
      </Box>

      <AddNoteDialog open={noteOpen} onClose={() => setNoteOpen(false)} patientId={patientId} noteType="clozapine" />

      {!canPrescribeClozapine && isPrescriber && !isDisciplineEligible && (
        <Alert role="alert" severity="warning" sx={{ mb: 2 }}>
          Clozapine prescribing actions are disabled for your profile. A prescriber with an AHPRA-eligible discipline is required to register or titrate clozapine.
        </Alert>
      )}

      {/* BUG-605: surface inline-mutation failures (monMut + titMut fire
          from inline buttons, not Dialogs, so failure must be visible at
          panel level). monMut = monitoring-check; titMut = titration day. */}
      {(monMut.isError || titMut.isError) && (
        <Alert role="alert" severity="error" sx={{ mb: 2 }}>
          {isPrescribingDisciplineDenied(titMut.error)
            ? 'Titration prescribing is blocked: your discipline is not authorised for clozapine prescribing. Ask an eligible prescriber to complete this action.'
            : `Failed to save ${monMut.isError && titMut.isError ? 'monitoring check and titration day' : monMut.isError ? 'monitoring check' : 'titration day'}: ${((monMut.error || titMut.error) as Error)?.message ?? 'unknown error'}. The record was NOT saved — please retry. Do not commence the next clozapine dose until the record is confirmed.`}
        </Alert>
      )}

      {/* BUG-617 / BUG-618 — surface read-rail fetch failures (any of
          the 6 useQuery hooks). Pre-fix the panel silently rendered
          empty lists on fetch failure. Post-fix the unified banner
          fires on EITHER rail's failure with explicit clinical-safety
          guidance: clozapine is fatal without monitoring, so degraded
          read views must not be relied on for prescribing decisions. */}
      {(regsError || bloodError || titDaysError || adminError || obsError || monChecksError) && (
        <Alert role="alert" severity="error" sx={{ mb: 2 }}>
          Failed to load clozapine monitoring data — the display may be stale or empty (registration / blood result / titration / administration / observation / monitoring check fetch failed). Refresh to retry. Do not prescribe or administer clozapine based on this view while the error persists.
        </Alert>
      )}

      {/* Warning banner */}
      <Alert severity="error" sx={{ mb: 2, fontSize: 11, py: 0.5, fontWeight: 600 }}>
        Do not prescribe clozapine until approved by Clozapine Monitoring Centre and Clozapine Patient Number allocated.
      </Alert>

      {!activeReg && !clozMeds.length ? (
        <Alert severity="info">No clozapine registration found. Prescribe clozapine via the Current Medications tab and register with a Clozapine Monitoring Centre.</Alert>
      ) : (
        <>
          {/* Registration summary strip */}
          {activeReg && (
            <Paper variant="outlined" sx={{ p: 1.5, mb: 2, borderLeft: '4px solid #C62828', bgcolor: '#FFFBF5' }}>
              <Grid container spacing={2}>
                <Grid size={{ xs: 6, sm: 2 }}>
                  <Typography variant="caption" color="text.secondary">Phase</Typography>
                  <Typography variant="body2" fontWeight={700} sx={{ textTransform: 'capitalize' }}>{activeReg.titrationPhase}</Typography>
                </Grid>
                <Grid size={{ xs: 6, sm: 2 }}>
                  <Typography variant="caption" color="text.secondary">Current Dose</Typography>
                  <Typography variant="body2" fontWeight={700}>{activeReg.currentDoseMg ? `${activeReg.currentDoseMg} mg` : '—'}</Typography>
                </Grid>
                <Grid size={{ xs: 6, sm: 2 }}>
                  <Typography variant="caption" color="text.secondary">Day</Typography>
                  <Typography variant="body2" fontWeight={700}>{daysSinceStart}</Typography>
                </Grid>
                <Grid size={{ xs: 6, sm: 2 }}>
                  <Typography variant="caption" color="text.secondary">ANC Status</Typography>
                  <Chip label={(activeReg.ancStatus ?? 'unknown').toUpperCase()} size="small"
                    sx={{ bgcolor: ancColor(activeReg.ancStatus) + '20', color: ancColor(activeReg.ancStatus), fontWeight: 700, fontSize: 10 }} />
                </Grid>
                <Grid size={{ xs: 6, sm: 2 }}>
                  <Typography variant="caption" color="text.secondary">Next Blood Due</Typography>
                  <Typography variant="body2" fontWeight={600} color={activeReg.nextBloodDueDate && new Date(activeReg.nextBloodDueDate) < new Date() ? '#C62828' : 'text.primary'}>
                    {activeReg.nextBloodDueDate ? new Date(activeReg.nextBloodDueDate).toLocaleDateString('en-AU') : '—'}
                  </Typography>
                </Grid>
                <Grid size={{ xs: 6, sm: 2 }}>
                  <Typography variant="caption" color="text.secondary">Monitoring Wk</Typography>
                  <Typography variant="body2" fontWeight={700}>{activeReg.monitoringWeek ?? '—'}</Typography>
                </Grid>
              </Grid>
            </Paper>
          )}

          {/* Inner Tabs */}
          <Tabs value={innerTab} onChange={(_, v) => setInnerTab(v)} variant="scrollable" scrollButtons="auto"
            sx={{ mb: 2, '& .MuiTab-root': { textTransform: 'none', fontFamily: 'Albert Sans, sans-serif', fontSize: 12, minHeight: 36, py: 0 } }}>
            <Tab label="Overview" value="overview" />
            <Tab label="Titration Schedule" value="titration" />
            <Tab label={`Blood Results (${bloodResults.length})`} value="blood" />
            <Tab label={`Administration (${administrations.length})`} value="administration" />
            <Tab label={`Observations (${observations.length})`} value="observations" />
            <Tab label="Monitoring Checklist" value="monitoring" />
            <Tab label="Adverse Effects" value="adverse" />
            <Tab label="Pre-commencement" value="precommencement" />
          </Tabs>

          {/* BUG-607 — inner-tab panels extracted to feature folder
              `apps/web/src/features/medications/components/clozapine/`.
              Each panel receives data + callbacks as props; mutations
              + dialog state remain in this composer (parent owns the
              error surface for BUG-605/618 unified Alerts). */}
          {innerTab === 'overview' && <ClozapineOverviewPanel clozMeds={clozMeds} />}
          {innerTab === 'titration' && (
            <ClozapineTitrationPanel
              activeReg={activeReg}
              regId={regId}
              daysSinceStart={daysSinceStart}
              titrationDays={titrationDays}
              isPrescriber={canPrescribeClozapine}
              onUpsertTitration={(data) => titMut.mutate(data)}
            />
          )}
          {innerTab === 'blood' && (
            <ClozapineBloodPanel
              bloodResults={bloodResults}
              regId={regId}
              onAddBloodResult={() => setBloodOpen(true)}
            />
          )}
          {innerTab === 'administration' && (
            <ClozapineAdministrationPanel
              administrations={administrations}
              regId={regId}
              onAddAdministration={() => setAdminOpen(true)}
            />
          )}
          {innerTab === 'observations' && (
            <ClozapineObservationsPanel
              observations={observations}
              regId={regId}
              onAddObservation={() => setObsOpen(true)}
            />
          )}
          {innerTab === 'monitoring' && (
            <ClozapineMonitoringPanel
              monitoringChecks={monitoringChecks}
              regId={regId}
              onUpsertMonitoringCheck={(data) => monMut.mutate(data)}
            />
          )}
          {innerTab === 'adverse' && <ClozapineAdversePanel />}
          {innerTab === 'precommencement' && <ClozapinePrecommencementPanel />}

        </>
      )}

      {/* ═══════════ REGISTRATION DIALOG ═══════════ */}
      <Dialog open={regOpen} onClose={() => setRegOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle sx={{ fontWeight: 700 }}>Register Clozapine Patient</DialogTitle>
        <Divider />
        <DialogContent sx={{ pt: 2 }}>
          {createRegMut.isError && (
            <Alert role="alert" severity="error" sx={{ mb: 2 }}>
              {isPrescribingDisciplineDenied(createRegMut.error)
                ? 'Registration is blocked: your discipline is not authorised for clozapine prescribing. Ask an eligible prescriber to complete registration.'
                : `Failed to register clozapine patient: ${(createRegMut.error as Error)?.message ?? 'unknown error'}. The registration was NOT saved — please retry.`}
            </Alert>
          )}
          <Grid container spacing={2}>
            <Grid size={{ xs: 12, sm: 6 }}>
              <TextField label="Registration Date" size="small" fullWidth type="date" value={regDate} onChange={e => setRegDate(e.target.value)} slotProps={{ inputLabel: { shrink: true } }} />
            </Grid>
            <Grid size={{ xs: 12, sm: 6 }}>
              <TextField label="Clozapine Patient Number (CPN)" size="small" fullWidth value={cpn} onChange={e => setCpn(e.target.value)} placeholder="e.g. CPN-12345" />
            </Grid>
            <Grid size={{ xs: 12, sm: 6 }}>
              <TextField label="Dispensing Pharmacy" size="small" fullWidth value={pharmacy} onChange={e => setPharmacy(e.target.value)} />
            </Grid>
            <Grid size={{ xs: 12, sm: 6 }}>
              <TextField label="Starting Dose (mg)" size="small" fullWidth type="number" value={regDose} onChange={e => setRegDose(parseFloat(e.target.value) || 12.5)}
                slotProps={{ htmlInput: { min: 6.25, max: 900, step: 6.25 } }} />
            </Grid>
          </Grid>
        </DialogContent>
        <Divider />
        <DialogActions sx={{ px: 3, py: 2 }}>
          <Button onClick={() => setRegOpen(false)} sx={{ textTransform: 'none' }}>Cancel</Button>
          <Button variant="contained" onClick={() => createRegMut.mutate({
            patientId, registrationDate: regDate, dispenserPharmacy: pharmacy || undefined, currentDoseMg: regDose,
            titrationPhase: 'initiation', monitoringFrequency: 'weekly', notes: cpn ? `CPN: ${cpn}` : undefined,
          })} disabled={createRegMut.isPending || !canPrescribeClozapine}
            sx={{ bgcolor: '#C62828', '&:hover': { bgcolor: '#B71C1C' }, textTransform: 'none' }}>
            {createRegMut.isPending ? 'Registering...' : 'Register'}
          </Button>
        </DialogActions>
      </Dialog>

      {/* ═══════════ BLOOD RESULT DIALOG ═══════════ */}
      <Dialog open={bloodOpen} onClose={() => setBloodOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle sx={{ fontWeight: 700 }}>Record Blood Result</DialogTitle>
        <Divider />
        <DialogContent sx={{ pt: 2 }}>
          {bloodMut.isError && (
            <Alert role="alert" severity="error" sx={{ mb: 2 }}>
              Failed to record blood result: {(bloodMut.error as Error)?.message ?? 'unknown error'}. The FBC was NOT saved — agranulocytosis monitoring requires this record. Please retry before continuing clozapine prescribing.
            </Alert>
          )}
          <Grid container spacing={2}>
            <Grid size={{ xs: 12, sm: 6 }}>
              <TextField label="Collection Date" size="small" fullWidth type="date" value={brDate} onChange={e => setBrDate(e.target.value)} slotProps={{ inputLabel: { shrink: true } }} />
            </Grid>
            <Grid size={{ xs: 6, sm: 3 }}>
              <TextField label="WBC (×10⁹/L)" size="small" fullWidth type="number" value={brWbc} onChange={e => setBrWbc(e.target.value)}
                slotProps={{ htmlInput: { min: 0, max: 50, step: 0.1 } }} />
            </Grid>
            <Grid size={{ xs: 6, sm: 3 }}>
              <TextField label="ANC (×10⁹/L)" size="small" fullWidth type="number" value={brAnc} onChange={e => setBrAnc(e.target.value)}
                slotProps={{ htmlInput: { min: 0, max: 50, step: 0.1 } }} />
            </Grid>
            <Grid size={{ xs: 6, sm: 3 }}>
              <TextField label="Neutrophils %" size="small" fullWidth type="number" value={brNeutPct} onChange={e => setBrNeutPct(e.target.value)}
                slotProps={{ htmlInput: { min: 0, max: 100, step: 0.1 } }} />
            </Grid>
            <Grid size={{ xs: 6, sm: 3 }}>
              <TextField label="Lab Name" size="small" fullWidth value={brLab} onChange={e => setBrLab(e.target.value)} />
            </Grid>
            <Grid size={{ xs: 12 }}>
              <TextField label="Clinical Notes" size="small" fullWidth multiline rows={2} value={brNotes} onChange={e => setBrNotes(e.target.value)} />
            </Grid>
          </Grid>
        </DialogContent>
        <Divider />
        <DialogActions sx={{ px: 3, py: 2 }}>
          <Button onClick={() => setBloodOpen(false)} sx={{ textTransform: 'none' }}>Cancel</Button>
          <Button variant="contained" onClick={() => bloodMut.mutate({
            registrationId: regId, patientId, collectionDate: brDate,
            ancValue: brAnc ? parseFloat(brAnc) : undefined,
            wbcValue: brWbc ? parseFloat(brWbc) : undefined,
            neutrophilsPct: brNeutPct ? parseFloat(brNeutPct) : undefined,
            labName: brLab || undefined, clinicalNotes: brNotes || undefined,
          })} disabled={bloodMut.isPending}
            sx={{ bgcolor: '#C62828', '&:hover': { bgcolor: '#B71C1C' }, textTransform: 'none' }}>
            {bloodMut.isPending ? 'Saving...' : 'Record Result'}
          </Button>
        </DialogActions>
      </Dialog>

      {/* ═══════════ ADMINISTRATION DIALOG ═══════════ */}
      <Dialog open={adminOpen} onClose={() => setAdminOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle sx={{ fontWeight: 700 }}>Record Administration</DialogTitle>
        <Divider />
        <DialogContent sx={{ pt: 2 }}>
          {adminMut.isError && (
            <Alert role="alert" severity="error" sx={{ mb: 2 }}>
              Failed to record administration: {(adminMut.error as Error)?.message ?? 'unknown error'}. The dose was NOT recorded — the next dose timer + audit trail will be incorrect. Please retry before recording the next dose.
            </Alert>
          )}
          <Grid container spacing={2}>
            <Grid size={{ xs: 6 }}>
              <TextField label="Date" size="small" fullWidth type="date" value={admDate} onChange={e => setAdmDate(e.target.value)} slotProps={{ inputLabel: { shrink: true } }} />
            </Grid>
            <Grid size={{ xs: 6 }}>
              <FormControl fullWidth size="small">
                <InputLabel>Time Slot</InputLabel>
                <Select value={admSlot} onChange={e => setAdmSlot(e.target.value as 'morning' | 'evening')} label="Time Slot">
                  <MenuItem value="morning">Morning (0800)</MenuItem>
                  <MenuItem value="evening">Evening (2000)</MenuItem>
                </Select>
              </FormControl>
            </Grid>
            <Grid size={{ xs: 6 }}>
              <TextField label="Dose (mg)" size="small" fullWidth type="number" value={admDose} onChange={e => setAdmDose(e.target.value)}
                slotProps={{ htmlInput: { min: 0, max: 900, step: 12.5 } }} />
            </Grid>
            <Grid size={{ xs: 6 }}>
              <FormControl fullWidth size="small">
                <InputLabel>Administered?</InputLabel>
                <Select value={admGiven ? 'yes' : 'no'} onChange={e => setAdmGiven(e.target.value === 'yes')} label="Administered?">
                  <MenuItem value="yes">Yes — Administered</MenuItem>
                  <MenuItem value="no">No — See code below</MenuItem>
                </Select>
              </FormControl>
            </Grid>
            {!admGiven && (
              <Grid size={{ xs: 12 }}>
                <FormControl fullWidth size="small">
                  <InputLabel>Non-Administration Code</InputLabel>
                  <Select value={admCode} onChange={e => setAdmCode(e.target.value)} label="Non-Administration Code">
                    {NON_ADMIN_CODES.map(c => <MenuItem key={c.code} value={c.code}>{c.code} — {c.label}</MenuItem>)}
                  </Select>
                </FormControl>
              </Grid>
            )}
            <Grid size={{ xs: 6 }}>
              <TextField label="Administrator Initials" size="small" fullWidth value={admInitials} onChange={e => setAdmInitials(e.target.value)} />
            </Grid>
            <Grid size={{ xs: 12 }}>
              <TextField label="Notes" size="small" fullWidth multiline rows={2} value={admNotes} onChange={e => setAdmNotes(e.target.value)} />
            </Grid>
          </Grid>
        </DialogContent>
        <Divider />
        <DialogActions sx={{ px: 3, py: 2 }}>
          <Button onClick={() => setAdminOpen(false)} sx={{ textTransform: 'none' }}>Cancel</Button>
          <Button variant="contained" onClick={() => adminMut.mutate({
            registrationId: regId, administrationDate: admDate, timeSlot: admSlot,
            doseMg: parseFloat(admDose) || 0, administered: admGiven,
            nonAdminCode: !admGiven && admCode ? (admCode as ClozapineAdministrationCreateDTO['nonAdminCode']) : undefined,
            administratorInitials: admInitials || undefined, notes: admNotes || undefined,
          })} disabled={adminMut.isPending || !admDose}
            sx={{ bgcolor: '#b8621a', '&:hover': { bgcolor: '#d6741f' }, textTransform: 'none' }}>
            {adminMut.isPending ? 'Saving...' : 'Record'}
          </Button>
        </DialogActions>
      </Dialog>

      {/* ═══════════ OBSERVATION DIALOG ═══════════ */}
      <Dialog open={obsOpen} onClose={() => setObsOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle sx={{ fontWeight: 700 }}>Record Observation</DialogTitle>
        <Divider />
        <DialogContent sx={{ pt: 2 }}>
          {obsMut.isError && (
            <Alert role="alert" severity="error" sx={{ mb: 2 }}>
              Failed to record observation: {(obsMut.error as Error)?.message ?? 'unknown error'}. Vital signs were NOT saved — cardiomyopathy / clozapine-induced hypotension monitoring requires this record. Please retry.
            </Alert>
          )}
          <Grid container spacing={2}>
            <Grid size={{ xs: 6 }}>
              <TextField label="Date" size="small" fullWidth type="date" value={obsDate} onChange={e => setObsDate(e.target.value)} slotProps={{ inputLabel: { shrink: true } }} />
            </Grid>
            <Grid size={{ xs: 6 }}>
              <TextField label="Time (HH:MM)" size="small" fullWidth value={obsTime} onChange={e => setObsTime(e.target.value)} placeholder="14:30" />
            </Grid>
            <Grid size={{ xs: 4 }}>
              <TextField label="Temp °C" size="small" fullWidth type="number" value={obsTemp} onChange={e => setObsTemp(e.target.value)} slotProps={{ htmlInput: { min: 30, max: 45, step: 0.1 } }} />
            </Grid>
            <Grid size={{ xs: 4 }}>
              <TextField label="Pulse (bpm)" size="small" fullWidth type="number" value={obsPulse} onChange={e => setObsPulse(e.target.value)} />
            </Grid>
            <Grid size={{ xs: 4 }}>
              <TextField label="Resp Rate" size="small" fullWidth type="number" value={obsRR} onChange={e => setObsRR(e.target.value)} />
            </Grid>
            <Grid size={{ xs: 3 }}>
              <TextField label="BP Sys (Lying)" size="small" fullWidth type="number" value={obsBpSysL} onChange={e => setObsBpSysL(e.target.value)} />
            </Grid>
            <Grid size={{ xs: 3 }}>
              <TextField label="BP Dia (Lying)" size="small" fullWidth type="number" value={obsBpDiaL} onChange={e => setObsBpDiaL(e.target.value)} />
            </Grid>
            <Grid size={{ xs: 3 }}>
              <TextField label="BP Sys (Standing)" size="small" fullWidth type="number" value={obsBpSysS} onChange={e => setObsBpSysS(e.target.value)} />
            </Grid>
            <Grid size={{ xs: 3 }}>
              <TextField label="BP Dia (Standing)" size="small" fullWidth type="number" value={obsBpDiaS} onChange={e => setObsBpDiaS(e.target.value)} />
            </Grid>
            <Grid size={{ xs: 6 }}>
              <FormControl fullWidth size="small">
                <InputLabel>Smoking Status</InputLabel>
                <Select value={obsSmoking} onChange={e => setObsSmoking(e.target.value)} label="Smoking Status">
                  <MenuItem value="non-smoker">Non-smoker</MenuItem>
                  <MenuItem value="smoker">Smoker</MenuItem>
                  <MenuItem value="recently_ceased">Recently ceased</MenuItem>
                </Select>
              </FormControl>
            </Grid>
            <Grid size={{ xs: 6 }}>
              <TextField label="Cigarettes/day" size="small" fullWidth type="number" value={obsCigs} onChange={e => setObsCigs(e.target.value)} />
            </Grid>
            <Grid size={{ xs: 12 }}>
              <TextField label="Notes" size="small" fullWidth multiline rows={2} value={obsNotes} onChange={e => setObsNotes(e.target.value)} />
            </Grid>
          </Grid>
        </DialogContent>
        <Divider />
        <DialogActions sx={{ px: 3, py: 2 }}>
          <Button onClick={() => setObsOpen(false)} sx={{ textTransform: 'none' }}>Cancel</Button>
          <Button variant="contained" onClick={() => {
            const isOutside = (obsTemp && parseFloat(obsTemp) > 38) || (obsPulse && parseInt(obsPulse, 10) > 100) ||
              (obsBpSysL && obsBpSysS && (parseInt(obsBpSysL, 10) - parseInt(obsBpSysS, 10)) > 20);
            obsMut.mutate({
              registrationId: regId, observationDate: obsDate, observationTime: obsTime || undefined,
              temperature: obsTemp ? parseFloat(obsTemp) : undefined,
              pulse: obsPulse ? parseInt(obsPulse, 10) : undefined,
              bpSystolicLying: obsBpSysL ? parseInt(obsBpSysL, 10) : undefined,
              bpDiastolicLying: obsBpDiaL ? parseInt(obsBpDiaL, 10) : undefined,
              bpSystolicStanding: obsBpSysS ? parseInt(obsBpSysS, 10) : undefined,
              bpDiastolicStanding: obsBpDiaS ? parseInt(obsBpDiaS, 10) : undefined,
              respirationRate: obsRR ? parseInt(obsRR, 10) : undefined,
              smokingStatus: (obsSmoking || undefined) as ClozapineObservationCreateDTO['smokingStatus'],
              cigarettesPerDay: obsCigs ? parseInt(obsCigs, 10) : undefined,
              outsideNormal: !!isOutside, notes: obsNotes || undefined,
            });
          }} disabled={obsMut.isPending}
            sx={{ bgcolor: '#327C8D', '&:hover': { bgcolor: '#265F6B' }, textTransform: 'none' }}>
            {obsMut.isPending ? 'Saving...' : 'Record'}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
