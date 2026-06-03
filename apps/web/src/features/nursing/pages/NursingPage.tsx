import React, { useState, useMemo } from 'react';
import {
  Alert, Box, Button, Checkbox, Chip, CircularProgress, Dialog, DialogActions,
  DialogContent, DialogTitle, FormControl, FormControlLabel, Grid,
  InputLabel, MenuItem, Paper, Select, Tab, Tabs, TextField, Typography,
} from '@mui/material';
import MedicationIcon from '@mui/icons-material/Medication';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import CancelIcon from '@mui/icons-material/Cancel';
import RemoveCircleIcon from '@mui/icons-material/RemoveCircle';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '../../../shared/services/apiClient';
import { nursingKeys } from '../queryKeys';
import {
  fmtDate,
  fmtTime,
  parseRiskFlags,
  toHandoverUpdates,
  toMarMedicationList,
  toObservationList,
  toPatientList,
  toPhoneTriageRows,
} from './nursingPageSupport';
import type {
  HandoverAutoSummaryResponse,
  HandoverUpdateRow,
  HandoverUpdatesResponse,
  MarAdministrationRow,
  MarChartResponse,
  MarMedicationRow,
  ObservationForm,
  ObservationRow,
  ObservationsResponse,
  PatientsResponse,
  PhoneTriageResponse,
  PhoneTriageRow,
  RiskFlags,
  SaveHandoverPayload,
  ShiftType,
  PatientOption,
} from './nursingPageSupport';

export default function NursingPage(): React.ReactElement {
  const [tab, setTab] = useState(0);

  return (
    <Box sx={{ p: { xs: 2, md: 3 }, bgcolor: '#FBF8F5', minHeight: '100vh' }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, mb: 3 }}>
        <MedicationIcon sx={{ color: '#327C8D', fontSize: 28 }} />
        <Box>
          <Typography variant="h5" fontWeight={700} fontFamily="Albert Sans, sans-serif" color="#3D484B">Nursing</Typography>
          <Typography variant="body2" color="text.secondary">MAR chart, observations, assessments, and handover</Typography>
        </Box>
      </Box>

      <Tabs aria-label="Navigation tabs" value={tab} onChange={(_, v) => setTab(v)} sx={{ mb: 3, '& .MuiTab-root': { textTransform: 'none', fontWeight: 600 } }}>
        <Tab label="MAR Chart" />
        <Tab label="Observations" />
        <Tab label="Assessments" />
        <Tab label="Handover" />
        <Tab label="Phone Triage" />
      </Tabs>

      {tab === 0 && <MarChartTab />}
      {tab === 1 && <ObservationsTab />}
      {tab === 2 && <AssessmentsTab />}
      {tab === 3 && <HandoverTab />}
      {tab === 4 && <PhoneTriageReviewTab />}
    </Box>
  );
}

