import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import NightsStayIcon from '@mui/icons-material/NightsStay';
import { AssessmentsTab as AssessmentsTabEmbed } from './AssessmentsTab';
import { PhysicalHealthTracking } from './PhysicalHealthTab';
import {
    Accordion, AccordionDetails, AccordionSummary,
    Alert, Autocomplete, Box, Button, Chip, CircularProgress, FormControl, Grid, InputLabel, MenuItem,
    Paper, Select, Slider, Tab, Table, TableBody, TableCell, TableContainer, TableHead, TableRow, Tabs, TextField, Typography
} from '@mui/material';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import React, { useEffect, useState } from 'react';
import { apiClient } from '../../../../../shared/services/apiClient';
import { patientsKeys, physicalHealthKeys, inpatientKeys, outcomeMeasuresKeys } from '../../../queryKeys';

const INPATIENT_LOCATIONS = [
  'Ward A', 'Ward B', 'Ward C',
  'High Dependency Unit (HDU)',
  'Psychiatric Intensive Care Unit (PICU)',
  'Acute Inpatient Unit',
  'Rehabilitation Unit',
  'Community Care Unit (CCU)',
  'Prevention and Recovery Centre (PARC)',
  'Emergency Department',
  'Seclusion Room',
  'Leave (on ground leave / off ground leave)',
];

type InpatientSubTab = 'observations' | 'physical_obs' | 'news2' | 'falls' | 'fluid' | 'wound' | 'notes' | 'outcomes' | 'handover';

type JsonRecord = Record<string, unknown>;
type ApiListEnvelope<T> = T[] | { data?: T[] };

interface StructuredObservation {
  id?: string;
  observation_time?: string;
  observation_level?: string;
  location?: string;
  mood?: string;
  behaviour?: string;
  risk_concerns?: string;
  values?: {
    location?: string;
  };
}

interface ShiftHandoverSummary {
  escalatedObservations?: number;
  missedMedications?: number;
  incidents?: number;
  newAdmissions?: number;
  highlights?: string[];
}

interface ShiftHandover {
  id?: string;
  shift_type?: string;
  shift_date?: string;
  status?: string;
  summary_manual?: string;
  content?: unknown;
  staffName?: string;
}

interface NursingAssessmentEntry {
  id?: string;
  totalScore?: number;
  assessmentDatetime?: string;
  score_band?: string;
  assessmentData?: JsonRecord;
  scores?: JsonRecord;
}

interface InpatientNote {
  id?: string;
  noteType?: string;
  note_type?: string;
  title?: string;
  authorName?: string;
  author_name?: string;
  createdAt?: string;
  created_at?: string;
  content?: string;
}

interface OutcomeApiEntry {
  completedAt?: string;
  completed_at?: string;
  createdAt?: string;
  measureType?: string;
  measure_type?: string;
  totalScore?: number;
  total_score?: number;
  occasion?: string;
  notes?: string;
}

interface OutcomeRow {
  date?: string;
  scale?: string;
  score?: number | string;
  occasion?: string;
  notes?: string;
  source: 'outcomes' | 'nursing';
}

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === 'object' && value !== null;
}

function readList<T>(payload: unknown): T[] {
  if (Array.isArray(payload)) {
    return payload as T[];
  }
  if (isRecord(payload) && Array.isArray(payload.data)) {
    return payload.data as T[];
  }
  return [];
}

function readDataObject(payload: unknown): JsonRecord {
  if (isRecord(payload) && isRecord(payload.data)) {
    return payload.data;
  }
  if (isRecord(payload)) {
    return payload;
  }
  return {};
}

const OUTCOME_SCALES_REQUIRING_ITEM_COMPLETENESS = new Set(['honos', 'honos65', 'honosca']);

function buildCompleteScaleItems(
  itemCount: number,
  input: Record<string, number>,
): Record<string, number> {
  const next: Record<string, number> = {};
  for (let i = 1; i <= itemCount; i += 1) {
    const key = String(i);
    next[key] = Number.isFinite(input[key]) ? input[key] : 0;
  }
  return next;
}

function parseJsonRecord(payload: unknown): JsonRecord {
  if (typeof payload === 'string') {
    try {
      const parsed = JSON.parse(payload) as unknown;
      return isRecord(parsed) ? parsed : {};
    } catch {
      return {};
    }
  }
  return isRecord(payload) ? payload : {};
}

function readStringArray(payload: unknown): string[] {
  if (!Array.isArray(payload)) {
    return [];
  }
  return payload.filter((item): item is string => typeof item === 'string');
}

function extractErrorMessage(error: unknown, fallback = 'Unknown error'): string {
  if (!isRecord(error)) {
    return fallback;
  }
  const response = isRecord(error.response) ? error.response : undefined;
  const data = response && isRecord(response.data) ? response.data : undefined;
  const apiError = data && typeof data.error === 'string' ? data.error : undefined;
  const message = typeof error.message === 'string' ? error.message : undefined;
  return apiError ?? message ?? fallback;
}

function toNumber(value: unknown, fallback = 0): number {
  return typeof value === 'number' ? value : fallback;
}

function toStringValue(value: unknown): string | undefined {
  if (typeof value === 'string') {
    return value;
  }
  if (typeof value === 'number') {
    return String(value);
  }
  return undefined;
}

interface InpatientCareTabProps { patientId: string }
export function InpatientCareTab({ patientId }: InpatientCareTabProps): React.ReactElement {
  const [subTab, setSubTab] = useState<InpatientSubTab>('observations');

  return (
    <Box>
      <Tabs aria-label="Navigation tabs" value={subTab} onChange={(_, v) => setSubTab(v)} variant="scrollable" scrollButtons="auto"
        sx={{ mb: 2, '& .MuiTab-root': { textTransform: 'none', fontFamily: 'Albert Sans, sans-serif', fontSize: 13 } }}>
        <Tab label="Observations" value="observations" />
        <Tab label="Physical Observations" value="physical_obs" />
        <Tab label="NEWS2" value="news2" />
        <Tab label="Falls Risk" value="falls" />
        <Tab label="Fluid Balance" value="fluid" />
        <Tab label="Wound Care" value="wound" />
        <Tab label="Notes" value="notes" />
        <Tab label="Outcome Measures" value="outcomes" />
        <Tab label="Shift Handover" value="handover" />
      </Tabs>
      {subTab === 'observations' && <ObservationsPanel patientId={patientId} />}
      {subTab === 'physical_obs' && <PhysicalHealthTracking patientId={patientId} />}
      {subTab === 'news2' && <NEWS2Panel patientId={patientId} />}
      {subTab === 'falls' && <FallsRiskPanel patientId={patientId} />}
      {subTab === 'fluid' && <FluidBalancePanel patientId={patientId} />}
      {subTab === 'wound' && <WoundCarePanel patientId={patientId} />}
      {subTab === 'notes' && <InpatientNotesPanel patientId={patientId} />}
      {subTab === 'outcomes' && <AssessmentsTabEmbed patientId={patientId} />}
      {subTab === 'handover' && <HandoverPanel />}
    </Box>
  );
}