/* ─── MAR Chart ─── */
function MarChartTab() {
  // BUG-624 + BUG-625 — dead WRITE rail removed. Pre-fix the MarChartTab
  // exposed an `adminMut` useMutation + IconButton onClick that fired
  // ONLY when `med.scheduledTimes` included the time slot. The backend
  // never emitted `scheduledTimes` (verified via the BUG-623 handler
  // rewrite — flat shape carries id/name/dose/route/frequency/status/
  // administrations only). Therefore the IconButton was structurally
  // unreachable since BUG-524-D extraction; the WRITE rail was dead
  // code. The clinician's actual administration-recording workflow
  // lives in MarChartPanel.tsx (full dialog with AHPRA-required field
  // capture + BUG-615 belt copy on failure). NursingPage MAR is the
  // nurse-station read-only overview. Removing the dead WRITE rail
  // closes BUG-624 (lie-about-success: no mutation = no error UX
  // needed) and BUG-625 (incomplete payload: no payload to fix) by
  // structural removal — gold-standard over keeping unreachable code
  // on a clinical-safety surface.
  const [patientId, setPatientId] = useState('');

  const { data: patients, isLoading: pLoading } = useQuery<PatientsResponse>({
    queryKey: nursingKeys.patients(),
    queryFn: async (): Promise<PatientsResponse> => {
      try {
        return await apiClient.get<PatientsResponse>('patients', { limit: 200 });
      } catch (err) {
        console.warn('NursingPage: query failed', err);
        return [];
      }
    },
  });

  const { data: marData, isLoading: mLoading, error: marError } = useQuery<MarChartResponse>({
    // Backend (audit Tier 1.2) enforces requirePatientRelationship — if
    // the nurse is not on this patient's care team the request returns
    // 403 with code NO_PATIENT_RELATIONSHIP. Surface that explicitly
    // instead of silently showing an empty MAR. Any other error is
    // treated as a load failure banner.
    queryKey: nursingKeys.marChart(patientId),
    queryFn: () => apiClient.get<MarChartResponse>(`medications/mar/${patientId}`),
    enabled: !!patientId,
    retry: false,
  });
  const marErrorCode = (marError as { code?: string } | null)?.code;
  const noRelationship = marErrorCode === 'NO_PATIENT_RELATIONSHIP';

  const patientList = toPatientList(patients);
  const medications = toMarMedicationList(marData);
  const timeSlots = ['06:00', '08:00', '10:00', '12:00', '14:00', '18:00', '20:00', '22:00'];

  const MAR_STATUS: Record<string, { icon: React.ReactElement; color: string; bg: string }> = {
    given: { icon: <CheckCircleIcon sx={{ fontSize: 16 }} />, color: '#2E7D32', bg: '#E8F5E9' },
    refused: { icon: <CancelIcon sx={{ fontSize: 16 }} />, color: '#D32F2F', bg: '#FDECEA' },
    withheld: { icon: <RemoveCircleIcon sx={{ fontSize: 16 }} />, color: '#b8621a', bg: '#FFF3E0' },
  };

  return (
    <Box>
      <FormControl size="small" sx={{ minWidth: 280, mb: 3 }}>
        <InputLabel>Select Patient</InputLabel>
        <Select label="Select Patient" value={patientId} onChange={(e) => setPatientId(e.target.value)}>
          {patientList.map((p: PatientOption) => (
            <MenuItem key={p.id} value={p.id}>
              {p.displayName ?? `${p.givenName ?? ''} ${p.familyName ?? ''}`.trim() ?? p.id}
            </MenuItem>
          ))}
        </Select>
      </FormControl>
      {pLoading && <CircularProgress role="progressbar" aria-label="Loading" size={20} sx={{ ml: 2 }} />}

      {patientId && mLoading && <CircularProgress role="progressbar" aria-label="Loading" sx={{ display: 'block', mx: 'auto', mt: 4 }} />}

      {patientId && !mLoading && noRelationship && (
        <Typography role="alert" color="error" sx={{ py: 4, textAlign: 'center' }}>
          You are not on this patient's care team, so the MAR is not available.
          If this is an emergency, request break-glass access from your supervisor.
        </Typography>
      )}

      {patientId && !mLoading && !noRelationship && marError && (
        <Typography role="alert" color="error" sx={{ py: 4, textAlign: 'center' }}>
          Failed to load MAR. Try again or contact support.
        </Typography>
      )}

      {patientId && !mLoading && !marError && medications.length === 0 && (
        <Typography color="text.secondary" sx={{ py: 4, textAlign: 'center' }}>No medications found for this patient</Typography>
      )}

      {patientId && medications.length > 0 && (
        <Paper variant="outlined" sx={{ overflow: 'auto' }}>
          <Box sx={{ display: 'grid', gridTemplateColumns: `200px repeat(${timeSlots.length}, 80px)`, minWidth: 850 }}>
            {/* Header */}
            <Box sx={{ p: 1.5, bgcolor: '#327C8D', color: '#fff', fontWeight: 700, fontSize: 13, fontFamily: 'Albert Sans, sans-serif' }}>
              Medication
            </Box>
            {timeSlots.map(t => (
              <Box key={t} sx={{ p: 1.5, bgcolor: '#327C8D', color: '#fff', fontWeight: 600, fontSize: 12, textAlign: 'center' }}>
                {t}
              </Box>
            ))}

            {/* Rows */}
            {medications.map((med: MarMedicationRow, mi: number) => (
              <React.Fragment key={med.id ?? mi}>
                <Box sx={{ p: 1.5, borderBottom: '1px solid #eee', display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
                  <Typography variant="body2" fontWeight={600} color="#3D484B" sx={{ fontSize: 12 }}>
                    {med.name ?? med.medicationName}
                  </Typography>
                  <Typography variant="caption" color="text.secondary" sx={{ fontSize: 10 }}>
                    {med.dose ?? ''} {med.route ?? ''}
                  </Typography>
                </Box>
                {timeSlots.map(t => {
                  const admin = (med.administrations ?? []).find((a: MarAdministrationRow) => (a.scheduledTime ?? a.time ?? '').includes(t));
                  const status = admin?.status ?? null;
                  const s = status ? MAR_STATUS[status] : null;
                  return (
                    <Box key={t} sx={{ p: 0.5, borderBottom: '1px solid #eee', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                      {s ? (
                        <Chip icon={s.icon} label={status} size="small" sx={{ bgcolor: s.bg, color: s.color, fontSize: 9, fontWeight: 600, height: 24 }} />
                      ) : (
                        <Box sx={{ width: 28, height: 28 }} />
                      )}
                    </Box>
                  );
                })}
              </React.Fragment>
            ))}
          </Box>
        </Paper>
      )}
    </Box>
  );
}

/* ─── Observations ─── */
function ObservationsTab() {
  const qc = useQueryClient();
  const [patientId, setPatientId] = useState('');
  const [form, setForm] = useState<ObservationForm>({ level: '', location: '', mood: '', behaviour: '', sleep: '', notes: '' });

  const { data: patients } = useQuery<PatientsResponse>({
    queryKey: nursingKeys.patients(),
    queryFn: async (): Promise<PatientsResponse> => {
      try {
        return await apiClient.get<PatientsResponse>('patients', { limit: 200 });
      } catch (err) {
        console.warn('NursingPage: query failed', err);
        return [];
      }
    },
  });
  const { data: obsData, isLoading } = useQuery<ObservationsResponse>({
    queryKey: nursingKeys.observations(patientId),
    queryFn: async (): Promise<ObservationsResponse> => {
      try {
        return await apiClient.get<ObservationsResponse>('structured-observations', { patientId });
      } catch (err) {
        console.warn('NursingPage: query failed', err);
        return [];
      }
    },
    enabled: !!patientId,
  });
  const saveMut = useMutation({
    mutationFn: (d: ObservationForm) => apiClient.post('structured-observations', { patientId, ...d }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: nursingKeys.observations(patientId) });
      setForm({ level: '', location: '', mood: '', behaviour: '', sleep: '', notes: '' });
    },
  });

  const patientList = toPatientList(patients);
  const observations = toObservationList(obsData);

  const OBS_LEVELS = ['Level 1 - General', 'Level 2 - Intermittent', 'Level 3 - Within Eyesight', 'Level 4 - Within Arm\'s Length'];
  const LOCATIONS = ['Bedroom', 'Day Room', 'Garden', 'Dining', 'Bathroom', 'Off Ward', 'Leave'];
  const MOODS = ['Settled', 'Anxious', 'Low', 'Elated', 'Agitated', 'Withdrawn', 'Irritable'];
  const BEHAVIOURS = ['Calm', 'Restless', 'Pacing', 'Isolating', 'Socialising', 'Sleeping', 'Aggressive'];

  return (
    <Grid container spacing={3}>
      <Grid size={{ xs: 12, md: 5 }}>
        <Paper variant="outlined" sx={{ p: 2.5 }}>
          <Typography variant="subtitle1" fontWeight={700} color="#3D484B" sx={{ mb: 2, fontFamily: 'Albert Sans, sans-serif' }}>
            Record Observation
          </Typography>
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            <FormControl size="small" fullWidth>
              <InputLabel>Patient</InputLabel>
              <Select label="Patient" value={patientId} onChange={(e) => setPatientId(e.target.value)}>
                {patientList.map((p: PatientOption) => (
                  <MenuItem key={p.id} value={p.id}>{p.displayName ?? `${p.givenName ?? ''} ${p.familyName ?? ''}`.trim()}</MenuItem>
                ))}
              </Select>
            </FormControl>
            <FormControl size="small" fullWidth>
              <InputLabel>Observation Level</InputLabel>
              <Select label="Observation Level" value={form.level} onChange={(e) => setForm(p => ({ ...p, level: e.target.value }))}>
                {OBS_LEVELS.map(l => <MenuItem key={l} value={l}>{l}</MenuItem>)}
              </Select>
            </FormControl>
            <FormControl size="small" fullWidth>
              <InputLabel>Location</InputLabel>
              <Select label="Location" value={form.location} onChange={(e) => setForm(p => ({ ...p, location: e.target.value }))}>
                {LOCATIONS.map(l => <MenuItem key={l} value={l}>{l}</MenuItem>)}
              </Select>
            </FormControl>
            <FormControl size="small" fullWidth>
              <InputLabel>Mood</InputLabel>
              <Select label="Mood" value={form.mood} onChange={(e) => setForm(p => ({ ...p, mood: e.target.value }))}>
                {MOODS.map(m => <MenuItem key={m} value={m}>{m}</MenuItem>)}
              </Select>
            </FormControl>
            <FormControl size="small" fullWidth>
              <InputLabel>Behaviour</InputLabel>
              <Select label="Behaviour" value={form.behaviour} onChange={(e) => setForm(p => ({ ...p, behaviour: e.target.value }))}>
                {BEHAVIOURS.map(b => <MenuItem key={b} value={b}>{b}</MenuItem>)}
              </Select>
            </FormControl>
            <FormControl size="small" fullWidth>
              <InputLabel>Sleep</InputLabel>
              <Select label="Sleep" value={form.sleep} onChange={(e) => setForm(p => ({ ...p, sleep: e.target.value }))}>
                <MenuItem value="Sleeping well">Sleeping well</MenuItem>
                <MenuItem value="Intermittent sleep">Intermittent sleep</MenuItem>
                <MenuItem value="Difficulty sleeping">Difficulty sleeping</MenuItem>
                <MenuItem value="Not sleeping">Not sleeping</MenuItem>
                <MenuItem value="N/A">N/A</MenuItem>
              </Select>
            </FormControl>
            <TextField label="Additional Notes" size="small" fullWidth multiline rows={2} value={form.notes}
              onChange={(e) => setForm(p => ({ ...p, notes: e.target.value }))} />
            {saveMut.isError && <Alert role="alert" severity="error">Failed to save observation</Alert>}
            <Button variant="contained" disabled={saveMut.isPending || !patientId || !form.level}
              onClick={() => saveMut.mutate(form)}
              sx={{ bgcolor: '#327C8D', textTransform: 'none', '&:hover': { bgcolor: '#286A78' } }}>
              {saveMut.isPending ? <CircularProgress role="progressbar" aria-label="Loading" size={20} /> : 'Save Observation'}
            </Button>
          </Box>
        </Paper>
      </Grid>

      <Grid size={{ xs: 12, md: 7 }}>
        <Paper variant="outlined" sx={{ p: 2.5 }}>
          <Typography variant="subtitle1" fontWeight={700} color="#3D484B" sx={{ mb: 2, fontFamily: 'Albert Sans, sans-serif' }}>
            Observation Timeline
          </Typography>
          {isLoading && <CircularProgress role="progressbar" aria-label="Loading" size={24} />}
          {!patientId && <Typography color="text.secondary" variant="body2" sx={{ py: 2, textAlign: 'center' }}>Select a patient to view observations</Typography>}
          {patientId && observations.length === 0 && !isLoading && (
            <Typography color="text.secondary" variant="body2" sx={{ py: 2, textAlign: 'center' }}>No observations recorded</Typography>
          )}
          {observations.slice(0, 30).map((o: ObservationRow, i: number) => (
            <Box key={o.id ?? i} sx={{ position: 'relative', pl: 3, pb: 2, borderLeft: '2px solid #327C8D', ml: 1 }}>
              <Box sx={{
                position: 'absolute', left: -6, top: 0, width: 10, height: 10, borderRadius: '50%', bgcolor: '#327C8D',
              }} />
              <Box sx={{ display: 'flex', gap: 1, alignItems: 'center', mb: 0.5 }}>
                <Typography variant="caption" fontWeight={700} color="#327C8D">
                  {o.createdAt ? `${fmtDate(o.createdAt)} ${fmtTime(o.createdAt)}` : `Entry ${i + 1}`}
                </Typography>
                {o.level && <Chip label={o.level} size="small" sx={{ fontSize: 9, height: 20, bgcolor: '#E8F5F7', color: '#327C8D' }} />}
              </Box>
              <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5, mb: 0.5 }}>
                {o.location && <Chip label={o.location} size="small" variant="outlined" sx={{ fontSize: 10, height: 20 }} />}
                {o.mood && <Chip label={o.mood} size="small" variant="outlined" sx={{ fontSize: 10, height: 20 }} />}
                {o.behaviour && <Chip label={o.behaviour} size="small" variant="outlined" sx={{ fontSize: 10, height: 20 }} />}
                {o.sleep && <Chip label={o.sleep} size="small" variant="outlined" sx={{ fontSize: 10, height: 20 }} />}
              </Box>
              {o.notes && <Typography variant="caption" color="text.secondary">{o.notes}</Typography>}
            </Box>
          ))}
        </Paper>
      </Grid>
    </Grid>
  );
}

/* ─── Assessments ─── */
function AssessmentsTab() {
  const [subTab, setSubTab] = useState(0);
  return (
    <Box>
      <Tabs aria-label="Navigation tabs" value={subTab} onChange={(_, v) => setSubTab(v)} variant="scrollable" sx={{ mb: 3, '& .MuiTab-root': { textTransform: 'none', fontWeight: 500, fontSize: 13 } }}>
        <Tab label="NEWS2" />
        <Tab label="Falls Risk" />
        <Tab label="Fluid Balance" />
        <Tab label="Wound Care" />
      </Tabs>
      {subTab === 0 && <News2Calculator />}
      {subTab === 1 && <FallsRiskCalculator />}
      {subTab === 2 && <FluidBalanceCalculator />}
      {subTab === 3 && <WoundCareForm />}
    </Box>
  );
}

function News2Calculator() {
  const [vals, setVals] = useState({ respRate: '', o2Sat: '', o2Supplement: 'no', systolicBp: '', pulse: '', consciousness: 'A', temperature: '' });
  const set = (k: string, v: string) => setVals(p => ({ ...p, [k]: v }));

  const score = useMemo(() => {
    let s = 0;
    const rr = parseInt(vals.respRate, 10);
    if (!isNaN(rr)) { if (rr <= 8) s += 3; else if (rr <= 11) s += 1; else if (rr >= 21 && rr <= 24) s += 2; else if (rr >= 25) s += 3; }
    const o2 = parseInt(vals.o2Sat, 10);
    if (!isNaN(o2)) { if (o2 <= 91) s += 3; else if (o2 <= 93) s += 2; else if (o2 <= 95) s += 1; }
    if (vals.o2Supplement === 'yes') s += 2;
    const bp = parseInt(vals.systolicBp, 10);
    if (!isNaN(bp)) { if (bp <= 90) s += 3; else if (bp <= 100) s += 2; else if (bp <= 110) s += 1; else if (bp >= 220) s += 3; }
    const hr = parseInt(vals.pulse, 10);
    if (!isNaN(hr)) { if (hr <= 40) s += 3; else if (hr <= 50) s += 1; else if (hr >= 91 && hr <= 110) s += 1; else if (hr >= 111 && hr <= 130) s += 2; else if (hr >= 131) s += 3; }
    if (vals.consciousness !== 'A') s += 3;
    const temp = parseFloat(vals.temperature);
    if (!isNaN(temp)) { if (temp <= 35) s += 3; else if (temp <= 36) s += 1; else if (temp >= 38.1 && temp <= 39) s += 1; else if (temp >= 39.1) s += 2; }
    return s;
  }, [vals]);

  const risk = score >= 7 ? { label: 'High', color: '#D32F2F' } : score >= 5 ? { label: 'Medium', color: '#b8621a' } : score >= 1 ? { label: 'Low', color: '#327C8D' } : { label: 'None', color: '#2E7D32' };

  return (
    <Paper variant="outlined" sx={{ p: 3, maxWidth: 600 }}>
      <Typography variant="subtitle1" fontWeight={700} color="#3D484B" sx={{ mb: 2, fontFamily: 'Albert Sans, sans-serif' }}>
        NEWS2 Score Calculator
      </Typography>
      <Grid container spacing={2}>
        <Grid size={{ xs: 6 }}><TextField label="Resp Rate" size="small" fullWidth type="number" value={vals.respRate} onChange={(e) => set('respRate', e.target.value)} /></Grid>
        <Grid size={{ xs: 6 }}><TextField label="O2 Saturation %" size="small" fullWidth type="number" value={vals.o2Sat} onChange={(e) => set('o2Sat', e.target.value)} /></Grid>
        <Grid size={{ xs: 6 }}>
          <FormControl size="small" fullWidth><InputLabel>O2 Supplement</InputLabel>
            <Select label="O2 Supplement" value={vals.o2Supplement} onChange={(e) => set('o2Supplement', e.target.value)}>
              <MenuItem value="no">No</MenuItem><MenuItem value="yes">Yes</MenuItem>
            </Select></FormControl>
        </Grid>
        <Grid size={{ xs: 6 }}><TextField label="Systolic BP" size="small" fullWidth type="number" value={vals.systolicBp} onChange={(e) => set('systolicBp', e.target.value)} /></Grid>
        <Grid size={{ xs: 6 }}><TextField label="Pulse" size="small" fullWidth type="number" value={vals.pulse} onChange={(e) => set('pulse', e.target.value)} /></Grid>
        <Grid size={{ xs: 6 }}>
          <FormControl size="small" fullWidth><InputLabel>Consciousness</InputLabel>
            <Select label="Consciousness" value={vals.consciousness} onChange={(e) => set('consciousness', e.target.value)}>
              <MenuItem value="A">Alert</MenuItem><MenuItem value="V">Voice</MenuItem><MenuItem value="P">Pain</MenuItem><MenuItem value="U">Unresponsive</MenuItem>
            </Select></FormControl>
        </Grid>
        <Grid size={{ xs: 6 }}><TextField label="Temperature" size="small" fullWidth type="number" inputProps={{ step: 0.1 }} value={vals.temperature} onChange={(e) => set('temperature', e.target.value)} /></Grid>
      </Grid>
      <Box sx={{ mt: 3, display: 'flex', alignItems: 'center', gap: 2 }}>
        <Typography variant="h4" fontWeight={700} color={risk.color} fontFamily="Albert Sans, sans-serif">{score}</Typography>
        <Box>
          <Chip label={`${risk.label} Risk`} sx={{ bgcolor: risk.color, color: '#fff', fontWeight: 700 }} />
          <Typography variant="caption" display="block" color="text.secondary" sx={{ mt: 0.5 }}>
            {score >= 7 ? 'Urgent clinical review' : score >= 5 ? 'Urgent response threshold' : score >= 1 ? 'Increase monitoring' : 'Continue routine monitoring'}
          </Typography>
        </Box>
      </Box>
    </Paper>
  );
}