// ── Structured Observations ──────────────────────────────────────────────────
interface ObservationsPanelProps { patientId: string }
function ObservationsPanel({ patientId }: ObservationsPanelProps) {
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({
    queryKey: physicalHealthKeys.structuredObs(patientId),
    queryFn: () => apiClient.get<ApiListEnvelope<StructuredObservation>>('structured-observations', { patientId, limit: 50 }).catch(() => ({ data: [] })),
    enabled: !!patientId,
  });
  const observations = readList<StructuredObservation>(data);

  const [form, setForm] = useState({ level: 'general', location: '', mood: '', behaviour: '', sleep: '', riskConcerns: '' });
  const saveMut = useMutation({
    mutationFn: (d: typeof form) => apiClient.post('structured-observations', {
      patientId, observationType: d.level, values: { location: d.location, sleep: d.sleep },
      mood: d.mood, behaviour: d.behaviour, riskConcerns: d.riskConcerns,
    }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: physicalHealthKeys.structuredObs(patientId) });
      setForm({ level: 'general', location: '', mood: '', behaviour: '', sleep: '', riskConcerns: '' });
    },
    onError: (err: unknown) => alert(`Failed to save observation: ${extractErrorMessage(err)}`),
  });

  return (
    <Box>
      {/* Quick add observation */}
      <Paper variant="outlined" sx={{ p: 2, mb: 3 }}>
        <Typography variant="subtitle2" fontWeight={700} sx={{ mb: 1.5 }}>Record Observation</Typography>
        <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap', mb: 1.5 }}>
          {['general', '15min', '30min', 'hourly', 'constant'].map(level => (
            <Chip key={level} label={level} size="small" onClick={() => setForm(p => ({ ...p, level }))}
              variant={form.level === level ? 'filled' : 'outlined'}
              sx={{ textTransform: 'capitalize', cursor: 'pointer', ...(form.level === level ? { bgcolor: '#327C8D', color: '#fff' } : {}) }} />
          ))}
        </Box>
        <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 1.5, mb: 1.5 }}>
          <Autocomplete
            freeSolo
            size="small"
            options={INPATIENT_LOCATIONS}
            value={form.location}
            onChange={(_e, val) => setForm(p => ({ ...p, location: val ?? '' }))}
            onInputChange={(_e, val) => setForm(p => ({ ...p, location: val }))}
            renderInput={(params) => <TextField {...params} label="Location" />}
          />
          <TextField size="small" label="Mood" value={form.mood} onChange={e => setForm(p => ({ ...p, mood: e.target.value }))} />
          <TextField size="small" label="Behaviour" value={form.behaviour} onChange={e => setForm(p => ({ ...p, behaviour: e.target.value }))} />
        </Box>
        <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 1.5, mb: 1.5 }}>
          <TextField size="small" label="Sleep Status" value={form.sleep} onChange={e => setForm(p => ({ ...p, sleep: e.target.value }))} />
          <TextField size="small" label="Risk Concerns" value={form.riskConcerns} onChange={e => setForm(p => ({ ...p, riskConcerns: e.target.value }))} />
        </Box>
        <Button variant="contained" size="small" onClick={() => saveMut.mutate(form)} disabled={saveMut.isPending}
          sx={{ bgcolor: '#327C8D', '&:hover': { bgcolor: '#265f6d' }, textTransform: 'none' }}>
          {saveMut.isPending ? 'Saving...' : 'Save Observation'}
        </Button>
      </Paper>

      {/* Observation history */}
      {isLoading && <CircularProgress role="progressbar" aria-label="Loading" size={24} sx={{ display: 'block', mx: 'auto' }} />}
      {observations.length === 0 && !isLoading && (
        <Typography variant="body2" color="text.secondary" sx={{ textAlign: 'center', py: 3 }}>No observations recorded</Typography>
      )}
      {observations.length > 0 && (
        <TableContainer role="region" aria-label="Data table">
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell sx={{ fontWeight: 700, fontSize: 11 }}>Time</TableCell>
                <TableCell sx={{ fontWeight: 700, fontSize: 11 }}>Level</TableCell>
                <TableCell sx={{ fontWeight: 700, fontSize: 11 }}>Location</TableCell>
                <TableCell sx={{ fontWeight: 700, fontSize: 11 }}>Mood</TableCell>
                <TableCell sx={{ fontWeight: 700, fontSize: 11 }}>Behaviour</TableCell>
                <TableCell sx={{ fontWeight: 700, fontSize: 11 }}>Risk</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {observations.map((o, i) => (
                <TableRow key={o.id ?? i}>
                  <TableCell sx={{ fontSize: 11 }}>{o.observation_time ? new Date(o.observation_time).toLocaleString('en-AU', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—'}</TableCell>
                  <TableCell sx={{ fontSize: 11 }}>
                    <Chip label={o.observation_level ?? 'general'} size="small" sx={{ fontSize: 9, height: 18, textTransform: 'capitalize' }} />
                  </TableCell>
                  <TableCell sx={{ fontSize: 11 }}>{o.location ?? o.values?.location ?? '—'}</TableCell>
                  <TableCell sx={{ fontSize: 11 }}>{o.mood ?? '—'}</TableCell>
                  <TableCell sx={{ fontSize: 11 }}>{o.behaviour ?? '—'}</TableCell>
                  <TableCell sx={{ fontSize: 11 }}>
                    {o.risk_concerns ? <Chip label={o.risk_concerns} size="small" sx={{ fontSize: 9, height: 18, bgcolor: '#FDECEA', color: '#D32F2F' }} /> : '—'}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>
      )}
    </Box>
  );
}

// ── Shift Handover ───────────────────────────────────────────────────────────
function HandoverPanel() {
  const [expandedHandoverId, setExpandedHandoverId] = useState<string | null>(null);
  const { data: summaryData, isLoading } = useQuery({
    queryKey: inpatientKeys.shiftHandoverAuto(),
    queryFn: () => apiClient.get<{ data?: ShiftHandoverSummary }>('shift-handovers/auto-summary', { hours: 8 }).catch(() => ({ data: {} })),
  });
  const { data: handovers } = useQuery({
    queryKey: inpatientKeys.shiftHandovers(),
    queryFn: () => apiClient.get<ApiListEnvelope<ShiftHandover>>('shift-handovers', { limit: 10 }).catch(() => ({ data: [] })),
  });
  const summary = readDataObject(summaryData);
  const highlights = readStringArray(summary.highlights);
  const history = readList<ShiftHandover>(handovers);

  return (
    <Box>
      {/* Auto-summary */}
      <Paper variant="outlined" sx={{ p: 2, mb: 3, borderLeft: '4px solid #7B1FA2' }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1.5 }}>
          <NightsStayIcon sx={{ color: '#7B1FA2', fontSize: 20 }} />
          <Typography variant="subtitle2" fontWeight={700}>Shift Summary (Last 8 Hours)</Typography>
        </Box>
        {isLoading ? <CircularProgress role="progressbar" aria-label="Loading" size={20} /> : (
          <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 2 }}>
            <SummaryStat label="Escalated Obs" value={typeof summary.escalatedObservations === 'number' ? summary.escalatedObservations : 0} color={typeof summary.escalatedObservations === 'number' && summary.escalatedObservations > 0 ? '#D32F2F' : '#2E7D32'} />
            <SummaryStat label="Missed Meds" value={typeof summary.missedMedications === 'number' ? summary.missedMedications : 0} color={typeof summary.missedMedications === 'number' && summary.missedMedications > 0 ? '#b8621a' : '#2E7D32'} />
            <SummaryStat label="Incidents" value={typeof summary.incidents === 'number' ? summary.incidents : 0} color={typeof summary.incidents === 'number' && summary.incidents > 0 ? '#D32F2F' : '#2E7D32'} />
            <SummaryStat label="New Admissions" value={typeof summary.newAdmissions === 'number' ? summary.newAdmissions : 0} color="#327C8D" />
          </Box>
        )}
        {highlights.length > 0 && (
          <Box sx={{ mt: 1.5, pt: 1.5, borderTop: '1px solid #eee' }}>
            {highlights.map((h, i) => (
              <Typography key={i} variant="caption" color="text.secondary" sx={{ display: 'block', fontSize: 11 }}>* {h}</Typography>
            ))}
          </Box>
        )}
      </Paper>

      {/* Previous handovers */}
      <Typography variant="subtitle2" fontWeight={700} sx={{ mb: 1 }}>Previous Handovers</Typography>
      {history.length === 0 && <Typography variant="body2" color="text.secondary" sx={{ py: 2, textAlign: 'center' }}>No handovers recorded</Typography>}
      {history.map((h, i) => {
        const hExpanded = expandedHandoverId === (h.id ?? `h-${i}`);
        const content = parseJsonRecord(h.content);
        return (
          <Paper key={h.id ?? i} variant="outlined"
            role="button"
            tabIndex={0}
            aria-expanded={hExpanded}
            aria-label={`${h.shift_type ?? 'Shift'} handover ${h.shift_date ?? ''} — ${hExpanded ? 'collapse' : 'expand'}`}
            onClick={() => setExpandedHandoverId(hExpanded ? null : (h.id ?? `h-${i}`))}
            onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setExpandedHandoverId(hExpanded ? null : (h.id ?? `h-${i}`)); } }}
            sx={{ p: 2, mb: 1, cursor: 'pointer', '&:hover': { bgcolor: '#FAFAFA' }, '&:focus-visible': { outline: '2px solid #327C8D', outlineOffset: 2 } }}>
            <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 0.5 }}>
              <Typography variant="body2" fontWeight={600} sx={{ fontSize: 12 }}>{h.shift_type ?? 'Shift'} — {h.shift_date ?? ''}</Typography>
              <Chip label={h.status ?? 'pending'} size="small" sx={{ fontSize: 9, height: 18, textTransform: 'capitalize' }} />
            </Box>
            {!hExpanded && h.summary_manual && <Typography variant="body2" color="text.secondary" noWrap sx={{ fontSize: 11 }}>{h.summary_manual}</Typography>}
            {hExpanded && (
              <Box sx={{ mt: 1 }}>
                {h.summary_manual && <Typography variant="body2" sx={{ fontSize: 11, whiteSpace: 'pre-wrap', mb: 1 }}>{h.summary_manual}</Typography>}
                {typeof content.incidents === 'string' && <Typography variant="caption" display="block"><strong>Incidents:</strong> {content.incidents}</Typography>}
                {typeof content.escalations === 'string' && <Typography variant="caption" display="block"><strong>Escalations:</strong> {content.escalations}</Typography>}
                {typeof content.medications === 'string' && <Typography variant="caption" display="block"><strong>Medications:</strong> {content.medications}</Typography>}
                {typeof content.observations === 'string' && <Typography variant="caption" display="block"><strong>Observations:</strong> {content.observations}</Typography>}
                {h.staffName && <Typography variant="caption" color="text.disabled" display="block" sx={{ mt: 0.5 }}>By: {h.staffName}</Typography>}
              </Box>
            )}
          </Paper>
        );
      })}
    </Box>
  );
}