function FallsRiskCalculator() {
  const [vals, setVals] = useState({ age: '', fallHistory: 'no', mobility: 'independent', cognition: 'intact', medication: 'no', continence: 'continent' });
  const set = (k: string, v: string) => setVals(p => ({ ...p, [k]: v }));

  const score = useMemo(() => {
    let s = 0;
    const age = parseInt(vals.age, 10);
    if (!isNaN(age)) { if (age >= 80) s += 3; else if (age >= 65) s += 2; else if (age >= 50) s += 1; }
    if (vals.fallHistory === 'yes') s += 3;
    if (vals.mobility === 'walking-aid') s += 2; else if (vals.mobility === 'immobile') s += 3;
    if (vals.cognition === 'impaired') s += 2; else if (vals.cognition === 'confused') s += 3;
    if (vals.medication === 'yes') s += 2;
    if (vals.continence === 'incontinent') s += 2; else if (vals.continence === 'urgency') s += 1;
    return s;
  }, [vals]);

  const risk = score >= 10 ? { label: 'High', color: '#D32F2F' } : score >= 5 ? { label: 'Medium', color: '#b8621a' } : { label: 'Low', color: '#2E7D32' };

  return (
    <Paper variant="outlined" sx={{ p: 3, maxWidth: 600 }}>
      <Typography variant="subtitle1" fontWeight={700} color="#3D484B" sx={{ mb: 2, fontFamily: 'Albert Sans, sans-serif' }}>Falls Risk Assessment</Typography>
      <Grid container spacing={2}>
        <Grid size={{ xs: 6 }}><TextField label="Age" size="small" fullWidth type="number" value={vals.age} onChange={(e) => set('age', e.target.value)} /></Grid>
        <Grid size={{ xs: 6 }}>
          <FormControl size="small" fullWidth><InputLabel>Fall History</InputLabel>
            <Select label="Fall History" value={vals.fallHistory} onChange={(e) => set('fallHistory', e.target.value)}>
              <MenuItem value="no">No</MenuItem><MenuItem value="yes">Yes (in past 12 months)</MenuItem>
            </Select></FormControl>
        </Grid>
        <Grid size={{ xs: 6 }}>
          <FormControl size="small" fullWidth><InputLabel>Mobility</InputLabel>
            <Select label="Mobility" value={vals.mobility} onChange={(e) => set('mobility', e.target.value)}>
              <MenuItem value="independent">Independent</MenuItem><MenuItem value="walking-aid">Walking Aid</MenuItem><MenuItem value="immobile">Immobile / Bed-bound</MenuItem>
            </Select></FormControl>
        </Grid>
        <Grid size={{ xs: 6 }}>
          <FormControl size="small" fullWidth><InputLabel>Cognition</InputLabel>
            <Select label="Cognition" value={vals.cognition} onChange={(e) => set('cognition', e.target.value)}>
              <MenuItem value="intact">Intact</MenuItem><MenuItem value="impaired">Impaired</MenuItem><MenuItem value="confused">Confused</MenuItem>
            </Select></FormControl>
        </Grid>
        <Grid size={{ xs: 6 }}>
          <FormControl size="small" fullWidth><InputLabel>Sedating Medication</InputLabel>
            <Select label="Sedating Medication" value={vals.medication} onChange={(e) => set('medication', e.target.value)}>
              <MenuItem value="no">No</MenuItem><MenuItem value="yes">Yes</MenuItem>
            </Select></FormControl>
        </Grid>
        <Grid size={{ xs: 6 }}>
          <FormControl size="small" fullWidth><InputLabel>Continence</InputLabel>
            <Select label="Continence" value={vals.continence} onChange={(e) => set('continence', e.target.value)}>
              <MenuItem value="continent">Continent</MenuItem><MenuItem value="urgency">Urgency</MenuItem><MenuItem value="incontinent">Incontinent</MenuItem>
            </Select></FormControl>
        </Grid>
      </Grid>
      <Box sx={{ mt: 3, display: 'flex', alignItems: 'center', gap: 2 }}>
        <Typography variant="h4" fontWeight={700} color={risk.color} fontFamily="Albert Sans, sans-serif">{score}</Typography>
        <Chip label={`${risk.label} Risk`} sx={{ bgcolor: risk.color, color: '#fff', fontWeight: 700 }} />
      </Box>
    </Paper>
  );
}

function FluidBalanceCalculator() {
  const [entries, setEntries] = useState<{ time: string; type: 'intake' | 'output'; amount: string; description: string }[]>([]);
  const addEntry = () => setEntries(p => [...p, { time: new Date().toTimeString().slice(0, 5), type: 'intake', amount: '', description: '' }]);
  const updateEntry = (i: number, k: string, v: string) => setEntries(p => p.map((e, idx) => idx === i ? { ...e, [k]: v } : e));

  const totalIntake = entries.filter(e => e.type === 'intake').reduce((s, e) => s + (parseInt(e.amount, 10) || 0), 0);
  const totalOutput = entries.filter(e => e.type === 'output').reduce((s, e) => s + (parseInt(e.amount, 10) || 0), 0);
  const balance = totalIntake - totalOutput;

  return (
    <Paper variant="outlined" sx={{ p: 3, maxWidth: 700 }}>
      <Typography variant="subtitle1" fontWeight={700} color="#3D484B" sx={{ mb: 2, fontFamily: 'Albert Sans, sans-serif' }}>Fluid Balance Chart</Typography>
      <Box sx={{ display: 'flex', gap: 3, mb: 3 }}>
        <Box><Typography variant="caption" color="text.secondary">Total Intake</Typography><Typography variant="h6" fontWeight={700} color="#327C8D">{totalIntake} ml</Typography></Box>
        <Box><Typography variant="caption" color="text.secondary">Total Output</Typography><Typography variant="h6" fontWeight={700} color="#b8621a">{totalOutput} ml</Typography></Box>
        <Box><Typography variant="caption" color="text.secondary">Balance</Typography>
          <Typography variant="h6" fontWeight={700} color={balance >= 0 ? '#2E7D32' : '#D32F2F'}>{balance >= 0 ? '+' : ''}{balance} ml</Typography></Box>
      </Box>
      {entries.map((e, i) => (
        <Box key={i} sx={{ display: 'flex', gap: 1, mb: 1, alignItems: 'center' }}>
          <TextField size="small" type="time" value={e.time} onChange={(ev) => updateEntry(i, 'time', ev.target.value)} sx={{ width: 100 }} />
          <FormControl size="small" sx={{ width: 100 }}>
            <Select value={e.type} onChange={(ev) => updateEntry(i, 'type', ev.target.value)}>
              <MenuItem value="intake">Intake</MenuItem><MenuItem value="output">Output</MenuItem>
            </Select>
          </FormControl>
          <TextField size="small" type="number" label="ml" value={e.amount} onChange={(ev) => updateEntry(i, 'amount', ev.target.value)} sx={{ width: 80 }} />
          <TextField size="small" label="Description" value={e.description} onChange={(ev) => updateEntry(i, 'description', ev.target.value)} sx={{ flex: 1 }} />
        </Box>
      ))}
      <Button size="small" onClick={addEntry} sx={{ mt: 1, color: '#327C8D', textTransform: 'none' }}>+ Add Entry</Button>
    </Paper>
  );
}