interface SummaryStatProps { label: string; value: number; color: string }
function SummaryStat({ label, value, color }: SummaryStatProps) {
  return (
    <Box sx={{ textAlign: 'center' }}>
      <Typography variant="h6" fontWeight={800} sx={{ color, lineHeight: 1 }}>{value}</Typography>
      <Typography variant="caption" color="text.secondary" sx={{ fontSize: '0.6rem' }}>{label}</Typography>
    </Box>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
//  NEWS2 (National Early Warning Score 2)
// ══════════════════════════════════════════════════════════════════════════════
function calcNEWS2Score(vals: Record<string, number>): { total: number; band: string; color: string } {
  let total = 0;
  // Simplified NEWS2 scoring
  const rr = vals.respRate ?? 0;
  if (rr >= 25) total += 3; else if (rr >= 21) total += 2; else if (rr >= 12) total += 0; else if (rr >= 9) total += 1; else total += 3;
  const spo2 = vals.spo2 ?? 100;
  if (spo2 >= 96) total += 0; else if (spo2 >= 94) total += 1; else if (spo2 >= 92) total += 2; else total += 3;
  const sys = vals.systolic ?? 120;
  if (sys >= 220) total += 3; else if (sys >= 111) total += 0; else if (sys >= 101) total += 1; else if (sys >= 91) total += 2; else total += 3;
  const hr = vals.pulse ?? 70;
  if (hr >= 131) total += 3; else if (hr >= 111) total += 2; else if (hr >= 91) total += 1; else if (hr >= 51) total += 0; else if (hr >= 41) total += 1; else total += 3;
  if (vals.consciousness > 0) total += 3; // CVPU: C=0, V/P/U=3
  const temp = vals.temp ?? 37;
  if (temp >= 39.1) total += 2; else if (temp >= 38.1) total += 1; else if (temp >= 36.1) total += 0; else if (temp >= 35.1) total += 1; else total += 3;

  const band = total >= 7 ? 'High' : total >= 5 ? 'Medium' : total >= 1 ? 'Low' : 'None';
  const color = total >= 7 ? '#D32F2F' : total >= 5 ? '#b8621a' : total >= 1 ? '#327C8D' : '#2E7D32';
  return { total, band, color };
}

interface NEWS2PanelProps { patientId: string }
function NEWS2Panel({ patientId }: NEWS2PanelProps) {
  const qc = useQueryClient();
  const [vals, setVals] = useState<Record<string, number>>({
    respRate: 16, spo2: 97, systolic: 120, pulse: 72, consciousness: 0, temp: 36.8,
  });
  const score = calcNEWS2Score(vals);

  const saveMut = useMutation({
    mutationFn: () => apiClient.post('nursing-assessments', {
      patientId, assessmentType: 'news2',
      scores: vals, totalScore: score.total, riskLevel: score.band,
    }),
    onSuccess: () => qc.invalidateQueries({ queryKey: physicalHealthKeys.nursingAssessments(patientId) }),
    onError: (err: unknown) => alert(`Failed to save NEWS2: ${extractErrorMessage(err)}`),
  });

  const { data: history } = useQuery({
    queryKey: physicalHealthKeys.nursingAssessmentsNews2(patientId),
    queryFn: () => apiClient.get<ApiListEnvelope<NursingAssessmentEntry>>('nursing-assessments', { patientId, assessmentType: 'news2', limit: 10 }).catch(() => ({ data: [] })),
  });
  const pastScores = readList<NursingAssessmentEntry>(history);

  return (
    <Box>
      <Paper variant="outlined" sx={{ p: 2.5, mb: 3, borderLeft: `4px solid ${score.color}` }}>
        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
          <Typography variant="subtitle2" fontWeight={700}>NEWS2 Assessment</Typography>
          <Box sx={{ textAlign: 'center' }}>
            <Typography variant="h4" fontWeight={800} sx={{ color: score.color, lineHeight: 1 }}>{score.total}</Typography>
            <Chip label={score.band} size="small" sx={{ bgcolor: score.color, color: '#fff', fontWeight: 700, fontSize: 10, mt: 0.5 }} />
          </Box>
        </Box>
        <Grid container spacing={2}>
          {[
            { key: 'respRate', label: 'Resp Rate (/min)', min: 0, max: 40, step: 1 },
            { key: 'spo2', label: 'SpO2 (%)', min: 80, max: 100, step: 1 },
            { key: 'systolic', label: 'Systolic BP (mmHg)', min: 60, max: 250, step: 5 },
            { key: 'pulse', label: 'Pulse (bpm)', min: 30, max: 180, step: 1 },
            { key: 'temp', label: 'Temp (°C)', min: 33, max: 42, step: 0.1 },
          ].map(p => (
            <Grid key={p.key} size={{ xs: 12, sm: 6 }}>
              <Typography variant="caption" fontWeight={600} sx={{ fontSize: 11 }}>{p.label}: {vals[p.key] ?? 0}</Typography>
              <Slider size="small" min={p.min} max={p.max} step={p.step} value={vals[p.key] ?? 0}
                onChange={(_, v) => setVals(prev => ({ ...prev, [p.key]: v as number }))}
                sx={{ color: score.color }} />
            </Grid>
          ))}
          <Grid size={{ xs: 12, sm: 6 }}>
            <Typography variant="caption" fontWeight={600} sx={{ fontSize: 11 }}>Consciousness (CVPU)</Typography>
            <Box sx={{ display: 'flex', gap: 0.5, mt: 0.5 }}>
              {[{ l: 'Alert', v: 0 }, { l: 'Voice', v: 3 }, { l: 'Pain', v: 3 }, { l: 'Unresponsive', v: 3 }].map(c => (
                <Chip key={c.l} label={c.l} size="small" onClick={() => setVals(p => ({ ...p, consciousness: c.v }))}
                  sx={{ cursor: 'pointer', fontWeight: 600, fontSize: 10,
                    bgcolor: vals.consciousness === c.v && c.l === 'Alert' ? '#2E7D32' : vals.consciousness === c.v ? '#D32F2F' : '#eee',
                    color: vals.consciousness === c.v ? '#fff' : '#555',
                  }} />
              ))}
            </Box>
          </Grid>
        </Grid>
        <Box sx={{ mt: 2, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          {score.total >= 5 && (
            <Alert role="alert" severity="error" sx={{ flex: 1, mr: 2, fontSize: 11 }}>
              <strong>Escalation required.</strong> {score.total >= 7 ? 'Urgent clinical review — continuous monitoring.' : 'Increase monitoring frequency.'}
            </Alert>
          )}
          <Button variant="contained" size="small" onClick={() => saveMut.mutate()} disabled={saveMut.isPending}
            sx={{ bgcolor: score.color, textTransform: 'none', '&:hover': { opacity: 0.85 } }}>
            {saveMut.isPending ? 'Saving...' : 'Save Assessment'}
          </Button>
        </Box>
      </Paper>

      {/* History — expandable detail views */}
      {pastScores.length > 0 && (
        <Paper variant="outlined" sx={{ p: 2 }}>
          <Typography variant="subtitle2" fontWeight={700} sx={{ mb: 1 }}>Recent NEWS2 Scores</Typography>
          {pastScores.map((s, i) => {
            const t = s.totalScore ?? 0;
            const c = t >= 7 ? '#D32F2F' : t >= 5 ? '#b8621a' : t >= 1 ? '#327C8D' : '#2E7D32';
            const band = t >= 7 ? 'High' : t >= 5 ? 'Medium' : t >= 1 ? 'Low' : 'None';
            const scoreData = s.assessmentData ?? s.scores ?? {};
            const scores: Record<string, number> = {
              respRate: toNumber(scoreData.respRate),
              spo2: toNumber(scoreData.spo2, 100),
              systolic: toNumber(scoreData.systolic, 120),
              pulse: toNumber(scoreData.pulse, 70),
              consciousness: toNumber(scoreData.consciousness),
              temp: toNumber(scoreData.temp, 37),
            };
            const supplementalO2 = scoreData.supplementalO2 === true;
            const consciousnessLabel = scores.consciousness > 0 ? 'V/P/U' : 'Alert';
            const paramScores = calcNEWS2Score(scores);
            return (
              <Accordion key={s.id ?? i} disableGutters elevation={0}
                sx={{ border: '1px solid #eee', mb: 0.5, '&:before': { display: 'none' }, borderLeft: `3px solid ${c}` }}>
                <AccordionSummary expandIcon={<ExpandMoreIcon />} sx={{ minHeight: 36, '& .MuiAccordionSummary-content': { my: 0.5, alignItems: 'center', gap: 1 } }}>
                  <Chip label={t} size="small" sx={{ bgcolor: c, color: '#fff', fontWeight: 700, fontSize: 11, minWidth: 28 }} />
                  <Chip label={band} size="small" variant="outlined" sx={{ fontSize: 10, height: 20, borderColor: c, color: c }} />
                  <Typography variant="caption" color="text.secondary" sx={{ ml: 'auto', mr: 1, fontSize: 11 }}>
                    {s.assessmentDatetime ? new Date(s.assessmentDatetime).toLocaleString('en-AU', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : ''}
                  </Typography>
                </AccordionSummary>
                <AccordionDetails sx={{ pt: 0, pb: 1.5, px: 2 }}>
                  <Table size="small">
                    <TableHead>
                      <TableRow>
                        <TableCell sx={{ fontWeight: 700, fontSize: 10, py: 0.5 }}>Parameter</TableCell>
                        <TableCell sx={{ fontWeight: 700, fontSize: 10, py: 0.5 }}>Value</TableCell>
                        <TableCell sx={{ fontWeight: 700, fontSize: 10, py: 0.5 }}>Score</TableCell>
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {[
                        { label: 'Respiratory Rate', value: scores.respRate != null ? `${scores.respRate} /min` : '—', key: 'respRate' },
                        { label: 'SpO2', value: scores.spo2 != null ? `${scores.spo2}%` : '—', key: 'spo2' },
                        { label: 'Supplemental O2', value: supplementalO2 ? 'Yes (+2)' : 'No', key: 'supplementalO2' },
                        { label: 'Temperature', value: scores.temp != null ? `${scores.temp} °C` : '—', key: 'temp' },
                        { label: 'Systolic BP', value: scores.systolic != null ? `${scores.systolic} mmHg` : '—', key: 'systolic' },
                        { label: 'Heart Rate', value: scores.pulse != null ? `${scores.pulse} bpm` : '—', key: 'pulse' },
                        { label: 'Consciousness', value: consciousnessLabel, key: 'consciousness' },
                      ].map(row => {
                        // Calculate individual score contribution
                        let itemScore = 0;
                        if (row.key === 'respRate') { const v = scores.respRate ?? 0; if (v >= 25) itemScore = 3; else if (v >= 21) itemScore = 2; else if (v >= 12) itemScore = 0; else if (v >= 9) itemScore = 1; else itemScore = 3; }
                        else if (row.key === 'spo2') { const v = scores.spo2 ?? 100; if (v >= 96) itemScore = 0; else if (v >= 94) itemScore = 1; else if (v >= 92) itemScore = 2; else itemScore = 3; }
                        else if (row.key === 'supplementalO2') { itemScore = supplementalO2 ? 2 : 0; }
                        else if (row.key === 'temp') { const v = scores.temp ?? 37; if (v >= 39.1) itemScore = 2; else if (v >= 38.1) itemScore = 1; else if (v >= 36.1) itemScore = 0; else if (v >= 35.1) itemScore = 1; else itemScore = 3; }
                        else if (row.key === 'systolic') { const v = scores.systolic ?? 120; if (v >= 220) itemScore = 3; else if (v >= 111) itemScore = 0; else if (v >= 101) itemScore = 1; else if (v >= 91) itemScore = 2; else itemScore = 3; }
                        else if (row.key === 'pulse') { const v = scores.pulse ?? 70; if (v >= 131) itemScore = 3; else if (v >= 111) itemScore = 2; else if (v >= 91) itemScore = 1; else if (v >= 51) itemScore = 0; else if (v >= 41) itemScore = 1; else itemScore = 3; }
                        else if (row.key === 'consciousness') { itemScore = (scores.consciousness ?? 0) > 0 ? 3 : 0; }
                        const sc = itemScore > 0 ? (itemScore >= 3 ? '#D32F2F' : itemScore >= 2 ? '#b8621a' : '#327C8D') : '#2E7D32';
                        return (
                          <TableRow key={row.key}>
                            <TableCell sx={{ fontSize: 11, py: 0.4 }}>{row.label}</TableCell>
                            <TableCell sx={{ fontSize: 11, py: 0.4 }}>{row.value}</TableCell>
                            <TableCell sx={{ fontSize: 11, py: 0.4, fontWeight: 700, color: sc }}>{itemScore}</TableCell>
                          </TableRow>
                        );
                      })}
                      <TableRow>
                        <TableCell colSpan={2} sx={{ fontSize: 11, py: 0.5, fontWeight: 700 }}>Total NEWS2 Score</TableCell>
                        <TableCell sx={{ fontSize: 13, py: 0.5, fontWeight: 800, color: c }}>{paramScores.total}</TableCell>
                      </TableRow>
                    </TableBody>
                  </Table>
                </AccordionDetails>
              </Accordion>
            );
          })}
        </Paper>
      )}
    </Box>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
//  Falls Risk Assessment
// ══════════════════════════════════════════════════════════════════════════════
const FALLS_ITEMS = [
  { key: 'age', label: 'Age 65+', score: 1 },
  { key: 'fallHistory', label: 'History of falls (last 12 months)', score: 2 },
  { key: 'incontinence', label: 'Incontinence (urinary/faecal)', score: 1 },
  { key: 'visualImpairment', label: 'Visual impairment', score: 1 },
  { key: 'mobilityAid', label: 'Uses mobility aid', score: 1 },
  { key: 'sedation', label: 'Sedating medications', score: 2 },
  { key: 'confusion', label: 'Confusion / cognitive impairment', score: 2 },
  { key: 'postural', label: 'Postural hypotension', score: 1 },
  { key: 'unsafe', label: 'Unsafe footwear/environment', score: 1 },
];

interface FallsRiskPanelProps { patientId: string }
function FallsRiskPanel({ patientId }: FallsRiskPanelProps) {
  const qc = useQueryClient();
  const [checked, setChecked] = useState<Record<string, boolean>>({});
  const total = FALLS_ITEMS.reduce((acc, item) => acc + (checked[item.key] ? item.score : 0), 0);
  const risk = total >= 6 ? 'High' : total >= 3 ? 'Medium' : 'Low';
  const color = total >= 6 ? '#D32F2F' : total >= 3 ? '#b8621a' : '#2E7D32';

  const saveMut = useMutation({
    mutationFn: () => apiClient.post('nursing-assessments', {
      patientId, assessmentType: 'falls_risk',
      scores: checked, totalScore: total, riskLevel: risk,
    }),
    onSuccess: () => qc.invalidateQueries({ queryKey: physicalHealthKeys.nursingAssessments(patientId) }),
    onError: (err: unknown) => alert(`Failed to save falls risk: ${extractErrorMessage(err)}`),
  });

  const { data: historyData } = useQuery({
    queryKey: physicalHealthKeys.nursingAssessmentsFallsRisk(patientId),
    queryFn: () => apiClient.get<ApiListEnvelope<NursingAssessmentEntry>>('nursing-assessments', { patientId, assessmentType: 'falls_risk', limit: 10 }).catch(() => ({ data: [] })),
  });
  const pastFalls = readList<NursingAssessmentEntry>(historyData);

  return (
    <Box>
      <Paper variant="outlined" sx={{ p: 2.5, borderLeft: `4px solid ${color}`, mb: 3 }}>
        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
          <Typography variant="subtitle2" fontWeight={700}>Falls Risk Assessment</Typography>
          <Box sx={{ textAlign: 'center' }}>
            <Typography variant="h4" fontWeight={800} sx={{ color, lineHeight: 1 }}>{total}</Typography>
            <Chip label={`${risk} Risk`} size="small" sx={{ bgcolor: color, color: '#fff', fontWeight: 700, fontSize: 10, mt: 0.5 }} />
          </Box>
        </Box>
        {FALLS_ITEMS.map(item => (
          <Box key={item.key}
            role="button"
            tabIndex={0}
            aria-pressed={!!checked[item.key]}
            aria-label={`${item.label} (${item.score} points) — ${checked[item.key] ? 'remove' : 'select'}`}
            onClick={() => setChecked(p => ({ ...p, [item.key]: !p[item.key] }))}
            onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setChecked(p => ({ ...p, [item.key]: !p[item.key] })); } }}
            sx={{ display: 'flex', alignItems: 'center', gap: 1, py: 0.75, borderBottom: '1px solid #eee', cursor: 'pointer', '&:focus-visible': { outline: `2px solid ${color}`, outlineOffset: -2 } }}>
            <Box sx={{ width: 20, height: 20, borderRadius: 0.5, border: '2px solid', borderColor: checked[item.key] ? color : '#ccc',
              bgcolor: checked[item.key] ? color : 'transparent', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontSize: 12, fontWeight: 700 }}>
              {checked[item.key] ? '✓' : ''}
            </Box>
            <Typography variant="body2" sx={{ flex: 1, fontSize: 12 }}>{item.label}</Typography>
            <Typography variant="caption" fontWeight={700} color={checked[item.key] ? color : 'text.disabled'}>+{item.score}</Typography>
          </Box>
        ))}
        <Box sx={{ mt: 2, display: 'flex', justifyContent: 'flex-end' }}>
          <Button variant="contained" size="small" onClick={() => saveMut.mutate()} disabled={saveMut.isPending}
            sx={{ bgcolor: color, textTransform: 'none' }}>
            {saveMut.isPending ? 'Saving...' : 'Save Assessment'}
          </Button>
        </Box>
      </Paper>

      {/* Falls Risk History — expandable detail views */}
      {pastFalls.length > 0 && (
        <Paper variant="outlined" sx={{ p: 2 }}>
          <Typography variant="subtitle2" fontWeight={700} sx={{ mb: 1 }}>Previous Falls Risk Assessments</Typography>
          {pastFalls.map((entry, i) => {
            const t = entry.totalScore ?? 0;
            const r = t >= 6 ? 'High' : t >= 3 ? 'Medium' : 'Low';
            const c = t >= 6 ? '#D32F2F' : t >= 3 ? '#b8621a' : '#2E7D32';
            const scores = entry.assessmentData ?? entry.scores ?? {};
            return (
              <Accordion key={entry.id ?? i} disableGutters elevation={0}
                sx={{ border: '1px solid #eee', mb: 0.5, '&:before': { display: 'none' }, borderLeft: `3px solid ${c}` }}>
                <AccordionSummary expandIcon={<ExpandMoreIcon />} sx={{ minHeight: 36, '& .MuiAccordionSummary-content': { my: 0.5, alignItems: 'center', gap: 1 } }}>
                  <Chip label={t} size="small" sx={{ bgcolor: c, color: '#fff', fontWeight: 700, fontSize: 11, minWidth: 28 }} />
                  <Chip label={`${r} Risk`} size="small" variant="outlined" sx={{ fontSize: 10, height: 20, borderColor: c, color: c }} />
                  <Typography variant="caption" color="text.secondary" sx={{ ml: 'auto', mr: 1, fontSize: 11 }}>
                    {entry.assessmentDatetime ? new Date(entry.assessmentDatetime).toLocaleString('en-AU', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : ''}
                  </Typography>
                </AccordionSummary>
                <AccordionDetails sx={{ pt: 0, pb: 1.5, px: 2 }}>
                  <Table size="small">
                    <TableHead>
                      <TableRow>
                        <TableCell sx={{ fontWeight: 700, fontSize: 10, py: 0.5 }}>Risk Factor</TableCell>
                        <TableCell sx={{ fontWeight: 700, fontSize: 10, py: 0.5, textAlign: 'center' }}>Present</TableCell>
                        <TableCell sx={{ fontWeight: 700, fontSize: 10, py: 0.5, textAlign: 'center' }}>Score</TableCell>
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {FALLS_ITEMS.map(item => {
                        const present = !!scores[item.key];
                        return (
                          <TableRow key={item.key}>
                            <TableCell sx={{ fontSize: 11, py: 0.4 }}>{item.label}</TableCell>
                            <TableCell sx={{ fontSize: 11, py: 0.4, textAlign: 'center' }}>
                              <Chip label={present ? 'Yes' : 'No'} size="small"
                                sx={{ fontSize: 9, height: 18, bgcolor: present ? '#FDECEA' : '#E8F5E9', color: present ? '#D32F2F' : '#2E7D32' }} />
                            </TableCell>
                            <TableCell sx={{ fontSize: 11, py: 0.4, textAlign: 'center', fontWeight: 700, color: present ? c : 'text.disabled' }}>
                              {present ? `+${item.score}` : '0'}
                            </TableCell>
                          </TableRow>
                        );
                      })}
                      <TableRow>
                        <TableCell colSpan={2} sx={{ fontSize: 11, py: 0.5, fontWeight: 700 }}>Total Score</TableCell>
                        <TableCell sx={{ fontSize: 13, py: 0.5, fontWeight: 800, color: c, textAlign: 'center' }}>{t}</TableCell>
                      </TableRow>
                    </TableBody>
                  </Table>
                </AccordionDetails>
              </Accordion>
            );
          })}
        </Paper>
      )}
    </Box>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
//  Fluid Balance Chart
// ══════════════════════════════════════════════════════════════════════════════
interface FluidBalancePanelProps { patientId: string }
function FluidBalancePanel({ patientId }: FluidBalancePanelProps) {
  const qc = useQueryClient();
  const [intake, setIntake] = useState({ oral: '', iv: '', other: '' });
  const [output, setOutput] = useState({ urine: '', vomit: '', drain: '', other: '' });

  const totalIn = (parseFloat(intake.oral) || 0) + (parseFloat(intake.iv) || 0) + (parseFloat(intake.other) || 0);
  const totalOut = (parseFloat(output.urine) || 0) + (parseFloat(output.vomit) || 0) + (parseFloat(output.drain) || 0) + (parseFloat(output.other) || 0);
  const balance = totalIn - totalOut;
  const balanceColor = Math.abs(balance) > 1000 ? '#D32F2F' : Math.abs(balance) > 500 ? '#b8621a' : '#2E7D32';

  const saveMut = useMutation({
    mutationFn: () => apiClient.post('nursing-assessments', {
      patientId, assessmentType: 'fluid_balance',
      scores: {
        intake: { oral: parseFloat(intake.oral) || 0, iv: parseFloat(intake.iv) || 0, other: parseFloat(intake.other) || 0 },
        output: { urine: parseFloat(output.urine) || 0, vomit: parseFloat(output.vomit) || 0, drain: parseFloat(output.drain) || 0, other: parseFloat(output.other) || 0 },
        totalIn, totalOut, balance,
      },
      totalScore: balance,
    }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: physicalHealthKeys.nursingAssessments(patientId) });
      setIntake({ oral: '', iv: '', other: '' });
      setOutput({ urine: '', vomit: '', drain: '', other: '' });
    },
    onError: (err: unknown) => alert(`Failed to save fluid balance: ${extractErrorMessage(err)}`),
  });

  const { data: historyData } = useQuery({
    queryKey: physicalHealthKeys.nursingAssessmentsFluidBalance(patientId),
    queryFn: () => apiClient.get<ApiListEnvelope<NursingAssessmentEntry>>('nursing-assessments', { patientId, assessmentType: 'fluid_balance', limit: 20 }).catch(() => ({ data: [] })),
  });
  const pastEntries = readList<NursingAssessmentEntry>(historyData);

  return (
    <Box>
      <Paper variant="outlined" sx={{ p: 2.5, mb: 3 }}>
        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
          <Typography variant="subtitle2" fontWeight={700}>Fluid Balance (24-hour period)</Typography>
          <Box sx={{ textAlign: 'center' }}>
            <Typography variant="h5" fontWeight={800} sx={{ color: balanceColor, lineHeight: 1 }}>
              {balance >= 0 ? '+' : ''}{balance} mL
            </Typography>
            <Typography variant="caption" color="text.secondary">Net Balance</Typography>
          </Box>
        </Box>
        <Grid container spacing={3}>
          <Grid size={{ xs: 12, sm: 6 }}>
            <Typography variant="caption" fontWeight={700} color="#2E7D32" sx={{ mb: 1, display: 'block' }}>INTAKE (mL)</Typography>
            <TextField label="Oral" size="small" fullWidth type="number" value={intake.oral}
              onChange={e => setIntake(p => ({ ...p, oral: e.target.value }))} sx={{ mb: 1 }} />
            <TextField label="IV Fluids" size="small" fullWidth type="number" value={intake.iv}
              onChange={e => setIntake(p => ({ ...p, iv: e.target.value }))} sx={{ mb: 1 }} />
            <TextField label="Other" size="small" fullWidth type="number" value={intake.other}
              onChange={e => setIntake(p => ({ ...p, other: e.target.value }))} />
            <Typography variant="body2" fontWeight={700} sx={{ mt: 1, color: '#2E7D32' }}>Total In: {totalIn} mL</Typography>
          </Grid>
          <Grid size={{ xs: 12, sm: 6 }}>
            <Typography variant="caption" fontWeight={700} color="#D32F2F" sx={{ mb: 1, display: 'block' }}>OUTPUT (mL)</Typography>
            <TextField label="Urine" size="small" fullWidth type="number" value={output.urine}
              onChange={e => setOutput(p => ({ ...p, urine: e.target.value }))} sx={{ mb: 1 }} />
            <TextField label="Vomit" size="small" fullWidth type="number" value={output.vomit}
              onChange={e => setOutput(p => ({ ...p, vomit: e.target.value }))} sx={{ mb: 1 }} />
            <TextField label="Drain" size="small" fullWidth type="number" value={output.drain}
              onChange={e => setOutput(p => ({ ...p, drain: e.target.value }))} sx={{ mb: 1 }} />
            <TextField label="Other" size="small" fullWidth type="number" value={output.other}
              onChange={e => setOutput(p => ({ ...p, other: e.target.value }))} />
            <Typography variant="body2" fontWeight={700} sx={{ mt: 1, color: '#D32F2F' }}>Total Out: {totalOut} mL</Typography>
          </Grid>
        </Grid>
        <Box sx={{ mt: 2, display: 'flex', justifyContent: 'flex-end' }}>
          <Button variant="contained" size="small" onClick={() => saveMut.mutate()} disabled={saveMut.isPending}
            sx={{ bgcolor: '#327C8D', textTransform: 'none' }}>
            {saveMut.isPending ? 'Saving...' : 'Record Entry'}
          </Button>
        </Box>
      </Paper>

      {/* Fluid Balance History — expandable input/output tables */}
      {pastEntries.length > 0 && (
        <Paper variant="outlined" sx={{ p: 2 }}>
          <Typography variant="subtitle2" fontWeight={700} sx={{ mb: 1 }}>Fluid Balance History</Typography>
          {pastEntries.map((entry, i) => {
            const scoreData = entry.assessmentData ?? entry.scores ?? {};
            const entryIn = isRecord(scoreData.intake) ? scoreData.intake : {};
            const entryOut = isRecord(scoreData.output) ? scoreData.output : {};
            const inOral = toNumber(entryIn.oral);
            const inIv = toNumber(entryIn.iv);
            const inOther = toNumber(entryIn.other);
            const outUrine = toNumber(entryOut.urine);
            const outVomit = toNumber(entryOut.vomit);
            const outDrain = toNumber(entryOut.drain);
            const outOther = toNumber(entryOut.other);
            const eTotalIn = typeof scoreData.totalIn === 'number' ? scoreData.totalIn : (inOral + inIv + inOther);
            const eTotalOut = typeof scoreData.totalOut === 'number' ? scoreData.totalOut : (outUrine + outVomit + outDrain + outOther);
            const eBalance = typeof scoreData.balance === 'number' ? scoreData.balance : (eTotalIn - eTotalOut);
            const eColor = Math.abs(eBalance) > 1000 ? '#D32F2F' : Math.abs(eBalance) > 500 ? '#b8621a' : '#2E7D32';
            return (
              <Accordion key={entry.id ?? i} disableGutters elevation={0}
                sx={{ border: '1px solid #eee', mb: 0.5, '&:before': { display: 'none' }, borderLeft: `3px solid ${eColor}` }}>
                <AccordionSummary expandIcon={<ExpandMoreIcon />} sx={{ minHeight: 36, '& .MuiAccordionSummary-content': { my: 0.5, alignItems: 'center', gap: 1 } }}>
                  <Typography variant="body2" fontWeight={700} sx={{ color: eColor, fontSize: 12 }}>
                    {eBalance >= 0 ? '+' : ''}{eBalance} mL
                  </Typography>
                  <Typography variant="caption" color="text.secondary" sx={{ fontSize: 10 }}>
                    (In: {eTotalIn} | Out: {eTotalOut})
                  </Typography>
                  <Typography variant="caption" color="text.secondary" sx={{ ml: 'auto', mr: 1, fontSize: 11 }}>
                    {entry.assessmentDatetime ? new Date(entry.assessmentDatetime).toLocaleString('en-AU', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : ''}
                  </Typography>
                </AccordionSummary>
                <AccordionDetails sx={{ pt: 0, pb: 1.5, px: 2 }}>
                  <Grid container spacing={2}>
                    <Grid size={{ xs: 6 }}>
                      <Typography variant="caption" fontWeight={700} color="#2E7D32" sx={{ display: 'block', mb: 0.5 }}>INTAKE</Typography>
                      <Table size="small">
                        <TableBody>
                          <TableRow><TableCell sx={{ fontSize: 11, py: 0.3, border: 0 }}>Oral</TableCell><TableCell sx={{ fontSize: 11, py: 0.3, border: 0, fontWeight: 600 }}>{inOral} mL</TableCell></TableRow>
                          <TableRow><TableCell sx={{ fontSize: 11, py: 0.3, border: 0 }}>IV Fluids</TableCell><TableCell sx={{ fontSize: 11, py: 0.3, border: 0, fontWeight: 600 }}>{inIv} mL</TableCell></TableRow>
                          <TableRow><TableCell sx={{ fontSize: 11, py: 0.3, border: 0 }}>Other</TableCell><TableCell sx={{ fontSize: 11, py: 0.3, border: 0, fontWeight: 600 }}>{inOther} mL</TableCell></TableRow>
                          <TableRow><TableCell sx={{ fontSize: 11, py: 0.3, fontWeight: 700, color: '#2E7D32' }}>Total</TableCell><TableCell sx={{ fontSize: 11, py: 0.3, fontWeight: 700, color: '#2E7D32' }}>{eTotalIn} mL</TableCell></TableRow>
                        </TableBody>
                      </Table>
                    </Grid>
                    <Grid size={{ xs: 6 }}>
                      <Typography variant="caption" fontWeight={700} color="#D32F2F" sx={{ display: 'block', mb: 0.5 }}>OUTPUT</Typography>
                      <Table size="small">
                        <TableBody>
                          <TableRow><TableCell sx={{ fontSize: 11, py: 0.3, border: 0 }}>Urine</TableCell><TableCell sx={{ fontSize: 11, py: 0.3, border: 0, fontWeight: 600 }}>{outUrine} mL</TableCell></TableRow>
                          <TableRow><TableCell sx={{ fontSize: 11, py: 0.3, border: 0 }}>Vomit</TableCell><TableCell sx={{ fontSize: 11, py: 0.3, border: 0, fontWeight: 600 }}>{outVomit} mL</TableCell></TableRow>
                          <TableRow><TableCell sx={{ fontSize: 11, py: 0.3, border: 0 }}>Drain</TableCell><TableCell sx={{ fontSize: 11, py: 0.3, border: 0, fontWeight: 600 }}>{outDrain} mL</TableCell></TableRow>
                          <TableRow><TableCell sx={{ fontSize: 11, py: 0.3, border: 0 }}>Other</TableCell><TableCell sx={{ fontSize: 11, py: 0.3, border: 0, fontWeight: 600 }}>{outOther} mL</TableCell></TableRow>
                          <TableRow><TableCell sx={{ fontSize: 11, py: 0.3, fontWeight: 700, color: '#D32F2F' }}>Total</TableCell><TableCell sx={{ fontSize: 11, py: 0.3, fontWeight: 700, color: '#D32F2F' }}>{eTotalOut} mL</TableCell></TableRow>
                        </TableBody>
                      </Table>
                    </Grid>
                  </Grid>
                  <Box sx={{ mt: 1, pt: 1, borderTop: '1px solid #eee', textAlign: 'center' }}>
                    <Typography variant="body2" fontWeight={700} sx={{ color: eColor }}>
                      Net Balance: {eBalance >= 0 ? '+' : ''}{eBalance} mL
                    </Typography>
                  </Box>
                </AccordionDetails>
              </Accordion>
            );
          })}
        </Paper>
      )}
    </Box>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
//  Wound Care Documentation
// ══════════════════════════════════════════════════════════════════════════════
interface WoundCarePanelProps { patientId: string }
function WoundCarePanel({ patientId }: WoundCarePanelProps) {
  const qc = useQueryClient();
  const [form, setForm] = useState({
    site: '', woundType: '', size: '', depth: '', exudate: 'none',
    odour: 'no', surroundingSkin: '', dressingUsed: '', notes: '',
  });

  const saveMut = useMutation({
    mutationFn: () => apiClient.post('nursing-assessments', {
      patientId, assessmentType: 'wound_care', scores: form, totalScore: 0,
    }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: physicalHealthKeys.nursingAssessments(patientId) });
      setForm({ site: '', woundType: '', size: '', depth: '', exudate: 'none', odour: 'no', surroundingSkin: '', dressingUsed: '', notes: '' });
    },
    onError: (err: unknown) => alert(`Failed to save wound care: ${extractErrorMessage(err)}`),
  });

  const { data: history } = useQuery({
    queryKey: physicalHealthKeys.nursingAssessmentsWoundCare(patientId),
    queryFn: () => apiClient.get<ApiListEnvelope<NursingAssessmentEntry>>('nursing-assessments', { patientId, assessmentType: 'wound_care', limit: 10 }).catch(() => ({ data: [] })),
  });
  const pastWounds = readList<NursingAssessmentEntry>(history);

  return (
    <Box>
      <Paper variant="outlined" sx={{ p: 2.5, mb: 3 }}>
        <Typography variant="subtitle2" fontWeight={700} sx={{ mb: 2 }}>Wound Assessment</Typography>
        <Grid container spacing={2}>
          <Grid size={{ xs: 12, sm: 6 }}>
            <TextField label="Wound Site" size="small" fullWidth value={form.site}
              onChange={e => setForm(p => ({ ...p, site: e.target.value }))} placeholder="e.g. Left lower leg" />
          </Grid>
          <Grid size={{ xs: 12, sm: 6 }}>
            <TextField label="Wound Type" size="small" fullWidth value={form.woundType}
              onChange={e => setForm(p => ({ ...p, woundType: e.target.value }))} placeholder="e.g. Pressure injury, Surgical" />
          </Grid>
          <Grid size={{ xs: 6, sm: 3 }}>
            <TextField label="Size (cm)" size="small" fullWidth value={form.size}
              onChange={e => setForm(p => ({ ...p, size: e.target.value }))} placeholder="L x W" />
          </Grid>
          <Grid size={{ xs: 6, sm: 3 }}>
            <TextField label="Depth" size="small" fullWidth value={form.depth}
              onChange={e => setForm(p => ({ ...p, depth: e.target.value }))} placeholder="e.g. Superficial" />
          </Grid>
          <Grid size={{ xs: 6, sm: 3 }}>
            <Typography variant="caption" sx={{ display: 'block', mb: 0.5, fontSize: 11 }}>Exudate</Typography>
            <Box sx={{ display: 'flex', gap: 0.5 }}>
              {['none', 'low', 'moderate', 'heavy'].map(e => (
                <Chip key={e} label={e} size="small" onClick={() => setForm(p => ({ ...p, exudate: e }))}
                  sx={{ cursor: 'pointer', fontSize: 10, textTransform: 'capitalize',
                    bgcolor: form.exudate === e ? '#327C8D' : '#eee', color: form.exudate === e ? '#fff' : '#555' }} />
              ))}
            </Box>
          </Grid>
          <Grid size={{ xs: 6, sm: 3 }}>
            <Typography variant="caption" sx={{ display: 'block', mb: 0.5, fontSize: 11 }}>Odour</Typography>
            <Box sx={{ display: 'flex', gap: 0.5 }}>
              {['no', 'yes'].map(o => (
                <Chip key={o} label={o === 'yes' ? 'Present' : 'None'} size="small" onClick={() => setForm(p => ({ ...p, odour: o }))}
                  sx={{ cursor: 'pointer', fontSize: 10,
                    bgcolor: form.odour === o ? (o === 'yes' ? '#D32F2F' : '#2E7D32') : '#eee',
                    color: form.odour === o ? '#fff' : '#555' }} />
              ))}
            </Box>
          </Grid>
          <Grid size={{ xs: 12, sm: 6 }}>
            <TextField label="Surrounding Skin" size="small" fullWidth value={form.surroundingSkin}
              onChange={e => setForm(p => ({ ...p, surroundingSkin: e.target.value }))} placeholder="e.g. Erythematous, intact" />
          </Grid>
          <Grid size={{ xs: 12, sm: 6 }}>
            <TextField label="Dressing Used" size="small" fullWidth value={form.dressingUsed}
              onChange={e => setForm(p => ({ ...p, dressingUsed: e.target.value }))} placeholder="e.g. Mepilex Border" />
          </Grid>
          <Grid size={12}>
            <TextField label="Notes" size="small" fullWidth multiline rows={2} value={form.notes}
              onChange={e => setForm(p => ({ ...p, notes: e.target.value }))} />
          </Grid>
        </Grid>
        <Box sx={{ mt: 2, display: 'flex', justifyContent: 'flex-end' }}>
          <Button variant="contained" size="small" onClick={() => saveMut.mutate()} disabled={saveMut.isPending || !form.site}
            sx={{ bgcolor: '#327C8D', textTransform: 'none' }}>
            {saveMut.isPending ? 'Saving...' : 'Save Wound Assessment'}
          </Button>
        </Box>
      </Paper>

      {/* Wound history — expandable detail views */}
      {pastWounds.length > 0 && (
        <Paper variant="outlined" sx={{ p: 2 }}>
          <Typography variant="subtitle2" fontWeight={700} sx={{ mb: 1 }}>Wound History</Typography>
          {pastWounds.map((w, i) => {
            const d = w.assessmentData ?? w.scores ?? {};
            const site = toStringValue(d.site) ?? 'Unknown site';
            const woundType = toStringValue(d.woundType);
            const size = toStringValue(d.size);
            const depth = toStringValue(d.depth);
            const stage = toStringValue(d.stage);
            const exudate = toStringValue(d.exudate);
            const odour = toStringValue(d.odour);
            const surroundingSkin = toStringValue(d.surroundingSkin);
            const dressingUsed = toStringValue(d.dressingUsed);
            const treatment = toStringValue(d.treatment);
            const notesText = toStringValue(d.notes);
            return (
              <Accordion key={w.id ?? i} disableGutters elevation={0}
                sx={{ border: '1px solid #eee', mb: 0.5, '&:before': { display: 'none' }, borderLeft: '3px solid #327C8D' }}>
                <AccordionSummary expandIcon={<ExpandMoreIcon />} sx={{ minHeight: 36, '& .MuiAccordionSummary-content': { my: 0.5, alignItems: 'center', gap: 1 } }}>
                  <Typography variant="body2" fontWeight={600} sx={{ fontSize: 12 }}>{site}</Typography>
                  {woundType && <Chip label={woundType} size="small" sx={{ fontSize: 9, height: 18, textTransform: 'capitalize' }} />}
                  <Typography variant="caption" color="text.secondary" sx={{ ml: 'auto', mr: 1, fontSize: 11 }}>
                    {w.assessmentDatetime ? new Date(w.assessmentDatetime).toLocaleString('en-AU', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : ''}
                  </Typography>
                </AccordionSummary>
                <AccordionDetails sx={{ pt: 0, pb: 1.5, px: 2 }}>
                  <Table size="small">
                    <TableBody>
                      <TableRow>
                        <TableCell sx={{ fontSize: 11, py: 0.4, fontWeight: 600, color: 'text.secondary', width: 140 }}>Location / Site</TableCell>
                        <TableCell sx={{ fontSize: 11, py: 0.4 }}>{site}</TableCell>
                      </TableRow>
                      <TableRow>
                        <TableCell sx={{ fontSize: 11, py: 0.4, fontWeight: 600, color: 'text.secondary' }}>Wound Type</TableCell>
                        <TableCell sx={{ fontSize: 11, py: 0.4 }}>{woundType ?? '—'}</TableCell>
                      </TableRow>
                      <TableRow>
                        <TableCell sx={{ fontSize: 11, py: 0.4, fontWeight: 600, color: 'text.secondary' }}>Size</TableCell>
                        <TableCell sx={{ fontSize: 11, py: 0.4 }}>{size ?? '—'}</TableCell>
                      </TableRow>
                      <TableRow>
                        <TableCell sx={{ fontSize: 11, py: 0.4, fontWeight: 600, color: 'text.secondary' }}>Depth / Stage</TableCell>
                        <TableCell sx={{ fontSize: 11, py: 0.4 }}>{depth ?? stage ?? '—'}</TableCell>
                      </TableRow>
                      <TableRow>
                        <TableCell sx={{ fontSize: 11, py: 0.4, fontWeight: 600, color: 'text.secondary' }}>Exudate</TableCell>
                        <TableCell sx={{ fontSize: 11, py: 0.4 }}>
                          <Chip label={exudate ?? '—'} size="small" sx={{ fontSize: 9, height: 18, textTransform: 'capitalize',
                            bgcolor: exudate === 'heavy' ? '#FDECEA' : exudate === 'moderate' ? '#FFF3E0' : '#E8F5E9',
                            color: exudate === 'heavy' ? '#D32F2F' : exudate === 'moderate' ? '#b8621a' : '#2E7D32' }} />
                        </TableCell>
                      </TableRow>
                      <TableRow>
                        <TableCell sx={{ fontSize: 11, py: 0.4, fontWeight: 600, color: 'text.secondary' }}>Odour</TableCell>
                        <TableCell sx={{ fontSize: 11, py: 0.4 }}>
                          {odour === 'yes'
                            ? <Chip label="Present" size="small" sx={{ fontSize: 9, height: 18, bgcolor: '#FDECEA', color: '#D32F2F' }} />
                            : <Chip label="None" size="small" sx={{ fontSize: 9, height: 18, bgcolor: '#E8F5E9', color: '#2E7D32' }} />}
                        </TableCell>
                      </TableRow>
                      <TableRow>
                        <TableCell sx={{ fontSize: 11, py: 0.4, fontWeight: 600, color: 'text.secondary' }}>Surrounding Skin</TableCell>
                        <TableCell sx={{ fontSize: 11, py: 0.4 }}>{surroundingSkin ?? '—'}</TableCell>
                      </TableRow>
                      <TableRow>
                        <TableCell sx={{ fontSize: 11, py: 0.4, fontWeight: 600, color: 'text.secondary' }}>Dressing / Treatment</TableCell>
                        <TableCell sx={{ fontSize: 11, py: 0.4 }}>{dressingUsed ?? treatment ?? '—'}</TableCell>
                      </TableRow>
                      {notesText && (
                        <TableRow>
                          <TableCell sx={{ fontSize: 11, py: 0.4, fontWeight: 600, color: 'text.secondary' }}>Notes</TableCell>
                          <TableCell sx={{ fontSize: 11, py: 0.4 }}>{notesText}</TableCell>
                        </TableRow>
                      )}
                    </TableBody>
                  </Table>
                </AccordionDetails>
              </Accordion>
            );
          })}
        </Paper>
      )}
    </Box>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
//  Inpatient Notes (saved to episode)
// ══════════════════════════════════════════════════════════════════════════════
interface InpatientNotesPanelProps { patientId: string }
function InpatientNotesPanel({ patientId }: InpatientNotesPanelProps) {
  const qc = useQueryClient();
  const [noteType, setNoteType] = useState('ward_round');
  const [content, setContent] = useState('');
  const [saving, setSaving] = useState(false);
  const [expandedNoteId, setExpandedNoteId] = useState<string | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: inpatientKeys.notes(patientId),
    queryFn: async () => {
      try {
        const response = await apiClient.get<{ notes?: InpatientNote[]; data?: InpatientNote[] } | ApiListEnvelope<InpatientNote>>(`patients/${patientId}/notes`, { limit: 30 });
        const responseRecord: JsonRecord = isRecord(response) ? response : {};
        const notesCandidate = responseRecord.notes;
        const notesList: InpatientNote[] = Array.isArray(response)
          ? response
          : Array.isArray(notesCandidate)
            ? (notesCandidate as InpatientNote[])
            : readList<InpatientNote>(response);
        return notesList.filter((n: InpatientNote) => ['ward_round', 'progress', 'nursing', 'medical', 'incident'].includes(n.noteType ?? n.note_type ?? ''));
      } catch { return []; }
    },
  });
  const notes: InpatientNote[] = data ?? [];

  const NOTE_TYPES = [
    { value: 'ward_round', label: 'Ward Round' },
    { value: 'progress', label: 'Progress Note' },
    { value: 'nursing', label: 'Nursing Note' },
    { value: 'medical', label: 'Medical Note' },
    { value: 'incident', label: 'Incident Report' },
  ];

  const handleSave = async () => {
    if (!content.trim()) return;
    setSaving(true);
    try {
      await apiClient.post(`patients/${patientId}/notes`, {
        noteType, content, title: `${NOTE_TYPES.find(t => t.value === noteType)?.label ?? 'Note'} — Inpatient`,
        status: 'signed',
      });
      qc.invalidateQueries({ queryKey: inpatientKeys.notesAll() });
      qc.invalidateQueries({ queryKey: patientsKeys.notesAll() });
      setContent('');
    } catch { /* */ }
    setSaving(false);
  };

  return (
    <Box>
      <Paper variant="outlined" sx={{ p: 2.5, mb: 3 }}>
        <Typography variant="subtitle2" fontWeight={700} sx={{ mb: 2 }}>New Inpatient Note</Typography>
        <Box sx={{ display: 'flex', gap: 1.5, mb: 1.5 }}>
          <FormControl size="small" sx={{ minWidth: 180 }}>
            <InputLabel>Note Type</InputLabel>
            <Select label="Note Type" value={noteType} onChange={e => setNoteType(e.target.value)}>
              {NOTE_TYPES.map(t => <MenuItem key={t.value} value={t.value}>{t.label}</MenuItem>)}
            </Select>
          </FormControl>
        </Box>
        <TextField fullWidth multiline rows={4} size="small" value={content} onChange={e => setContent(e.target.value)}
          placeholder="Enter note content..." sx={{ mb: 1.5, '& .MuiInputBase-input': { fontSize: 12 } }} />
        <Box sx={{ display: 'flex', justifyContent: 'flex-end' }}>
          <Button variant="contained" onClick={handleSave} disabled={saving || !content.trim()}
            sx={{ bgcolor: '#327C8D', textTransform: 'none' }}>{saving ? 'Saving...' : 'Save Note'}</Button>
        </Box>
      </Paper>

      {isLoading && <CircularProgress role="progressbar" aria-label="Loading" size={24} />}
      {notes.length === 0 && !isLoading && <Typography variant="body2" color="text.secondary" sx={{ textAlign: 'center', py: 3 }}>No inpatient notes yet</Typography>}

      {notes.map((n, i) => {
        const isExpanded = expandedNoteId === (n.id ?? `n-${i}`);
        const noteTypeLabel = n.noteType ?? n.note_type ?? 'note';
        const authorName = n.authorName ?? n.author_name;
        const createdAt = n.createdAt ?? n.created_at;
        return (
        <Paper key={n.id ?? i} variant="outlined"
          role="button"
          tabIndex={0}
          aria-expanded={isExpanded}
          aria-label={`${n.title ?? 'Note'} (${n.noteType ?? 'note'}) — ${isExpanded ? 'collapse' : 'expand'}`}
          onClick={() => setExpandedNoteId(isExpanded ? null : (n.id ?? `n-${i}`))}
          onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setExpandedNoteId(isExpanded ? null : (n.id ?? `n-${i}`)); } }}
          sx={{ p: 2, mb: 1, borderLeft: '3px solid #327C8D', cursor: 'pointer', '&:hover': { bgcolor: '#FAFAFA' }, '&:focus-visible': { outline: '2px solid #327C8D', outlineOffset: 2 } }}>
          <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 0.5 }}>
            <Box sx={{ display: 'flex', gap: 1, alignItems: 'center' }}>
              <Chip label={noteTypeLabel} size="small" sx={{ fontSize: 9, height: 18, textTransform: 'capitalize' }} />
              <Typography variant="body2" fontWeight={600} sx={{ fontSize: 12 }}>{n.title ?? 'Note'}</Typography>
              {authorName && <Typography variant="caption" color="text.disabled" sx={{ fontSize: 9 }}>— {authorName}</Typography>}
            </Box>
            <Typography variant="caption" color="text.secondary" sx={{ fontSize: 10 }}>
              {createdAt ? new Date(createdAt).toLocaleString('en-AU', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : ''}
            </Typography>
          </Box>
          {isExpanded ? (
            <Typography variant="body2" color="text.secondary" sx={{ fontSize: 11, whiteSpace: 'pre-wrap', mt: 0.5 }}>{n.content}</Typography>
          ) : (
            <Typography variant="body2" color="text.secondary" sx={{ fontSize: 11, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{n.content?.substring(0, 150)}{(n.content?.length ?? 0) > 150 ? '...' : ''}</Typography>
          )}
        </Paper>
        );
      })}
    </Box>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
//  Inpatient Outcome Measures
// ══════════════════════════════════════════════════════════════════════════════
interface InpatientOutcomesPanelProps { patientId: string }
export function InpatientOutcomesPanel({ patientId }: InpatientOutcomesPanelProps) {
  const qc = useQueryClient();
  const [scale, setScale] = useState('honos');
  const [score, setScore] = useState('');
  const [occasion, setOccasion] = useState('review');
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [itemScores, setItemScores] = useState<Record<string, number>>({});
  const [showItems, setShowItems] = useState(false);
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);

  const SCALES = [
    { value: 'honos', label: 'HoNOS', max: 48, items: 12 },
    { value: 'lsp16', label: 'LSP-16', max: 64, items: 16 },
    { value: 'k10', label: 'K10', max: 50, items: 10 },
    { value: 'phq9', label: 'PHQ-9', max: 27, items: 9 },
    { value: 'gaf', label: 'GAF', max: 100, items: 1 },
    { value: 'madrs', label: 'MADRS', max: 60, items: 10 },
    { value: 'bprs', label: 'BPRS', max: 126, items: 18 },
    { value: 'ymrs', label: 'YMRS', max: 60, items: 11 },
    { value: 'dass21', label: 'DASS-21', max: 126, items: 21 },
  ];
  const OCCASIONS = ['admission', 'review', '91-day', 'discharge', 'follow-up'];
  const scaleConfig = SCALES.find((s) => s.value === scale);
  const requiresItemCompleteness = OUTCOME_SCALES_REQUIRING_ITEM_COMPLETENESS.has(scale);

  useEffect(() => {
    if (!requiresItemCompleteness) return;
    if (!showItems) setShowItems(true);
    setItemScores((prev) => buildCompleteScaleItems(scaleConfig?.items ?? 0, prev));
  }, [requiresItemCompleteness, scaleConfig?.items, showItems]);

  // Fetch from both outcome_measures API and nursing_assessments
  const { data: outcomesApi, isLoading: apiLoading } = useQuery({
    queryKey: outcomeMeasuresKeys.api(patientId),
    queryFn: () => apiClient.get<ApiListEnvelope<OutcomeApiEntry>>(`outcomes/patient/${patientId}`).catch((err) => { console.warn('InpatientCareTab: outcomes fetch failed', err); return []; }),
  });
  const { data: nursingOutcomes, isLoading: nursingLoading } = useQuery({
    queryKey: outcomeMeasuresKeys.inpatient(patientId),
    queryFn: () => apiClient.get<ApiListEnvelope<NursingAssessmentEntry>>('nursing-assessments', { patientId, assessmentType: 'outcome_measure', limit: 50 }).catch(() => ({ data: [] })),
  });

  const apiMeasures = readList<OutcomeApiEntry>(outcomesApi);
  const nursingMeasures = readList<NursingAssessmentEntry>(nursingOutcomes);
  // Combine and sort by date
  const allOutcomes: OutcomeRow[] = [
    ...apiMeasures.map((m) => ({ date: m.completedAt ?? m.completed_at ?? m.createdAt, scale: m.measureType ?? m.measure_type, score: m.totalScore ?? m.total_score, occasion: m.occasion, notes: m.notes, source: 'outcomes' as const })),
    ...nursingMeasures.map((m) => {
      const d = m.assessmentData ?? m.scores ?? {};
      const dateValue = typeof d.date === 'string' ? d.date : m.assessmentDatetime;
      const scaleValue = typeof d.scale === 'string' ? d.scale : m.score_band;
      const scoreValue = typeof d.score === 'number' || typeof d.score === 'string' ? d.score : m.totalScore;
      const occasionValue = typeof d.occasion === 'string' ? d.occasion : undefined;
      const notesValue = typeof d.notes === 'string' ? d.notes : undefined;
      return { date: dateValue, scale: scaleValue, score: scoreValue, occasion: occasionValue, notes: notesValue, source: 'nursing' as const };
    }),
  ].sort((a, b) => (b.date ?? '').localeCompare(a.date ?? ''));
  const isLoading = apiLoading || nursingLoading;

  const handleSave = async () => {
    setSaving(true);
    try {
      // Save to both endpoints for consistency
      const normalizedItems = buildCompleteScaleItems(scaleConfig?.items ?? 0, itemScores);
      const totalFromItems = Object.values(normalizedItems).reduce((a, b) => a + b, 0);
      const finalScore = (requiresItemCompleteness || showItems)
        ? totalFromItems
        : (parseInt(score, 10) || 0);
      await apiClient.post('outcomes', {
        patientId, measureType: scale, occasion, totalScore: finalScore,
        items: (requiresItemCompleteness || showItems) ? normalizedItems : {},
        completedAt: date,
        notes,
      }).catch((err) => { console.warn('InpatientCareTab: outcome save failed', err); });
      await apiClient.post('nursing-assessments', {
        patientId, assessmentType: 'outcome_measure',
        scores: { scale, score: finalScore, date, notes, occasion },
        totalScore: finalScore,
        scoreBand: scale,
      }).catch((err) => { console.warn('InpatientCareTab: nursing assessment save failed', err); });
      qc.invalidateQueries({ queryKey: outcomeMeasuresKeys.inpatientAll() });
      qc.invalidateQueries({ queryKey: outcomeMeasuresKeys.apiAll() });
      qc.invalidateQueries({ queryKey: outcomeMeasuresKeys.all });
      setScore(''); setNotes('');
    } catch { /* */ }
    setSaving(false);
  };

  return (
    <Box>
      <Paper variant="outlined" sx={{ p: 2.5, mb: 3 }}>
        <Typography variant="subtitle2" fontWeight={700} sx={{ mb: 2 }}>Record Outcome Measure</Typography>
        <Grid container spacing={2}>
          <Grid size={{ xs: 12, sm: 3 }}>
            <FormControl size="small" fullWidth>
              <InputLabel>Scale</InputLabel>
              <Select label="Scale" value={scale} onChange={e => setScale(e.target.value)}>
                {SCALES.map(s => <MenuItem key={s.value} value={s.value}>{s.label} (0-{s.max})</MenuItem>)}
              </Select>
            </FormControl>
          </Grid>
          <Grid size={{ xs: 6, sm: 2 }}>
            <FormControl size="small" fullWidth>
              <InputLabel>Occasion</InputLabel>
              <Select label="Occasion" value={occasion} onChange={e => setOccasion(e.target.value)}>
                {OCCASIONS.map(o => <MenuItem key={o} value={o} sx={{ textTransform: 'capitalize' }}>{o}</MenuItem>)}
              </Select>
            </FormControl>
          </Grid>
          <Grid size={{ xs: 6, sm: 2 }}>
            <TextField label={(requiresItemCompleteness || showItems) ? 'Auto-total' : 'Total Score'} size="small" fullWidth type="number"
              value={(requiresItemCompleteness || showItems) ? Object.values(itemScores).reduce((a, b) => a + b, 0) || '' : score}
              onChange={e => { if (!requiresItemCompleteness && !showItems) setScore(e.target.value); }}
              disabled={requiresItemCompleteness || showItems}
              helperText={requiresItemCompleteness ? 'HoNOS requires item-level scoring; total is calculated.' : (showItems ? 'Calculated from items' : undefined)} />
          </Grid>
          <Grid size={{ xs: 6, sm: 2 }}>
            <TextField label="Date" type="date" size="small" fullWidth value={date}
              onChange={e => setDate(e.target.value)} slotProps={{ inputLabel: { shrink: true } }} />
          </Grid>
          <Grid size={{ xs: 6, sm: 2 }}>
            <TextField label="Notes" size="small" fullWidth value={notes} onChange={e => setNotes(e.target.value)} />
          </Grid>
          <Grid size={{ xs: 12, sm: 1 }} sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
            <Button variant="contained" onClick={handleSave}
              disabled={saving || (!requiresItemCompleteness && !score && !showItems) || ((requiresItemCompleteness || showItems) && Object.keys(itemScores).length === 0)}
              sx={{ bgcolor: '#327C8D', textTransform: 'none', fontSize: 12 }}>{saving ? '...' : 'Save'}</Button>
          </Grid>
        </Grid>

        {!requiresItemCompleteness && (
          <Button size="small" onClick={() => { setShowItems(!showItems); setItemScores({}); }}
            sx={{ mt: 1, fontSize: 11, color: '#327C8D', textTransform: 'none' }}>
            {showItems ? '← Use total score only' : '→ Score individual items'}
          </Button>
        )}

        {/* Item-level inputs */}
        {(requiresItemCompleteness || showItems) && (() => {
          const itemCount = scaleConfig?.items ?? 10;
          return (
            <Box sx={{ mt: 1.5, p: 1.5, bgcolor: '#F5F5F5', borderRadius: 1 }}>
              <Typography variant="caption" fontWeight={600} sx={{ mb: 1, display: 'block' }}>
                {scaleConfig?.label} — Score each item (0-{scale === 'gaf' ? '100' : '4'})
              </Typography>
              <Grid container spacing={1}>
                {Array.from({ length: itemCount }, (_, i) => (
                  <Grid key={i} size={{ xs: 6, sm: 4, md: 3 }}>
                    <TextField label={`Item ${i + 1}`} size="small" fullWidth type="number"
                      value={itemScores[String(i + 1)] ?? ''}
                      onChange={e => setItemScores(prev => ({ ...prev, [String(i + 1)]: parseInt(e.target.value, 10) || 0 }))}
                      slotProps={{ htmlInput: { min: 0, max: scale === 'gaf' ? 100 : 4 } }}
                      sx={{ '& input': { fontSize: 12, py: 0.5 } }} />
                  </Grid>
                ))}
              </Grid>
              <Typography variant="caption" color="text.secondary" sx={{ mt: 1, display: 'block' }}>
                Total: {Object.values(itemScores).reduce((a, b) => a + b, 0)} / {scaleConfig?.max ?? '?'}
              </Typography>
            </Box>
          );
        })()}
      </Paper>

      {isLoading && <CircularProgress role="progressbar" aria-label="Loading" size={24} />}

      {allOutcomes.length > 0 && (
        <TableContainer role="region" aria-label="Data table" component={Paper} variant="outlined">
          <Table size="small">
            <TableHead>
              <TableRow sx={{ bgcolor: '#FBF8F5' }}>
                {['Date', 'Scale', 'Score', 'Occasion', 'Notes'].map(h => <TableCell key={h} sx={{ fontWeight: 700, fontSize: 11 }}>{h}</TableCell>)}
              </TableRow>
            </TableHead>
            <TableBody>
              {allOutcomes.map((o, i) => {
                const scaleInfo = SCALES.find(s => s.value === o.scale);
                return (
                  <TableRow key={i}>
                    <TableCell sx={{ fontSize: 11 }}>{o.date ? new Date(o.date).toLocaleDateString('en-AU') : '—'}</TableCell>
                    <TableCell sx={{ fontSize: 11 }}><Chip label={scaleInfo?.label ?? o.scale ?? '?'} size="small" sx={{ fontSize: 9, height: 18 }} /></TableCell>
                    <TableCell sx={{ fontSize: 11, fontWeight: 700 }}>{o.score ?? '—'}{scaleInfo ? `/${scaleInfo.max}` : ''}</TableCell>
                    <TableCell sx={{ fontSize: 10, textTransform: 'capitalize' }}>{o.occasion ?? '—'}</TableCell>
                    <TableCell sx={{ fontSize: 10, color: 'text.secondary' }}>{o.notes ?? ''}</TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </TableContainer>
      )}
    </Box>
  );
}