function WoundCareForm() {
  const qc = useQueryClient();
  const [form, setForm] = useState({ site: '', type: '', size: '', depth: '', exudate: '', odour: 'no', surroundingSkin: '', dressing: '', notes: '' });
  const set = (k: string, v: string) => setForm(p => ({ ...p, [k]: v }));

  const saveMut = useMutation({
    mutationFn: (d: typeof form) => apiClient.post('nursing-assessments', { patientId: '', assessmentType: 'wound_care', scores: d, totalScore: 0 }),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: nursingKeys.all }); setForm({ site: '', type: '', size: '', depth: '', exudate: '', odour: 'no', surroundingSkin: '', dressing: '', notes: '' }); },
  });

  return (
    <Paper variant="outlined" sx={{ p: 3, maxWidth: 600 }}>
      <Typography variant="subtitle1" fontWeight={700} color="#3D484B" sx={{ mb: 2, fontFamily: 'Albert Sans, sans-serif' }}>Wound Care Assessment</Typography>
      <Grid container spacing={2}>
        <Grid size={{ xs: 6 }}><TextField label="Wound Site" size="small" fullWidth value={form.site} onChange={(e) => set('site', e.target.value)} /></Grid>
        <Grid size={{ xs: 6 }}>
          <FormControl size="small" fullWidth><InputLabel>Wound Type</InputLabel>
            <Select label="Wound Type" value={form.type} onChange={(e) => set('type', e.target.value)}>
              {['Pressure Injury', 'Surgical', 'Laceration', 'Skin Tear', 'Burn', 'Ulcer', 'Other'].map(t => <MenuItem key={t} value={t}>{t}</MenuItem>)}
            </Select></FormControl>
        </Grid>
        <Grid size={{ xs: 4 }}><TextField label="Size (cm)" size="small" fullWidth value={form.size} onChange={(e) => set('size', e.target.value)} /></Grid>
        <Grid size={{ xs: 4 }}><TextField label="Depth" size="small" fullWidth value={form.depth} onChange={(e) => set('depth', e.target.value)} /></Grid>
        <Grid size={{ xs: 4 }}>
          <FormControl size="small" fullWidth><InputLabel>Exudate</InputLabel>
            <Select label="Exudate" value={form.exudate} onChange={(e) => set('exudate', e.target.value)}>
              {['None', 'Serous', 'Haemoserous', 'Purulent'].map(e => <MenuItem key={e} value={e}>{e}</MenuItem>)}
            </Select></FormControl>
        </Grid>
        <Grid size={{ xs: 6 }}><TextField label="Surrounding Skin" size="small" fullWidth value={form.surroundingSkin} onChange={(e) => set('surroundingSkin', e.target.value)} /></Grid>
        <Grid size={{ xs: 6 }}><TextField label="Dressing Applied" size="small" fullWidth value={form.dressing} onChange={(e) => set('dressing', e.target.value)} /></Grid>
        <Grid size={{ xs: 12 }}><TextField label="Notes" size="small" fullWidth multiline rows={2} value={form.notes} onChange={(e) => set('notes', e.target.value)} /></Grid>
      </Grid>
      {saveMut.isError && <Alert role="alert" severity="error" sx={{ mt: 2 }}>Failed to save wound care assessment</Alert>}
      <Button variant="contained" sx={{ mt: 2, bgcolor: '#327C8D', textTransform: 'none', '&:hover': { bgcolor: '#286A78' } }}
        disabled={saveMut.isPending} onClick={() => saveMut.mutate(form)}>
        {saveMut.isPending ? <CircularProgress role="progressbar" aria-label="Loading" size={20} /> : 'Save Assessment'}
      </Button>
    </Paper>
  );
}

/* ─── Handover ─── */
function HandoverTab() {
  const qc = useQueryClient();
  const [shiftType, setShiftType] = useState<ShiftType>('day');
  const [summary, setSummary] = useState('');
  const [keyIssues, setKeyIssues] = useState<string[]>([]);
  const [newIssue, setNewIssue] = useState('');
  const [autoLoading, setAutoLoading] = useState(false);

  const { data: patientUpdates, isLoading } = useQuery<HandoverUpdatesResponse>({
    queryKey: nursingKeys.handoverUpdates(shiftType),
    queryFn: async (): Promise<HandoverUpdatesResponse> => {
      try {
        return await apiClient.get<HandoverUpdatesResponse>('shift-handovers', { limit: 10 });
      } catch (err) {
        console.warn('NursingPage: query failed', err);
        return [];
      }
    },
  });

  const updates = toHandoverUpdates(patientUpdates);

  const saveMut = useMutation({
    mutationFn: (d: SaveHandoverPayload) => apiClient.post('shift-handovers', d),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: nursingKeys.handoverUpdates(shiftType) }); },
  });

  const handleAutoSummary = async () => {
    setAutoLoading(true);
    try {
      const resp = await apiClient.get<HandoverAutoSummaryResponse>('shift-handovers/auto-summary', { hours: 8 });
      setSummary(resp.summary ?? resp.text ?? '');
      if (Array.isArray(resp.keyIssues)) {
        setKeyIssues(resp.keyIssues.filter((issue): issue is string => typeof issue === 'string'));
      }
    } catch { /* ignore */ }
    setAutoLoading(false);
  };

  const addIssue = () => { if (newIssue.trim()) { setKeyIssues(p => [...p, newIssue.trim()]); setNewIssue(''); } };

  return (
    <Grid container spacing={3}>
      <Grid size={{ xs: 12, md: 7 }}>
        <Paper variant="outlined" sx={{ p: 2.5 }}>
          <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
            <Typography variant="subtitle1" fontWeight={700} color="#3D484B" fontFamily="Albert Sans, sans-serif">
              Shift Handover
            </Typography>
            <FormControl size="small" sx={{ minWidth: 120 }}>
              <Select value={shiftType} onChange={(e) => setShiftType(e.target.value)}>
                <MenuItem value="day">Day Shift</MenuItem>
                <MenuItem value="evening">Evening Shift</MenuItem>
                <MenuItem value="night">Night Shift</MenuItem>
              </Select>
            </FormControl>
          </Box>
          <Button variant="outlined" size="small" onClick={handleAutoSummary} disabled={autoLoading}
            sx={{ mb: 2, borderColor: '#327C8D', color: '#327C8D', textTransform: 'none' }}>
            {autoLoading ? <CircularProgress role="progressbar" aria-label="Loading" size={16} sx={{ mr: 1 }} /> : null}
            Auto-Generate Summary
          </Button>
          <TextField label="Handover Summary" fullWidth multiline rows={8} value={summary}
            onChange={(e) => setSummary(e.target.value)} sx={{ mb: 2 }} />
          <Typography variant="subtitle2" fontWeight={600} color="#3D484B" sx={{ mb: 1 }}>Key Issues</Typography>
          {keyIssues.map((issue, i) => (
            <Chip key={i} label={issue} onDelete={() => setKeyIssues(p => p.filter((_, idx) => idx !== i))}
              sx={{ mr: 0.5, mb: 0.5, bgcolor: '#FFF3E0', color: '#b8621a', fontWeight: 500 }} />
          ))}
          <Box sx={{ display: 'flex', gap: 1, mt: 1, mb: 2 }}>
            <TextField size="small" placeholder="Add key issue..." value={newIssue} sx={{ flex: 1 }}
              onChange={(e) => setNewIssue(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && addIssue()} />
            <Button size="small" variant="outlined" onClick={addIssue} sx={{ textTransform: 'none', borderColor: '#327C8D', color: '#327C8D' }}>Add</Button>
          </Box>
          {saveMut.isError && <Alert role="alert" severity="error">Failed to save handover</Alert>}
          {saveMut.isSuccess && <Alert severity="success" sx={{ mb: 1 }}>Handover saved</Alert>}
          <Button variant="contained" disabled={saveMut.isPending || !summary}
            onClick={() => saveMut.mutate({ shiftType, summary, keyIssues })}
            sx={{ bgcolor: '#327C8D', textTransform: 'none', '&:hover': { bgcolor: '#286A78' } }}>
            {saveMut.isPending ? <CircularProgress role="progressbar" aria-label="Loading" size={20} /> : 'Save Handover'}
          </Button>
        </Paper>
      </Grid>

      <Grid size={{ xs: 12, md: 5 }}>
        <Paper variant="outlined" sx={{ p: 2.5 }}>
          <Typography variant="subtitle1" fontWeight={700} color="#3D484B" sx={{ mb: 2, fontFamily: 'Albert Sans, sans-serif' }}>
            Patient Updates This Shift
          </Typography>
          {isLoading && <CircularProgress role="progressbar" aria-label="Loading" size={24} />}
          {updates.length === 0 && !isLoading && (
            <Typography color="text.secondary" variant="body2" sx={{ py: 2, textAlign: 'center' }}>No updates for this shift</Typography>
          )}
          {updates.map((u: HandoverUpdateRow, i: number) => (
            <Box key={u.id ?? i} sx={{ py: 1.5, borderBottom: '1px solid #eee' }}>
              <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <Typography variant="body2" fontWeight={600} color="#3D484B">{u.patientName ?? u.patientDisplayName ?? 'Patient'}</Typography>
                {u.priority && (
                  <Chip label={u.priority} size="small" sx={{
                    bgcolor: u.priority === 'high' ? '#FDECEA' : u.priority === 'medium' ? '#FFF3E0' : '#E8F5E9',
                    color: u.priority === 'high' ? '#D32F2F' : u.priority === 'medium' ? '#b8621a' : '#2E7D32',
                    fontSize: 10, fontWeight: 600,
                  }} />
                )}
              </Box>
              <Typography variant="caption" color="text.secondary">{u.summary ?? u.notes ?? u.description ?? ''}</Typography>
            </Box>
          ))}
        </Paper>
      </Grid>
    </Grid>
  );
}

/* ─── Phone Triage — Nurse Clinical Review (Tier 1.4) ─── */
// The receptionist logs a call and writes receptionist_summary only. The
// nurse reviews here and records structured clinical_risk_flags via
// PATCH /phone-triage/:id/clinical-triage. Nurse-only fields (suicidality,
// agitation, intoxication, safety concerns) are NEVER editable on the
// receptionist form — this is the only write path for them.

function PhoneTriageReviewTab() {
  const qc = useQueryClient();
  const [statusFilter, setStatusFilter] = useState<'open' | 'closed' | 'all'>('open');
  const [reviewingId, setReviewingId] = useState<string | null>(null);
  const [flags, setFlags] = useState<RiskFlags>({});

  const { data, isLoading, error } = useQuery<PhoneTriageResponse>({
    queryKey: nursingKeys.phoneTriage(statusFilter),
    queryFn: () => apiClient.get<PhoneTriageResponse>('phone-triage', statusFilter === 'all' ? {} : { status: statusFilter }),
  });

  const patchMut = useMutation({
    mutationFn: (d: { id: string; flags: RiskFlags }) =>
      apiClient.patch(`phone-triage/${d.id}/clinical-triage`, { clinicalRiskFlags: d.flags }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: nursingKeys.phoneTriage(statusFilter) });
      setReviewingId(null);
      setFlags({});
    },
  });

  const rows = toPhoneTriageRows(data);
  const active = rows.find((r) => r.id === reviewingId) ?? null;

  const openReview = (row: PhoneTriageRow) => {
    setReviewingId(row.id);
    const raw = row.clinical_risk_flags ?? row.clinicalRiskFlags ?? {};
    setFlags(parseRiskFlags(raw));
  };

  const URGENCY_COLORS: Record<string, string> = { urgent: '#D32F2F', 'semi-urgent': '#b8621a', routine: '#2E7D32' };

  return (
    <Box>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, mb: 2 }}>
        <FormControl size="small" sx={{ minWidth: 160 }}>
          <InputLabel>Status</InputLabel>
          <Select label="Status" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as 'open' | 'closed' | 'all')}>
            <MenuItem value="open">Open</MenuItem>
            <MenuItem value="closed">Closed</MenuItem>
            <MenuItem value="all">All</MenuItem>
          </Select>
        </FormControl>
        <Typography variant="body2" color="text.secondary">
          Review receptionist-logged calls and record clinical risk findings.
        </Typography>
      </Box>

      {isLoading && <CircularProgress role="progressbar" aria-label="Loading" size={24} />}
      {error != null && <Alert severity="error" role="alert" sx={{ mb: 2 }}>Failed to load triage calls.</Alert>}
      {!isLoading && rows.length === 0 && (
        <Typography color="text.secondary" sx={{ py: 4, textAlign: 'center' }}>No triage calls.</Typography>
      )}

      {rows.map((r: PhoneTriageRow) => {
        const rawFlags = r.clinical_risk_flags ?? r.clinicalRiskFlags;
        const parsedFlags = parseRiskFlags(rawFlags);
        const hasFlags = parsedFlags && Object.keys(parsedFlags).length > 0;
        return (
          <Paper key={r.id} variant="outlined" sx={{ display: 'flex', alignItems: 'center', gap: 2, p: 2, mb: 1 }}>
            <Chip label={r.urgency ?? 'routine'} size="small" sx={{
              bgcolor: URGENCY_COLORS[r.urgency ?? 'routine'] ?? '#2E7D32', color: '#fff', fontWeight: 600, minWidth: 72, textTransform: 'capitalize',
            }} />
            <Box sx={{ flex: 1 }}>
              <Typography variant="body2" fontWeight={600} color="#3D484B">{r.caller_name ?? 'Unknown caller'}</Typography>
              <Typography variant="caption" color="text.secondary">
                {r.reason_for_call ?? ''} {r.receptionist_summary ? `— ${r.receptionist_summary}` : ''}
              </Typography>
            </Box>
            <Chip label={hasFlags ? 'Risk recorded' : 'Not reviewed'} size="small" sx={{
              bgcolor: hasFlags ? '#E8F5E9' : '#FFF3E0', color: hasFlags ? '#2E7D32' : '#b8621a', fontWeight: 600,
            }} />
            <Button size="small" variant="outlined" onClick={() => openReview(r)}
              sx={{ textTransform: 'none', borderColor: '#327C8D', color: '#327C8D' }}>
              {hasFlags ? 'Edit Risk' : 'Add Risk'}
            </Button>
          </Paper>
        );
      })}

      <Dialog open={!!reviewingId} onClose={() => setReviewingId(null)} maxWidth="sm" fullWidth>
        <DialogTitle>Clinical Risk Review</DialogTitle>
        <DialogContent>
          {active && (
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, mt: 1 }}>
              <Alert severity="info" sx={{ fontSize: 12 }}>
                Caller: <strong>{active.caller_name}</strong> — {active.reason_for_call}
                {active.receptionist_summary ? <><br />Receptionist summary: {active.receptionist_summary}</> : null}
              </Alert>

              <FormControl size="small" fullWidth>
                <InputLabel>Suicidality</InputLabel>
                <Select label="Suicidality" value={flags.suicidality ?? ''} onChange={(e) => setFlags((f) => ({ ...f, suicidality: e.target.value as RiskFlags['suicidality'] }))}>
                  <MenuItem value="">—</MenuItem>
                  <MenuItem value="none">None</MenuItem>
                  <MenuItem value="ideation">Ideation</MenuItem>
                  <MenuItem value="plan">Plan</MenuItem>
                  <MenuItem value="intent">Intent</MenuItem>
                </Select>
              </FormControl>

              <FormControl size="small" fullWidth>
                <InputLabel>Agitation</InputLabel>
                <Select label="Agitation" value={flags.agitation ?? ''} onChange={(e) => setFlags((f) => ({ ...f, agitation: e.target.value as RiskFlags['agitation'] }))}>
                  <MenuItem value="">—</MenuItem>
                  <MenuItem value="none">None</MenuItem>
                  <MenuItem value="mild">Mild</MenuItem>
                  <MenuItem value="moderate">Moderate</MenuItem>
                  <MenuItem value="severe">Severe</MenuItem>
                </Select>
              </FormControl>

              <FormControlLabel
                control={<Checkbox checked={!!flags.intoxication} onChange={(e) => setFlags((f) => ({ ...f, intoxication: e.target.checked }))} />}
                label="Intoxication suspected"
              />

              <TextField
                label="Safety concern notes" size="small" fullWidth multiline rows={3}
                value={flags.safety_concern_notes ?? ''}
                onChange={(e) => setFlags((f) => ({ ...f, safety_concern_notes: e.target.value }))}
                helperText="Nurse-only — not visible to receptionist staff."
              />

              {patchMut.isError && <Alert severity="error" role="alert">Failed to save risk review.</Alert>}
            </Box>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setReviewingId(null)}>Cancel</Button>
          <Button
            variant="contained"
            disabled={patchMut.isPending || !reviewingId}
            onClick={() => reviewingId && patchMut.mutate({ id: reviewingId, flags })}
            sx={{ bgcolor: '#327C8D', textTransform: 'none', '&:hover': { bgcolor: '#286A78' } }}>
            {patchMut.isPending ? <CircularProgress size={20} role="progressbar" aria-label="Saving" /> : 'Save Risk Review'}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
