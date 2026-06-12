import AddIcon from '@mui/icons-material/Add';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import DescriptionIcon from '@mui/icons-material/Description';
import DownloadIcon from '@mui/icons-material/Download';
import ElectricalServicesIcon from '@mui/icons-material/ElectricalServices';
import MedicationIcon from '@mui/icons-material/Medication';
import MonitorHeartIcon from '@mui/icons-material/MonitorHeart';
import UploadFileIcon from '@mui/icons-material/UploadFile';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import {
  Accordion, AccordionDetails, AccordionSummary,
    Alert, Box, Button, Chip, CircularProgress, Dialog, DialogActions,
    DialogContent, DialogTitle, Divider, FormControl, FormControlLabel, Grid, IconButton,
    InputLabel, MenuItem, Paper, Select, Switch, Tab, Table, TableBody, TableCell,
    TableContainer, TableHead, TableRow, Tabs, TextField, Tooltip, Typography
} from '@mui/material';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import React, { useRef, useState } from 'react';
import { apiClient } from '../../../../../shared/services/apiClient';
import { llmAiJobsApi } from '../../../../../shared/services/llmAiJobsApi';
import { ectKeys } from '../../../queryKeys';
import { useAuthStore } from '../../../../../shared/store/authStore';
import {
  type EctAssessmentHistoryData,
  type EctCourseData,
  type EctDocumentRow,
  type EctDocumentsResponse,
  type EctMedicalForm,
  type EctTreatmentData,
  type NursingAssessmentRow,
  type NursingAssessmentsResponse,
  MEDICAL_SCORE_FIELDS,
  getErrorMessage,
  readAssessmentData,
  readList,
} from './ectTabSupport';
import {
  EctPrescriberGate,
  EctTmsRoleWorkflowNotice,
} from './ectRoleSupport';

type EctSubTab = 'course' | 'treatments' | 'prescription' | 'consent' | 'cognitive' | 'documents';

// ── ECT Constants ──
const ELECTRODE_PLACEMENTS = ['Bilateral (BL)', 'Right Unilateral (RUL)', 'Left Anterior Right Temporal (LART)', 'Bifrontal (BF)'];
const ANAESTHETIC_AGENTS = ['Propofol', 'Thiopentone', 'Methohexitone', 'Ketamine', 'Etomidate', 'Propofol + Ketamine'];
const MUSCLE_RELAXANTS = ['Suxamethonium (Succinylcholine)', 'Rocuronium'];
const ANTICHOLINERGICS = ['Glycopyrrolate', 'Atropine', 'None'];
const PULSE_WIDTHS = ['Ultra-brief (0.3ms)', 'Brief (0.5ms)', 'Standard (1.0ms)', 'Broad (1.5ms)'];
const ECT_INDICATIONS = [
  'Treatment-resistant depression', 'Severe depression with psychosis', 'Acute suicidality',
  'Catatonia', 'Treatment-resistant schizophrenia', 'Severe mania',
  'Neuroleptic malignant syndrome', 'Schizoaffective disorder', 'Other',
];

interface EctTabProps { patientId: string }
export function EctTab({ patientId }: EctTabProps): React.ReactElement {
  const [selectedCourseId, setSelectedCourseId] = useState<string | null>(null);
  const [subTab, setSubTab] = useState<EctSubTab>('course');
  const [aiSummary, setAiSummary] = useState('');
  const [aiLoading, setAiLoading] = useState(false);

  // Fetch all courses for this patient
  const { data: coursesData } = useQuery({
    queryKey: ectKeys.courses(patientId),
    queryFn: () =>
      apiClient
        .get<NursingAssessmentsResponse | NursingAssessmentRow[]>('nursing-assessments', { patientId, assessmentType: 'ect_course', limit: 20 })
        .catch(() => ({ data: [] })),
  });
  const courses = readList<NursingAssessmentRow>(coursesData);
  const activeCourse = selectedCourseId ? courses.find((c) => c.id === selectedCourseId) : courses[0];
  const courseId = activeCourse?.id ?? '';

  const generateEctSummary = async () => {
    setAiLoading(true);
    try {
      const result = await llmAiJobsApi.runClinicalAiJob({
        action: 'ect-summary',
        data: JSON.stringify({ courses: courses.length, activeCourse: readAssessmentData<EctCourseData>(activeCourse), patientId }),
      });
      setAiSummary(result ?? 'Summary unavailable');
    } catch { setAiSummary('AI summary unavailable. Ensure Ollama is running.'); }
    setAiLoading(false);
  };

  return (
    <Box>
      {/* Course selector bar */}
      <Box sx={{ display: 'flex', gap: 1.5, mb: 2, alignItems: 'center', flexWrap: 'wrap' }}>
        <ElectricalServicesIcon sx={{ color: '#327C8D', fontSize: 24 }} />
        <Typography variant="subtitle1" fontWeight={700} fontFamily="Albert Sans, sans-serif">ECT</Typography>
        {courses.length > 0 && (
          <FormControl size="small" sx={{ minWidth: 200 }}>
            <Select value={courseId} onChange={e => setSelectedCourseId(e.target.value)} displayEmpty sx={{ fontSize: 12 }}>
              {courses.map((c, i: number) => {
                const d = readAssessmentData<EctCourseData>(c);
                return <MenuItem key={c.id} value={c.id} sx={{ fontSize: 12 }}>
                  Course {courses.length - i}: {d.indication ?? 'ECT'} ({d.status ?? 'active'})
                </MenuItem>;
              })}
            </Select>
          </FormControl>
        )}
        <Box sx={{ flex: 1 }} />
        <Button size="small" onClick={generateEctSummary} disabled={aiLoading || !courseId}
          sx={{ fontSize: 10, textTransform: 'none', color: '#327C8D' }}>
          {aiLoading ? 'Generating...' : 'AI Summary'}
        </Button>
      </Box>

      {/* AI Summary */}
      {aiSummary && (
        <Paper variant="outlined" sx={{ p: 1.5, mb: 2, borderLeft: '3px solid #327C8D', bgcolor: '#F5F9FA' }}>
          <Typography variant="caption" fontWeight={700} color="#327C8D">AI ECT Summary</Typography>
          <Typography variant="body2" sx={{ fontSize: 11, whiteSpace: 'pre-wrap', mt: 0.5 }}>{aiSummary}</Typography>
        </Paper>
      )}

      {/* Sub-tabs — nested under the selected course */}
      <Tabs aria-label="Navigation tabs" value={subTab} onChange={(_, v) => setSubTab(v)} variant="scrollable" scrollButtons="auto"
        sx={{ mb: 2, '& .MuiTab-root': { textTransform: 'none', fontFamily: 'Albert Sans, sans-serif', fontSize: 13 } }}>
        <Tab icon={<ElectricalServicesIcon sx={{ fontSize: 16 }} />} iconPosition="start" label="Courses" value="course" />
        <Tab icon={<MonitorHeartIcon sx={{ fontSize: 16 }} />} iconPosition="start" label="Treatment Log" value="treatments" disabled={!courseId} />
        <Tab icon={<DescriptionIcon sx={{ fontSize: 16 }} />} iconPosition="start" label="Prescription" value="prescription" disabled={!courseId} />
        <Tab icon={<CheckCircleIcon sx={{ fontSize: 16 }} />} iconPosition="start" label="Consent & MHA" value="consent" disabled={!courseId} />
        <Tab icon={<MedicationIcon sx={{ fontSize: 16 }} />} iconPosition="start" label="Assessments" value="cognitive" disabled={!courseId} />
        <Tab icon={<UploadFileIcon sx={{ fontSize: 16 }} />} iconPosition="start" label="Documents" value="documents" />
      </Tabs>

      {subTab === 'course' && <EctCoursePanel patientId={patientId} />}
      {subTab === 'treatments' && courseId && <TreatmentLogPanel patientId={patientId} />}
      {subTab === 'prescription' && courseId && <EctPrescriberGate><EctPrescriptionPanel patientId={patientId} /></EctPrescriberGate>}
      {subTab === 'consent' && courseId && <ConsentMhaPanel patientId={patientId} />}
      {subTab === 'cognitive' && courseId && <EctAssessmentsPanel patientId={patientId} />}
      {subTab === 'documents' && <EctDocumentsPanel patientId={patientId} />}
    </Box>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
//  ECT Course Overview
// ══════════════════════════════════════════════════════════════════════════════
interface EctCoursePanelProps { patientId: string }
function EctCoursePanel({ patientId }: EctCoursePanelProps) {
  const { data, isLoading } = useQuery({
    queryKey: ectKeys.courses(patientId),
    queryFn: () =>
      apiClient
        .get<NursingAssessmentsResponse | NursingAssessmentRow[]>('nursing-assessments', { patientId, assessmentType: 'ect_course', limit: 10 })
        .catch(() => ({ data: [] })),
  });
  const courses = readList<NursingAssessmentRow>(data);
  const [addOpen, setAddOpen] = useState(false);

  return (
    <Box>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
        <Typography variant="h6" fontWeight={600} fontFamily="Albert Sans, sans-serif">ECT Course Summary</Typography>
        <Button startIcon={<AddIcon />} variant="contained" size="small" onClick={() => setAddOpen(true)}
          sx={{ bgcolor: '#327C8D', textTransform: 'none' }}>New ECT Course</Button>
      </Box>

      {isLoading && <CircularProgress role="progressbar" aria-label="Loading" size={24} />}

      {courses.length === 0 && !isLoading && (
        <Alert severity="info">No ECT courses recorded. Click "New ECT Course" to start.</Alert>
      )}

      {courses.map((c, i: number) => {
        const d = readAssessmentData<EctCourseData>(c);
        return (
          <Paper key={c.id ?? i} variant="outlined" sx={{ p: 2.5, mb: 2, borderLeft: '4px solid #327C8D' }}>
            <Grid container spacing={2}>
              <Grid size={{ xs: 12, sm: 6 }}>
                <Typography variant="subtitle2" fontWeight={700}>Course #{courses.length - i}</Typography>
                <Typography variant="caption" color="text.secondary">
                  Started: {c.assessmentDatetime ? new Date(c.assessmentDatetime).toLocaleDateString('en-AU') : '—'}
                </Typography>
              </Grid>
              <Grid size={{ xs: 6, sm: 3 }}>
                <Typography variant="caption" fontWeight={600}>Indication</Typography>
                <Typography variant="body2" sx={{ fontSize: 12 }}>{d.indication ?? '—'}</Typography>
              </Grid>
              <Grid size={{ xs: 6, sm: 3 }}>
                <Typography variant="caption" fontWeight={600}>Treatments</Typography>
                <Typography variant="body2" sx={{ fontSize: 12 }}>{d.totalTreatments ?? 0} / {d.plannedTreatments ?? '—'}</Typography>
              </Grid>
              <Grid size={{ xs: 6, sm: 3 }}>
                <Typography variant="caption" fontWeight={600}>Placement</Typography>
                <Typography variant="body2" sx={{ fontSize: 12 }}>{d.electrodePlacement ?? '—'}</Typography>
              </Grid>
              <Grid size={{ xs: 6, sm: 3 }}>
                <Typography variant="caption" fontWeight={600}>Frequency</Typography>
                <Typography variant="body2" sx={{ fontSize: 12 }}>{d.frequency ?? '—'}</Typography>
              </Grid>
              <Grid size={{ xs: 6, sm: 3 }}>
                <Typography variant="caption" fontWeight={600}>Anaesthetist</Typography>
                <Typography variant="body2" sx={{ fontSize: 12 }}>{d.anaesthetist ?? '—'}</Typography>
              </Grid>
              <Grid size={{ xs: 6, sm: 3 }}>
                <Chip label={d.status ?? 'active'} size="small" sx={{
                  textTransform: 'capitalize', fontSize: 10,
                  bgcolor: d.status === 'completed' ? '#E8F5E9' : '#E8F5F7',
                  color: d.status === 'completed' ? '#2E7D32' : '#327C8D',
                }} />
              </Grid>
            </Grid>
          </Paper>
        );
      })}

      {addOpen && <NewEctCourseDialog patientId={patientId} onClose={() => setAddOpen(false)} />}
    </Box>
  );
}

interface NewEctCourseDialogProps { patientId: string; onClose: () => void }
function NewEctCourseDialog({ patientId, onClose }: NewEctCourseDialogProps) {
  const qc = useQueryClient();
  const [form, setForm] = useState({
    indication: '', electrodePlacement: 'Right Unilateral (RUL)', frequency: '3 per week',
    plannedTreatments: '12', anaesthetist: '', psychiatrist: '',
    anaestheticAgent: 'Propofol', muscleRelaxant: 'Suxamethonium (Succinylcholine)',
    anticholinergic: 'Glycopyrrolate', pulseWidth: 'Ultra-brief (0.3ms)',
    notes: '',
  });

  const saveMut = useMutation({
    mutationFn: () => apiClient.post('nursing-assessments', {
      patientId, assessmentType: 'ect_course',
      scores: form, totalScore: 0, riskLevel: 'active',
    }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ectKeys.coursesAll() }); onClose(); },
  });

  return (
    <Dialog open onClose={onClose} maxWidth="md" fullWidth>
      <DialogTitle sx={{ fontWeight: 700 }}>
        <ElectricalServicesIcon sx={{ mr: 1, verticalAlign: 'middle', color: '#327C8D' }} />
        New ECT Course
      </DialogTitle>
      <DialogContent>
        <Grid container spacing={2} sx={{ mt: 0.5 }}>
          <Grid size={{ xs: 12 }}>
            <FormControl fullWidth size="small">
              <InputLabel>Indication *</InputLabel>
              <Select label="Indication *" value={form.indication} onChange={e => setForm(p => ({ ...p, indication: e.target.value }))}>
                {ECT_INDICATIONS.map(i => <MenuItem key={i} value={i}>{i}</MenuItem>)}
              </Select>
            </FormControl>
          </Grid>
          <Grid size={{ xs: 12, sm: 4 }}>
            <FormControl fullWidth size="small">
              <InputLabel>Electrode Placement</InputLabel>
              <Select label="Electrode Placement" value={form.electrodePlacement} onChange={e => setForm(p => ({ ...p, electrodePlacement: e.target.value }))}>
                {ELECTRODE_PLACEMENTS.map(p => <MenuItem key={p} value={p}>{p}</MenuItem>)}
              </Select>
            </FormControl>
          </Grid>
          <Grid size={{ xs: 12, sm: 4 }}>
            <FormControl fullWidth size="small">
              <InputLabel>Pulse Width</InputLabel>
              <Select label="Pulse Width" value={form.pulseWidth} onChange={e => setForm(p => ({ ...p, pulseWidth: e.target.value }))}>
                {PULSE_WIDTHS.map(p => <MenuItem key={p} value={p}>{p}</MenuItem>)}
              </Select>
            </FormControl>
          </Grid>
          <Grid size={{ xs: 6, sm: 2 }}>
            <TextField label="Frequency" size="small" fullWidth value={form.frequency}
              onChange={e => setForm(p => ({ ...p, frequency: e.target.value }))} placeholder="e.g. 3/week" />
          </Grid>
          <Grid size={{ xs: 6, sm: 2 }}>
            <TextField label="Planned #" size="small" fullWidth type="number" value={form.plannedTreatments}
              onChange={e => setForm(p => ({ ...p, plannedTreatments: e.target.value }))} />
          </Grid>

          <Grid size={12}><Divider><Typography variant="caption">Anaesthetic Protocol</Typography></Divider></Grid>
          <Grid size={{ xs: 12, sm: 4 }}>
            <FormControl fullWidth size="small">
              <InputLabel>Anaesthetic Agent</InputLabel>
              <Select label="Anaesthetic Agent" value={form.anaestheticAgent} onChange={e => setForm(p => ({ ...p, anaestheticAgent: e.target.value }))}>
                {ANAESTHETIC_AGENTS.map(a => <MenuItem key={a} value={a}>{a}</MenuItem>)}
              </Select>
            </FormControl>
          </Grid>
          <Grid size={{ xs: 12, sm: 4 }}>
            <FormControl fullWidth size="small">
              <InputLabel>Muscle Relaxant</InputLabel>
              <Select label="Muscle Relaxant" value={form.muscleRelaxant} onChange={e => setForm(p => ({ ...p, muscleRelaxant: e.target.value }))}>
                {MUSCLE_RELAXANTS.map(m => <MenuItem key={m} value={m}>{m}</MenuItem>)}
              </Select>
            </FormControl>
          </Grid>
          <Grid size={{ xs: 12, sm: 4 }}>
            <FormControl fullWidth size="small">
              <InputLabel>Anticholinergic</InputLabel>
              <Select label="Anticholinergic" value={form.anticholinergic} onChange={e => setForm(p => ({ ...p, anticholinergic: e.target.value }))}>
                {ANTICHOLINERGICS.map(a => <MenuItem key={a} value={a}>{a}</MenuItem>)}
              </Select>
            </FormControl>
          </Grid>

          <Grid size={12}><Divider><Typography variant="caption">Clinical Team</Typography></Divider></Grid>
          <Grid size={{ xs: 12, sm: 6 }}>
            <TextField label="Treating Psychiatrist" size="small" fullWidth value={form.psychiatrist}
              onChange={e => setForm(p => ({ ...p, psychiatrist: e.target.value }))} />
          </Grid>
          <Grid size={{ xs: 12, sm: 6 }}>
            <TextField label="Anaesthetist" size="small" fullWidth value={form.anaesthetist}
              onChange={e => setForm(p => ({ ...p, anaesthetist: e.target.value }))} />
          </Grid>
          <Grid size={12}>
            <TextField label="Notes" size="small" fullWidth multiline rows={2} value={form.notes}
              onChange={e => setForm(p => ({ ...p, notes: e.target.value }))} />
          </Grid>
        </Grid>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Cancel</Button>
        <Button variant="contained" onClick={() => saveMut.mutate()} disabled={!form.indication || saveMut.isPending}
          sx={{ bgcolor: '#327C8D' }}>{saveMut.isPending ? 'Saving...' : 'Create Course'}</Button>
      </DialogActions>
    </Dialog>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
//  Individual Treatment Log
// ══════════════════════════════════════════════════════════════════════════════
interface TreatmentLogPanelProps { patientId: string }
function TreatmentLogPanel({ patientId }: TreatmentLogPanelProps) {
  const qc = useQueryClient();
  const [addOpen, setAddOpen] = useState(false);
  const { data, isLoading } = useQuery({
    queryKey: ectKeys.treatments(patientId),
    queryFn: () =>
      apiClient
        .get<NursingAssessmentsResponse | NursingAssessmentRow[]>('nursing-assessments', { patientId, assessmentType: 'ect_treatment', limit: 50 })
        .catch(() => ({ data: [] })),
  });
  const treatments = readList<NursingAssessmentRow>(data);

  const [form, setForm] = useState({
    treatmentNumber: String(treatments.length + 1), treatmentDate: new Date().toISOString().slice(0, 10),
    // Pre-procedure
    fasting: true, consent: true, bpPre: '', hrPre: '', spo2Pre: '', cogAssessment: '',
    // Procedure
    electrodePlacement: 'Right Unilateral (RUL)', charge: '', frequency: '', pulseWidth: '',
    // Anaesthesia
    anaestheticAgent: 'Propofol', anaestheticDose: '', muscleRelaxant: 'Suxamethonium', muscleRelaxantDose: '',
    anticholinergic: 'Glycopyrrolate', anticholinergicDose: '', otherMeds: '',
    // Seizure
    seizureDurationMotor: '', seizureDurationEeg: '', adequateSeizure: true,
    // Recovery
    bpPost: '', hrPost: '', spo2Post: '', timeToOrientation: '',
    complications: '', headache: false, nausea: false, confusion: false, memoryIssues: false,
    notes: '',
  });

  const saveMut = useMutation({
    mutationFn: () => apiClient.post('nursing-assessments', {
      patientId, assessmentType: 'ect_treatment',
      scores: form, totalScore: parseInt(form.treatmentNumber, 10) || 0, riskLevel: form.adequateSeizure ? 'adequate' : 'inadequate',
    }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ectKeys.treatmentsAll() }); setAddOpen(false); },
  });

  return (
    <Box>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
        <Typography variant="h6" fontWeight={600}>Treatment Log</Typography>
        <Button startIcon={<AddIcon />} variant="contained" size="small" onClick={() => { setForm(f => ({ ...f, treatmentNumber: String(treatments.length + 1) })); setAddOpen(true); }}
          sx={{ bgcolor: '#327C8D', textTransform: 'none' }}>Record Treatment</Button>
      </Box>

      {isLoading && <CircularProgress role="progressbar" aria-label="Loading" size={24} />}
      {treatments.length === 0 && !isLoading && <Alert severity="info">No treatments recorded yet.</Alert>}

      {treatments.length > 0 && (
        <TableContainer role="region" aria-label="Data table" component={Paper} variant="outlined">
          <Table size="small">
            <TableHead>
              <TableRow sx={{ bgcolor: '#FBF8F5' }}>
                {['#', 'Date', 'Placement', 'Charge', 'Seizure (motor)', 'Seizure (EEG)', 'Adequate', 'Anaesthetic', 'Complications'].map(h => (
                  <TableCell key={h} sx={{ fontWeight: 700, fontSize: 10 }}>{h}</TableCell>
                ))}
              </TableRow>
            </TableHead>
            <TableBody>
              {treatments.map((t, i: number) => {
                const d = readAssessmentData<EctTreatmentData>(t);
                return (
                  <TableRow key={t.id ?? i} hover>
                    <TableCell sx={{ fontWeight: 700, fontSize: 11 }}>{d.treatmentNumber ?? treatments.length - i}</TableCell>
                    <TableCell sx={{ fontSize: 11 }}>{d.treatmentDate ?? (t.assessmentDatetime ? new Date(t.assessmentDatetime).toLocaleDateString('en-AU') : '—')}</TableCell>
                    <TableCell sx={{ fontSize: 10 }}>{d.electrodePlacement ?? '—'}</TableCell>
                    <TableCell sx={{ fontSize: 11 }}>{d.charge ? `${d.charge}mC` : '—'}</TableCell>
                    <TableCell sx={{ fontSize: 11 }}>{d.seizureDurationMotor ? `${d.seizureDurationMotor}s` : '—'}</TableCell>
                    <TableCell sx={{ fontSize: 11 }}>{d.seizureDurationEeg ? `${d.seizureDurationEeg}s` : '—'}</TableCell>
                    <TableCell>
                      <Chip label={d.adequateSeizure ? 'Yes' : 'No'} size="small" sx={{
                        fontSize: 9, height: 18, bgcolor: d.adequateSeizure ? '#E8F5E9' : '#FDECEA',
                        color: d.adequateSeizure ? '#2E7D32' : '#D32F2F',
                      }} />
                    </TableCell>
                    <TableCell sx={{ fontSize: 10 }}>{d.anaestheticAgent ?? '—'} {d.anaestheticDose ?? ''}</TableCell>
                    <TableCell sx={{ fontSize: 10 }}>
                      {[d.headache && 'HA', d.nausea && 'N', d.confusion && 'C', d.memoryIssues && 'Mem'].filter(Boolean).join(', ') || 'None'}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </TableContainer>
      )}

      {/* Record Treatment Dialog */}
      {addOpen && (
        <Dialog open onClose={() => setAddOpen(false)} maxWidth="md" fullWidth>
          <DialogTitle sx={{ fontWeight: 700 }}>Record ECT Treatment #{form.treatmentNumber}</DialogTitle>
          <DialogContent>
            <Grid container spacing={2} sx={{ mt: 0.5 }}>
              {/* Pre-procedure */}
              <Grid size={12}><Divider><Typography variant="caption" fontWeight={600}>Pre-Procedure</Typography></Divider></Grid>
              <Grid size={{ xs: 6, sm: 2 }}>
                <TextField label="Treatment #" size="small" fullWidth value={form.treatmentNumber}
                  onChange={e => setForm(p => ({ ...p, treatmentNumber: e.target.value }))} />
              </Grid>
              <Grid size={{ xs: 6, sm: 2 }}>
                <TextField label="Date" type="date" size="small" fullWidth value={form.treatmentDate}
                  onChange={e => setForm(p => ({ ...p, treatmentDate: e.target.value }))} slotProps={{ inputLabel: { shrink: true } }} />
              </Grid>
              <Grid size={{ xs: 4, sm: 2 }}>
                <TextField label="BP Pre" size="small" fullWidth value={form.bpPre} onChange={e => setForm(p => ({ ...p, bpPre: e.target.value }))} placeholder="120/80" />
              </Grid>
              <Grid size={{ xs: 4, sm: 2 }}>
                <TextField label="HR Pre" size="small" fullWidth value={form.hrPre} onChange={e => setForm(p => ({ ...p, hrPre: e.target.value }))} placeholder="72" />
              </Grid>
              <Grid size={{ xs: 4, sm: 2 }}>
                <TextField label="SpO2 Pre" size="small" fullWidth value={form.spo2Pre} onChange={e => setForm(p => ({ ...p, spo2Pre: e.target.value }))} placeholder="98%" />
              </Grid>
              <Grid size={{ xs: 12, sm: 2 }}>
                <Box sx={{ display: 'flex', gap: 1 }}>
                  <FormControlLabel control={<Switch size="small" checked={form.fasting} onChange={(_, v) => setForm(p => ({ ...p, fasting: v }))} />} label={<Typography variant="caption">Fasted</Typography>} />
                  <FormControlLabel control={<Switch size="small" checked={form.consent} onChange={(_, v) => setForm(p => ({ ...p, consent: v }))} />} label={<Typography variant="caption">Consent</Typography>} />
                </Box>
              </Grid>

              {/* Stimulus */}
              <Grid size={12}><Divider><Typography variant="caption" fontWeight={600}>Stimulus Parameters</Typography></Divider></Grid>
              <Grid size={{ xs: 12, sm: 3 }}>
                <FormControl fullWidth size="small"><InputLabel>Placement</InputLabel>
                  <Select label="Placement" value={form.electrodePlacement} onChange={e => setForm(p => ({ ...p, electrodePlacement: e.target.value }))}>
                    {ELECTRODE_PLACEMENTS.map(p => <MenuItem key={p} value={p}>{p}</MenuItem>)}
                  </Select>
                </FormControl>
              </Grid>
              <Grid size={{ xs: 4, sm: 3 }}>
                <TextField label="Charge (mC)" size="small" fullWidth value={form.charge} onChange={e => setForm(p => ({ ...p, charge: e.target.value }))} />
              </Grid>
              <Grid size={{ xs: 4, sm: 3 }}>
                <TextField label="Frequency (Hz)" size="small" fullWidth value={form.frequency} onChange={e => setForm(p => ({ ...p, frequency: e.target.value }))} />
              </Grid>
              <Grid size={{ xs: 4, sm: 3 }}>
                <FormControl fullWidth size="small"><InputLabel>Pulse Width</InputLabel>
                  <Select label="Pulse Width" value={form.pulseWidth} onChange={e => setForm(p => ({ ...p, pulseWidth: e.target.value }))}>
                    {PULSE_WIDTHS.map(p => <MenuItem key={p} value={p}>{p}</MenuItem>)}
                  </Select>
                </FormControl>
              </Grid>

              {/* Anaesthesia */}
              <Grid size={12}><Divider><Typography variant="caption" fontWeight={600}>Anaesthesia</Typography></Divider></Grid>
              <Grid size={{ xs: 6, sm: 3 }}>
                <FormControl fullWidth size="small"><InputLabel>Agent</InputLabel>
                  <Select label="Agent" value={form.anaestheticAgent} onChange={e => setForm(p => ({ ...p, anaestheticAgent: e.target.value }))}>
                    {ANAESTHETIC_AGENTS.map(a => <MenuItem key={a} value={a}>{a}</MenuItem>)}
                  </Select>
                </FormControl>
              </Grid>
              <Grid size={{ xs: 6, sm: 3 }}>
                <TextField label="Dose (mg)" size="small" fullWidth value={form.anaestheticDose} onChange={e => setForm(p => ({ ...p, anaestheticDose: e.target.value }))} />
              </Grid>
              <Grid size={{ xs: 6, sm: 3 }}>
                <TextField label="Relaxant Dose (mg)" size="small" fullWidth value={form.muscleRelaxantDose} onChange={e => setForm(p => ({ ...p, muscleRelaxantDose: e.target.value }))} />
              </Grid>
              <Grid size={{ xs: 6, sm: 3 }}>
                <TextField label="Anticholinergic Dose" size="small" fullWidth value={form.anticholinergicDose} onChange={e => setForm(p => ({ ...p, anticholinergicDose: e.target.value }))} />
              </Grid>

              {/* Seizure */}
              <Grid size={12}><Divider><Typography variant="caption" fontWeight={600}>Seizure Response</Typography></Divider></Grid>
              <Grid size={{ xs: 4, sm: 3 }}>
                <TextField label="Motor (seconds)" size="small" fullWidth value={form.seizureDurationMotor} onChange={e => setForm(p => ({ ...p, seizureDurationMotor: e.target.value }))} />
              </Grid>
              <Grid size={{ xs: 4, sm: 3 }}>
                <TextField label="EEG (seconds)" size="small" fullWidth value={form.seizureDurationEeg} onChange={e => setForm(p => ({ ...p, seizureDurationEeg: e.target.value }))} />
              </Grid>
              <Grid size={{ xs: 4, sm: 3 }}>
                <FormControlLabel control={<Switch checked={form.adequateSeizure} onChange={(_, v) => setForm(p => ({ ...p, adequateSeizure: v }))} />}
                  label={<Typography variant="body2" fontWeight={600} sx={{ color: form.adequateSeizure ? '#2E7D32' : '#D32F2F' }}>
                    {form.adequateSeizure ? 'Adequate' : 'Inadequate'}
                  </Typography>} />
              </Grid>

              {/* Recovery */}
              <Grid size={12}><Divider><Typography variant="caption" fontWeight={600}>Recovery</Typography></Divider></Grid>
              <Grid size={{ xs: 4, sm: 2 }}>
                <TextField label="BP Post" size="small" fullWidth value={form.bpPost} onChange={e => setForm(p => ({ ...p, bpPost: e.target.value }))} />
              </Grid>
              <Grid size={{ xs: 4, sm: 2 }}>
                <TextField label="HR Post" size="small" fullWidth value={form.hrPost} onChange={e => setForm(p => ({ ...p, hrPost: e.target.value }))} />
              </Grid>
              <Grid size={{ xs: 4, sm: 2 }}>
                <TextField label="SpO2 Post" size="small" fullWidth value={form.spo2Post} onChange={e => setForm(p => ({ ...p, spo2Post: e.target.value }))} />
              </Grid>
              <Grid size={{ xs: 12, sm: 3 }}>
                <TextField label="Time to Orientation (min)" size="small" fullWidth value={form.timeToOrientation} onChange={e => setForm(p => ({ ...p, timeToOrientation: e.target.value }))} />
              </Grid>
              <Grid size={{ xs: 12, sm: 3 }}>
                <Box>
                  <Typography variant="caption" fontWeight={600}>Side Effects</Typography>
                  <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5 }}>
                    {([['headache', 'Headache'], ['nausea', 'Nausea'], ['confusion', 'Confusion'], ['memoryIssues', 'Memory']] as const).map(([key, label]) => (
                      <Chip key={key} label={label} size="small" onClick={() => setForm(p => ({ ...p, [key]: !p[key] }))}
                        sx={{ cursor: 'pointer', fontSize: 10, bgcolor: form[key] ? '#FDECEA' : '#eee', color: form[key] ? '#D32F2F' : '#555' }} />
                    ))}
                  </Box>
                </Box>
              </Grid>
              <Grid size={12}>
                <TextField label="Notes / Complications" size="small" fullWidth multiline rows={2} value={form.notes}
                  onChange={e => setForm(p => ({ ...p, notes: e.target.value }))} />
              </Grid>
            </Grid>
          </DialogContent>
          <DialogActions>
            <Button onClick={() => setAddOpen(false)}>Cancel</Button>
            <Button variant="contained" onClick={() => saveMut.mutate()} disabled={saveMut.isPending}
              sx={{ bgcolor: '#327C8D' }}>{saveMut.isPending ? 'Saving...' : 'Save Treatment'}</Button>
          </DialogActions>
        </Dialog>
      )}
    </Box>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
//  ECT Prescription
// ══════════════════════════════════════════════════════════════════════════════
interface EctPrescriptionPanelProps { patientId: string }
function EctPrescriptionPanel({ patientId }: EctPrescriptionPanelProps) {
  const qc = useQueryClient();
  const userRole = useAuthStore(s => s.user?.role);
  const [form, setForm] = useState({
    psychiatrist: '', indication: '', setting: 'inpatient' as string,
    electrodePlacement: 'Right Unilateral (RUL)',
    initialCharge: '', frequency: '3 per week', totalTreatments: '12',
    pulseWidth: 'Ultra-brief (0.3ms)', anaestheticAgent: 'Propofol',
    muscleRelaxant: 'Suxamethonium (Succinylcholine)', anticholinergic: 'Glycopyrrolate',
    medications_to_withhold: '', medications_to_continue: '',
    seizureThreshold: '', chargeAdjustment: 'Titrate from threshold',
    specialInstructions: '',
  });

  const saveMut = useMutation({
    mutationFn: () => apiClient.post('nursing-assessments', {
      patientId, assessmentType: 'ect_prescription',
      scores: form, totalScore: 0,
    }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ectKeys.prescription() }),
  });

  return (
    <Paper variant="outlined" sx={{ p: 3 }}>
      <Typography variant="h6" fontWeight={700} sx={{ mb: 2, display: 'flex', alignItems: 'center', gap: 1 }}>
        <DescriptionIcon sx={{ color: '#327C8D' }} /> ECT Prescription
      </Typography>

      <Grid container spacing={2}>
        <Grid size={12}><EctTmsRoleWorkflowNotice role={userRole} modality="ECT" /></Grid>
        <Grid size={{ xs: 12, sm: 4 }}>
          <TextField label="Treating Psychiatrist *" size="small" fullWidth value={form.psychiatrist}
            onChange={e => setForm(p => ({ ...p, psychiatrist: e.target.value }))} />
        </Grid>
        <Grid size={{ xs: 12, sm: 4 }}>
          <FormControl fullWidth size="small"><InputLabel>Indication *</InputLabel>
            <Select label="Indication *" value={form.indication} onChange={e => setForm(p => ({ ...p, indication: e.target.value }))}>
              {ECT_INDICATIONS.map(i => <MenuItem key={i} value={i}>{i}</MenuItem>)}
            </Select>
          </FormControl>
        </Grid>
        <Grid size={{ xs: 12, sm: 4 }}>
          <FormControl fullWidth size="small"><InputLabel>Setting *</InputLabel>
            <Select label="Setting *" value={form.setting} onChange={e => setForm(p => ({ ...p, setting: e.target.value }))}>
              <MenuItem value="inpatient">Inpatient</MenuItem>
              <MenuItem value="community">Community / Outpatient</MenuItem>
              <MenuItem value="day_program">Day Program</MenuItem>
            </Select>
          </FormControl>
        </Grid>
        <Grid size={{ xs: 12, sm: 4 }}>
          <FormControl fullWidth size="small"><InputLabel>Electrode Placement</InputLabel>
            <Select label="Electrode Placement" value={form.electrodePlacement} onChange={e => setForm(p => ({ ...p, electrodePlacement: e.target.value }))}>
              {ELECTRODE_PLACEMENTS.map(p => <MenuItem key={p} value={p}>{p}</MenuItem>)}
            </Select>
          </FormControl>
        </Grid>
        <Grid size={{ xs: 6, sm: 2 }}>
          <TextField label="Frequency" size="small" fullWidth value={form.frequency}
            onChange={e => setForm(p => ({ ...p, frequency: e.target.value }))} />
        </Grid>
        <Grid size={{ xs: 6, sm: 2 }}>
          <TextField label="Total Treatments" size="small" fullWidth value={form.totalTreatments}
            onChange={e => setForm(p => ({ ...p, totalTreatments: e.target.value }))} />
        </Grid>
        <Grid size={{ xs: 12, sm: 4 }}>
          <TextField label="Charge Adjustment Strategy" size="small" fullWidth value={form.chargeAdjustment}
            onChange={e => setForm(p => ({ ...p, chargeAdjustment: e.target.value }))} />
        </Grid>

        <Grid size={12}><Divider><Typography variant="caption">Medication Instructions</Typography></Divider></Grid>
        <Grid size={{ xs: 12, sm: 6 }}>
          <TextField label="Medications to Withhold on ECT Day" size="small" fullWidth multiline rows={2}
            value={form.medications_to_withhold} onChange={e => setForm(p => ({ ...p, medications_to_withhold: e.target.value }))}
            placeholder="e.g. Lithium (12hrs before), Benzodiazepines (night before)" />
        </Grid>
        <Grid size={{ xs: 12, sm: 6 }}>
          <TextField label="Medications to Continue" size="small" fullWidth multiline rows={2}
            value={form.medications_to_continue} onChange={e => setForm(p => ({ ...p, medications_to_continue: e.target.value }))}
            placeholder="e.g. Antihypertensives with sip of water" />
        </Grid>
        <Grid size={12}>
          <TextField label="Special Instructions" size="small" fullWidth multiline rows={2}
            value={form.specialInstructions} onChange={e => setForm(p => ({ ...p, specialInstructions: e.target.value }))} />
        </Grid>
      </Grid>

      <Box sx={{ mt: 2, display: 'flex', justifyContent: 'flex-end' }}>
        <Button variant="contained" onClick={() => saveMut.mutate()} disabled={!form.psychiatrist || !form.indication || saveMut.isPending}
          sx={{ bgcolor: '#327C8D', textTransform: 'none' }}>
          {saveMut.isPending ? 'Saving...' : 'Save Prescription'}
        </Button>
      </Box>
    </Paper>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
//  Consent & MHA Panel
// ══════════════════════════════════════════════════════════════════════════════
interface ConsentMhaPanelProps { patientId: string }
function ConsentMhaPanel({ patientId }: ConsentMhaPanelProps) {
  const qc = useQueryClient();
  const userRole = useAuthStore(s => s.user?.role);
  const [form, setForm] = useState({
    consentType: 'informed', consentDate: new Date().toISOString().slice(0, 10),
    consentedBy: '', witnessedBy: '', mhaOrderRequired: false, mhaOrderNumber: '',
    mhaAuthorisation: '', tribunalDate: '', secondOpinion: false, secondOpinionBy: '',
    capacityAssessed: true, capacityNotes: '',
    risksDiscussed: true, alternativesDiscussed: true,
  });

  const saveMut = useMutation({
    mutationFn: () => apiClient.post('nursing-assessments', {
      patientId, assessmentType: 'ect_consent',
      scores: form, totalScore: 0,
    }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ectKeys.consent() }),
  });

  return (
    <Paper variant="outlined" sx={{ p: 3 }}>
      <Typography variant="h6" fontWeight={700} sx={{ mb: 2 }}>
        <CheckCircleIcon sx={{ mr: 1, verticalAlign: 'middle', color: '#327C8D' }} />
        Consent & Mental Health Act
      </Typography>

      <Grid container spacing={2}>
        <Grid size={12}><EctTmsRoleWorkflowNotice role={userRole} modality="ECT" /></Grid>
        <Grid size={{ xs: 12, sm: 4 }}>
          <FormControl fullWidth size="small"><InputLabel>Consent Type</InputLabel>
            <Select label="Consent Type" value={form.consentType} onChange={e => setForm(p => ({ ...p, consentType: e.target.value }))}>
              <MenuItem value="informed">Informed Consent (Voluntary)</MenuItem>
              <MenuItem value="mha_involuntary">MHA — Involuntary Treatment</MenuItem>
              <MenuItem value="mha_cto">MHA — Community Treatment Order</MenuItem>
              <MenuItem value="guardian">Guardian/Admin Consent</MenuItem>
              <MenuItem value="emergency">Emergency (No Consent Available)</MenuItem>
            </Select>
          </FormControl>
        </Grid>
        <Grid size={{ xs: 6, sm: 4 }}>
          <TextField label="Consent Date" type="date" size="small" fullWidth value={form.consentDate}
            onChange={e => setForm(p => ({ ...p, consentDate: e.target.value }))} slotProps={{ inputLabel: { shrink: true } }} />
        </Grid>
        <Grid size={{ xs: 6, sm: 4 }}>
          <TextField label="Consented/Authorised By" size="small" fullWidth value={form.consentedBy}
            onChange={e => setForm(p => ({ ...p, consentedBy: e.target.value }))} />
        </Grid>

        <Grid size={12}>
          <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap' }}>
            <FormControlLabel control={<Switch size="small" checked={form.capacityAssessed} onChange={(_, v) => setForm(p => ({ ...p, capacityAssessed: v }))} />}
              label={<Typography variant="body2">Capacity Assessed</Typography>} />
            <FormControlLabel control={<Switch size="small" checked={form.risksDiscussed} onChange={(_, v) => setForm(p => ({ ...p, risksDiscussed: v }))} />}
              label={<Typography variant="body2">Risks Discussed</Typography>} />
            <FormControlLabel control={<Switch size="small" checked={form.alternativesDiscussed} onChange={(_, v) => setForm(p => ({ ...p, alternativesDiscussed: v }))} />}
              label={<Typography variant="body2">Alternatives Discussed</Typography>} />
          </Box>
        </Grid>

        {(form.consentType === 'mha_involuntary' || form.consentType === 'mha_cto') && (
          <>
            <Grid size={12}><Divider><Typography variant="caption" color="#D32F2F" fontWeight={600}>Mental Health Act Requirements</Typography></Divider></Grid>
            <Grid size={{ xs: 12, sm: 4 }}>
              <TextField label="MHA Order Number" size="small" fullWidth value={form.mhaOrderNumber}
                onChange={e => setForm(p => ({ ...p, mhaOrderNumber: e.target.value }))} />
            </Grid>
            <Grid size={{ xs: 12, sm: 4 }}>
              <TextField label="Authorised By (Authorised Psychiatrist)" size="small" fullWidth value={form.mhaAuthorisation}
                onChange={e => setForm(p => ({ ...p, mhaAuthorisation: e.target.value }))} />
            </Grid>
            <Grid size={{ xs: 12, sm: 4 }}>
              <TextField label="MHRT Hearing Date" type="date" size="small" fullWidth value={form.tribunalDate}
                onChange={e => setForm(p => ({ ...p, tribunalDate: e.target.value }))} slotProps={{ inputLabel: { shrink: true } }} />
            </Grid>
            <Grid size={12}>
              <FormControlLabel control={<Switch size="small" checked={form.secondOpinion} onChange={(_, v) => setForm(p => ({ ...p, secondOpinion: v }))} />}
                label={<Typography variant="body2">Second Psychiatric Opinion Obtained (required by MHA)</Typography>} />
            </Grid>
            {form.secondOpinion && (
              <Grid size={{ xs: 12, sm: 6 }}>
                <TextField label="Second Opinion Psychiatrist" size="small" fullWidth value={form.secondOpinionBy}
                  onChange={e => setForm(p => ({ ...p, secondOpinionBy: e.target.value }))} />
              </Grid>
            )}
            <Grid size={12}>
              <Alert role="alert" severity="warning" sx={{ fontSize: 11 }}>
                Under the Mental Health Act 2014 (Vic) / 2007 (NSW), ECT for involuntary patients requires:
                authorised psychiatrist approval, second opinion, MHRT notification, and capacity assessment.
              </Alert>
            </Grid>
          </>
        )}

        <Grid size={12}>
          <TextField label="Capacity Assessment Notes" size="small" fullWidth multiline rows={2}
            value={form.capacityNotes} onChange={e => setForm(p => ({ ...p, capacityNotes: e.target.value }))} />
        </Grid>
      </Grid>

      <Box sx={{ mt: 2, display: 'flex', justifyContent: 'flex-end' }}>
        <Button variant="contained" onClick={() => saveMut.mutate()} disabled={saveMut.isPending}
          sx={{ bgcolor: '#327C8D', textTransform: 'none' }}>
          {saveMut.isPending ? 'Saving...' : 'Save Consent Record'}
        </Button>
      </Box>
    </Paper>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
//  ECT Documents Panel
// ══════════════════════════════════════════════════════════════════════════════
interface EctDocumentsPanelProps { patientId: string }
function EctDocumentsPanel({ patientId }: EctDocumentsPanelProps) {
  const qc = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [docType, setDocType] = useState('consent-form');

  const { data, isLoading } = useQuery({
    queryKey: ectKeys.documents(patientId),
    queryFn: async () => {
      try {
        const r = await apiClient.get<EctDocumentsResponse | EctDocumentRow[]>(`patients/${patientId}/documents`, { category: 'ect' });
        return readList<EctDocumentRow>(r);
      } catch { return []; }
    },
  });
  const documents: EctDocumentRow[] = data ?? [];

  const DOC_TYPES = [
    { value: 'consent-form', label: 'Signed Consent Form' },
    { value: 'mha-order', label: 'MHA Order / Tribunal Decision' },
    { value: 'anaesthetic-assessment', label: 'Anaesthetic Pre-Assessment' },
    { value: 'second-opinion', label: 'Second Psychiatric Opinion' },
    { value: 'ecg', label: 'ECG Report' },
    { value: 'ct-brain', label: 'CT Brain Report' },
    { value: 'blood-results', label: 'Blood Results (FBC/UEC/LFT/TFT)' },
    { value: 'information-sheet', label: 'Patient Information Sheet (signed)' },
    { value: 'treatment-chart', label: 'Treatment Chart / Summary' },
    { value: 'correspondence', label: 'Correspondence (GP/Referrer)' },
    { value: 'other', label: 'Other' },
  ];

  const handleUpload = async (files: FileList | null) => {
    if (!files?.length) return;
    setUploading(true);
    for (const file of Array.from(files)) {
      const fd = new FormData();
      fd.append('file', file);
      fd.append('patientId', patientId);
      fd.append('category', 'ect');
      fd.append('documentType', docType);
      fd.append('title', `ECT — ${DOC_TYPES.find(d => d.value === docType)?.label ?? docType} — ${file.name}`);
      try {
        await apiClient.instance.post(`patients/${patientId}/attachments`, fd, {
          headers: { 'Content-Type': 'multipart/form-data' },
        });
      } catch (err: unknown) {
        alert(`Upload failed: ${getErrorMessage(err)}`);
      }
    }
    qc.invalidateQueries({ queryKey: ectKeys.documents() });
    setUploading(false);
    if (fileRef.current) fileRef.current.value = '';
  };

  const DOC_ICONS: Record<string, string> = {
    'consent-form': '📋', 'mha-order': '⚖️', 'anaesthetic-assessment': '💉',
    'second-opinion': '👨‍⚕️', 'ecg': '❤️', 'ct-brain': '🧠', 'blood-results': '🩸',
    'information-sheet': '📄', 'treatment-chart': '📊', 'correspondence': '✉️', 'other': '📎',
  };

  return (
    <Box>
      {/* Upload section */}
      <Paper variant="outlined" sx={{ p: 2.5, mb: 3 }}>
        <Typography variant="subtitle2" fontWeight={700} sx={{ mb: 2 }}>
          <UploadFileIcon sx={{ fontSize: 18, mr: 0.5, verticalAlign: 'middle', color: '#327C8D' }} />
          Upload ECT Document
        </Typography>
        <Box sx={{ display: 'flex', gap: 2, alignItems: 'flex-end', flexWrap: 'wrap' }}>
          <FormControl size="small" sx={{ minWidth: 250 }}>
            <InputLabel>Document Type</InputLabel>
            <Select label="Document Type" value={docType} onChange={e => setDocType(e.target.value)}>
              {DOC_TYPES.map(d => <MenuItem key={d.value} value={d.value}>{d.label}</MenuItem>)}
            </Select>
          </FormControl>
          <input ref={fileRef} type="file" multiple accept=".pdf,.jpg,.jpeg,.png,.doc,.docx"
            style={{ display: 'none' }} onChange={e => handleUpload(e.target.files)} />
          <Button variant="contained" startIcon={uploading ? <CircularProgress role="progressbar" aria-label="Loading" size={16} sx={{ color: '#fff' }} /> : <UploadFileIcon />}
            onClick={() => fileRef.current?.click()} disabled={uploading}
            sx={{ bgcolor: '#327C8D', textTransform: 'none', '&:hover': { bgcolor: '#265f6d' } }}>
            {uploading ? 'Uploading...' : 'Choose File'}
          </Button>
        </Box>
        <Typography variant="caption" color="text.secondary" sx={{ mt: 1, display: 'block' }}>
          Accepted formats: PDF, JPG, PNG, DOC, DOCX. Max 20MB per file.
        </Typography>
      </Paper>

      {/* Document list */}
      <Typography variant="subtitle2" fontWeight={700} sx={{ mb: 1.5 }}>ECT Documents</Typography>

      {isLoading && <CircularProgress role="progressbar" aria-label="Loading" size={24} />}

      {documents.length === 0 && !isLoading && (
        <Alert severity="info" sx={{ fontSize: 12 }}>
          No ECT documents uploaded. Upload signed consent forms, MHA orders, anaesthetic assessments, and investigation reports.
        </Alert>
      )}

      {documents.map((doc, i: number) => {
        const title = doc.title ?? doc.name ?? doc.fileName ?? 'Document';
        const dtype = doc.documentType ?? doc.document_type ?? doc.category ?? 'other';
        const uploaded = doc.createdAt ?? doc.createdAt ?? doc.uploadedAt;
        return (
          <Paper key={doc.id ?? i} variant="outlined" sx={{ p: 1.5, mb: 1, display: 'flex', alignItems: 'center', gap: 1.5 }}>
            <Typography sx={{ fontSize: 20 }}>{DOC_ICONS[dtype] ?? '📎'}</Typography>
            <Box sx={{ flex: 1 }}>
              <Typography variant="body2" fontWeight={600} sx={{ fontSize: 12 }}>{title}</Typography>
              <Typography variant="caption" color="text.secondary" sx={{ fontSize: 10 }}>
                {DOC_TYPES.find(d => d.value === dtype)?.label ?? dtype}
                {uploaded ? ` | ${new Date(uploaded).toLocaleDateString('en-AU')}` : ''}
              </Typography>
            </Box>
            <Tooltip title="Download">
              <IconButton size="small" aria-label="Download document" sx={{ color: '#327C8D' }}
                onClick={() => { window.open(`/api/v1/patients/${patientId}/documents/${doc.id}/download`, '_blank'); }}>
                <DownloadIcon sx={{ fontSize: 18 }} />
              </IconButton>
            </Tooltip>
          </Paper>
        );
      })}
    </Box>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
//  ECT Assessments — Cognitive, Pre/Post Nursing & Medical
// ══════════════════════════════════════════════════════════════════════════════
interface EctAssessmentsPanelProps { patientId: string }
function EctAssessmentsPanel({ patientId }: EctAssessmentsPanelProps) {
  const qc = useQueryClient();
  const [assessTab, setAssessTab] = useState<'cognitive' | 'pre-nursing' | 'post-nursing' | 'pre-medical' | 'post-medical'>('cognitive');
  const [saving, setSaving] = useState(false);

  const [cogForm, setCogForm] = useState({
    treatmentNumber: '', assessmentDate: new Date().toISOString().slice(0, 10),
    mmseScore: '', mocaScore: '', orientationScore: '',
    memoryComplaints: '', retrogradeAmnesia: false, anterogradeAmnesia: false,
    reorientationTime: '', cognitiveImpact: 'none', actionTaken: 'continue_unchanged', notes: '',
  });

  const [nursingForm, setNursingForm] = useState({
    phase: 'pre' as string, treatmentNumber: '', date: new Date().toISOString().slice(0, 10),
    bpSystolic: '', bpDiastolic: '', heartRate: '', spo2: '', respiratoryRate: '', temperature: '', bloodGlucose: '',
    fastingConfirmed: true, consentVerified: true, denturesRemoved: true, jewelleryRemoved: true,
    ivAccess: false, ivSite: '', medicationsWithheld: '', medicationsGiven: '',
    postConfusion: false, postHeadache: false, postNausea: false, postAgitation: false,
    fitForDischarge: false, escortArranged: false,
    notes: '',
  });

  const [medicalForm, setMedicalForm] = useState<EctMedicalForm>({
    phase: 'pre' as string, treatmentNumber: '', date: new Date().toISOString().slice(0, 10),
    clinicalPresentation: '', mseFindings: '', riskAssessment: '',
    treatmentResponse: '', sideEffects: '', planChanges: '',
    madrsScore: '', hamdScore: '', bprsScore: '', cgiSeverity: '', cgiImprovement: '',
    notes: '',
  });

  const saveAssessment = async (type: string, data: unknown) => {
    setSaving(true);
    try {
      await apiClient.post('nursing-assessments', {
        patientId, assessmentType: `ect_${type}`, scores: data, totalScore: 0,
      });
      qc.invalidateQueries({ queryKey: ectKeys.assessmentsAll() });
    } catch { /* */ }
    setSaving(false);
  };

  const { data: historyData } = useQuery({
    queryKey: ectKeys.assessments(patientId, assessTab),
    queryFn: () =>
      apiClient
        .get<NursingAssessmentsResponse | NursingAssessmentRow[]>('nursing-assessments', {
          patientId, assessmentType: `ect_${assessTab.replace('-', '_')}`, limit: 20,
        })
        .catch(() => ({ data: [] })),
  });
  const history = readList<NursingAssessmentRow>(historyData);

  return (
    <Box>
      <Tabs aria-label="Navigation tabs" value={assessTab} onChange={(_, v) => setAssessTab(v)} variant="scrollable" scrollButtons="auto"
        sx={{ mb: 2, '& .MuiTab-root': { textTransform: 'none', fontSize: 12 } }}>
        <Tab label="Cognitive" value="cognitive" />
        <Tab label="Pre-ECT Nursing" value="pre-nursing" />
        <Tab label="Post-ECT Nursing" value="post-nursing" />
        <Tab label="Pre-ECT Medical" value="pre-medical" />
        <Tab label="Post-ECT Medical" value="post-medical" />
      </Tabs>

      {/* Cognitive Assessment */}
      {assessTab === 'cognitive' && (
        <Paper variant="outlined" sx={{ p: 2.5 }}>
          <Typography variant="subtitle2" fontWeight={700} sx={{ mb: 2 }}>Cognitive Assessment</Typography>
          <Grid container spacing={2}>
            <Grid size={{ xs: 6, sm: 2 }}>
              <TextField label="Treatment #" size="small" fullWidth value={cogForm.treatmentNumber}
                onChange={e => setCogForm(p => ({ ...p, treatmentNumber: e.target.value }))} />
            </Grid>
            <Grid size={{ xs: 6, sm: 2 }}>
              <TextField label="Date" type="date" size="small" fullWidth value={cogForm.assessmentDate}
                onChange={e => setCogForm(p => ({ ...p, assessmentDate: e.target.value }))} slotProps={{ inputLabel: { shrink: true } }} />
            </Grid>
            <Grid size={{ xs: 4, sm: 2 }}>
              <TextField label="MMSE (0-30)" size="small" fullWidth type="number" value={cogForm.mmseScore}
                onChange={e => setCogForm(p => ({ ...p, mmseScore: e.target.value }))} />
            </Grid>
            <Grid size={{ xs: 4, sm: 2 }}>
              <TextField label="MoCA (0-30)" size="small" fullWidth type="number" value={cogForm.mocaScore}
                onChange={e => setCogForm(p => ({ ...p, mocaScore: e.target.value }))} />
            </Grid>
            <Grid size={{ xs: 4, sm: 2 }}>
              <TextField label="Reorientation (min)" size="small" fullWidth value={cogForm.reorientationTime}
                onChange={e => setCogForm(p => ({ ...p, reorientationTime: e.target.value }))} />
            </Grid>
            <Grid size={{ xs: 12, sm: 2 }}>
              <FormControl fullWidth size="small"><InputLabel>Impact</InputLabel>
                <Select label="Impact" value={cogForm.cognitiveImpact} onChange={e => setCogForm(p => ({ ...p, cognitiveImpact: e.target.value }))}>
                  {['none', 'mild', 'moderate', 'severe'].map(v => <MenuItem key={v} value={v} sx={{ textTransform: 'capitalize' }}>{v}</MenuItem>)}
                </Select>
              </FormControl>
            </Grid>
            <Grid size={12}>
              <Box sx={{ display: 'flex', gap: 1.5 }}>
                <FormControlLabel control={<Switch size="small" checked={cogForm.retrogradeAmnesia} onChange={(_, v) => setCogForm(p => ({ ...p, retrogradeAmnesia: v }))} />}
                  label={<Typography variant="body2" sx={{ fontSize: 12 }}>Retrograde Amnesia</Typography>} />
                <FormControlLabel control={<Switch size="small" checked={cogForm.anterogradeAmnesia} onChange={(_, v) => setCogForm(p => ({ ...p, anterogradeAmnesia: v }))} />}
                  label={<Typography variant="body2" sx={{ fontSize: 12 }}>Anterograde Amnesia</Typography>} />
              </Box>
            </Grid>
            <Grid size={{ xs: 12, sm: 6 }}>
              <TextField label="Memory Complaints" size="small" fullWidth multiline rows={2} value={cogForm.memoryComplaints}
                onChange={e => setCogForm(p => ({ ...p, memoryComplaints: e.target.value }))} />
            </Grid>
            <Grid size={{ xs: 12, sm: 6 }}>
              <TextField label="Notes" size="small" fullWidth multiline rows={2} value={cogForm.notes}
                onChange={e => setCogForm(p => ({ ...p, notes: e.target.value }))} />
            </Grid>
          </Grid>
          <Box sx={{ mt: 2, display: 'flex', justifyContent: 'flex-end' }}>
            <Button variant="contained" onClick={() => saveAssessment('cognitive', cogForm)} disabled={saving}
              sx={{ bgcolor: '#327C8D', textTransform: 'none' }}>{saving ? 'Saving...' : 'Save Cognitive Assessment'}</Button>
          </Box>

          {/* History */}
          {history.length > 0 && (
            <Box sx={{ mt: 3 }}>
              <Typography variant="subtitle2" fontWeight={600} sx={{ mb: 1 }}>Previous Assessments</Typography>
              {history.map((h, hi: number) => {
                const d = readAssessmentData<EctAssessmentHistoryData>(h);
                return (
                  <Accordion key={h.id ?? hi} variant="outlined" sx={{ mb: 0.5 }}>
                    <AccordionSummary expandIcon={<ExpandMoreIcon />}>
                      <Box sx={{ display: 'flex', gap: 2, alignItems: 'center', width: '100%' }}>
                        <Typography variant="body2" fontWeight={600} sx={{ fontSize: 12 }}>Treatment #{d.treatmentNumber ?? hi + 1}</Typography>
                        <Typography variant="caption" color="text.secondary">{d.assessmentDate ?? d.date ?? (h.assessmentDatetime ? new Date(h.assessmentDatetime).toLocaleDateString('en-AU') : '')}</Typography>
                        {d.mmseScore && <Chip label={`MMSE: ${d.mmseScore}`} size="small" sx={{ fontSize: 9, height: 18 }} />}
                        {d.mocaScore && <Chip label={`MoCA: ${d.mocaScore}`} size="small" sx={{ fontSize: 9, height: 18 }} />}
                      </Box>
                    </AccordionSummary>
                    <AccordionDetails>
                      <Grid container spacing={1}>
                        {d.mmseScore && <Grid size={{ xs: 4 }}><Typography variant="caption" color="text.secondary">MMSE</Typography><Typography variant="body2" fontWeight={600}>{d.mmseScore}</Typography></Grid>}
                        {d.mocaScore && <Grid size={{ xs: 4 }}><Typography variant="caption" color="text.secondary">MoCA</Typography><Typography variant="body2" fontWeight={600}>{d.mocaScore}</Typography></Grid>}
                        {d.reorientationTime && <Grid size={{ xs: 4 }}><Typography variant="caption" color="text.secondary">Reorientation Time</Typography><Typography variant="body2">{d.reorientationTime}</Typography></Grid>}
                        {d.memoryComplaints && <Grid size={{ xs: 4 }}><Typography variant="caption" color="text.secondary">Memory Complaints</Typography><Typography variant="body2">{d.memoryComplaints}</Typography></Grid>}
                        {d.retrogradeAmnesia && <Grid size={{ xs: 4 }}><Typography variant="caption" color="text.secondary">Retrograde Amnesia</Typography><Typography variant="body2">{d.retrogradeAmnesia}</Typography></Grid>}
                        {d.anterogradeAmnesia && <Grid size={{ xs: 4 }}><Typography variant="caption" color="text.secondary">Anterograde Amnesia</Typography><Typography variant="body2">{d.anterogradeAmnesia}</Typography></Grid>}
                        {d.cognitiveImpact && <Grid size={{ xs: 6 }}><Typography variant="caption" color="text.secondary">Cognitive Impact</Typography><Typography variant="body2">{d.cognitiveImpact}</Typography></Grid>}
                        {d.notes && <Grid size={{ xs: 12 }}><Typography variant="caption" color="text.secondary">Notes</Typography><Typography variant="body2" sx={{ whiteSpace: 'pre-wrap', fontSize: 11 }}>{d.notes}</Typography></Grid>}
                      </Grid>
                    </AccordionDetails>
                  </Accordion>
                );
              })}
            </Box>
          )}
        </Paper>
      )}

      {/* Pre/Post Nursing Assessment */}
      {(assessTab === 'pre-nursing' || assessTab === 'post-nursing') && (
        <Paper variant="outlined" sx={{ p: 2.5 }}>
          <Typography variant="subtitle2" fontWeight={700} sx={{ mb: 2 }}>
            {assessTab === 'pre-nursing' ? 'Pre-ECT' : 'Post-ECT'} Nursing Assessment
          </Typography>
          <Grid container spacing={2}>
            <Grid size={{ xs: 6, sm: 2 }}>
              <TextField label="Treatment #" size="small" fullWidth value={nursingForm.treatmentNumber}
                onChange={e => setNursingForm(p => ({ ...p, treatmentNumber: e.target.value }))} />
            </Grid>
            <Grid size={{ xs: 6, sm: 2 }}>
              <TextField label="Date" type="date" size="small" fullWidth value={nursingForm.date}
                onChange={e => setNursingForm(p => ({ ...p, date: e.target.value }))} slotProps={{ inputLabel: { shrink: true } }} />
            </Grid>
            <Grid size={{ xs: 4, sm: 2 }}>
              <TextField label="BP Systolic" size="small" fullWidth value={nursingForm.bpSystolic}
                onChange={e => setNursingForm(p => ({ ...p, bpSystolic: e.target.value }))} />
            </Grid>
            <Grid size={{ xs: 4, sm: 2 }}>
              <TextField label="BP Diastolic" size="small" fullWidth value={nursingForm.bpDiastolic}
                onChange={e => setNursingForm(p => ({ ...p, bpDiastolic: e.target.value }))} />
            </Grid>
            <Grid size={{ xs: 4, sm: 2 }}>
              <TextField label="HR" size="small" fullWidth value={nursingForm.heartRate}
                onChange={e => setNursingForm(p => ({ ...p, heartRate: e.target.value }))} />
            </Grid>
            <Grid size={{ xs: 4, sm: 2 }}>
              <TextField label="SpO2 %" size="small" fullWidth value={nursingForm.spo2}
                onChange={e => setNursingForm(p => ({ ...p, spo2: e.target.value }))} />
            </Grid>
            {assessTab === 'pre-nursing' && (
              <>
                <Grid size={12}>
                  <Box sx={{ display: 'flex', gap: 1.5, flexWrap: 'wrap' }}>
                    {([['fastingConfirmed', 'Fasting Confirmed'], ['consentVerified', 'Consent Verified'], ['denturesRemoved', 'Dentures Removed'], ['jewelleryRemoved', 'Jewellery Removed'], ['ivAccess', 'IV Access']] as const).map(([k, l]) => (
                      <FormControlLabel key={k} control={<Switch size="small" checked={nursingForm[k]} onChange={(_, v) => setNursingForm(p => ({ ...p, [k]: v }))} />}
                        label={<Typography variant="body2" sx={{ fontSize: 11 }}>{l}</Typography>} />
                    ))}
                  </Box>
                </Grid>
                <Grid size={{ xs: 12, sm: 6 }}>
                  <TextField label="Medications Withheld" size="small" fullWidth value={nursingForm.medicationsWithheld}
                    onChange={e => setNursingForm(p => ({ ...p, medicationsWithheld: e.target.value }))} />
                </Grid>
                <Grid size={{ xs: 12, sm: 6 }}>
                  <TextField label="Medications Given" size="small" fullWidth value={nursingForm.medicationsGiven}
                    onChange={e => setNursingForm(p => ({ ...p, medicationsGiven: e.target.value }))} />
                </Grid>
              </>
            )}
            {assessTab === 'post-nursing' && (
              <Grid size={12}>
                <Box sx={{ display: 'flex', gap: 1.5, flexWrap: 'wrap' }}>
                  {([['postConfusion', 'Confusion'], ['postHeadache', 'Headache'], ['postNausea', 'Nausea'], ['postAgitation', 'Agitation'], ['fitForDischarge', 'Fit for Discharge'], ['escortArranged', 'Escort Arranged']] as const).map(([k, l]) => (
                    <FormControlLabel key={k} control={<Switch size="small" checked={nursingForm[k]} onChange={(_, v) => setNursingForm(p => ({ ...p, [k]: v }))} />}
                      label={<Typography variant="body2" sx={{ fontSize: 11 }}>{l}</Typography>} />
                  ))}
                </Box>
              </Grid>
            )}
            <Grid size={12}>
              <TextField label="Nursing Notes" size="small" fullWidth multiline rows={3} value={nursingForm.notes}
                onChange={e => setNursingForm(p => ({ ...p, notes: e.target.value }))} />
            </Grid>
          </Grid>
          <Box sx={{ mt: 2, display: 'flex', justifyContent: 'flex-end' }}>
            <Button variant="contained" onClick={() => saveAssessment(assessTab.replace('-', '_'), { ...nursingForm, phase: assessTab.startsWith('pre') ? 'pre' : 'post' })} disabled={saving}
              sx={{ bgcolor: '#327C8D', textTransform: 'none' }}>{saving ? 'Saving...' : `Save ${assessTab === 'pre-nursing' ? 'Pre' : 'Post'}-ECT Nursing`}</Button>
          </Box>
        </Paper>
      )}

      {/* Pre/Post Medical Assessment */}
      {(assessTab === 'pre-medical' || assessTab === 'post-medical') && (
        <Paper variant="outlined" sx={{ p: 2.5 }}>
          <Typography variant="subtitle2" fontWeight={700} sx={{ mb: 2 }}>
            {assessTab === 'pre-medical' ? 'Pre-ECT' : 'Post-ECT'} Medical Assessment
          </Typography>
          <Grid container spacing={2}>
            <Grid size={{ xs: 6, sm: 2 }}>
              <TextField label="Treatment #" size="small" fullWidth value={medicalForm.treatmentNumber}
                onChange={e => setMedicalForm(p => ({ ...p, treatmentNumber: e.target.value }))} />
            </Grid>
            <Grid size={{ xs: 6, sm: 2 }}>
              <TextField label="Date" type="date" size="small" fullWidth value={medicalForm.date}
                onChange={e => setMedicalForm(p => ({ ...p, date: e.target.value }))} slotProps={{ inputLabel: { shrink: true } }} />
            </Grid>
            <Grid size={12}>
              <TextField label="Clinical Presentation" size="small" fullWidth multiline rows={2} value={medicalForm.clinicalPresentation}
                onChange={e => setMedicalForm(p => ({ ...p, clinicalPresentation: e.target.value }))} />
            </Grid>
            <Grid size={{ xs: 12, sm: 6 }}>
              <TextField label="MSE Findings" size="small" fullWidth multiline rows={2} value={medicalForm.mseFindings}
                onChange={e => setMedicalForm(p => ({ ...p, mseFindings: e.target.value }))} />
            </Grid>
            <Grid size={{ xs: 12, sm: 6 }}>
              <TextField label="Risk Assessment" size="small" fullWidth multiline rows={2} value={medicalForm.riskAssessment}
                onChange={e => setMedicalForm(p => ({ ...p, riskAssessment: e.target.value }))} />
            </Grid>
            {assessTab === 'post-medical' && (
              <>
                <Grid size={{ xs: 12, sm: 6 }}>
                  <TextField label="Treatment Response" size="small" fullWidth multiline rows={2} value={medicalForm.treatmentResponse}
                    onChange={e => setMedicalForm(p => ({ ...p, treatmentResponse: e.target.value }))} />
                </Grid>
                <Grid size={{ xs: 12, sm: 6 }}>
                  <TextField label="Side Effects" size="small" fullWidth multiline rows={2} value={medicalForm.sideEffects}
                    onChange={e => setMedicalForm(p => ({ ...p, sideEffects: e.target.value }))} />
                </Grid>
              </>
            )}
            <Grid size={12}><Divider><Typography variant="caption">Rating Scales</Typography></Divider></Grid>
            {MEDICAL_SCORE_FIELDS.map(({ key, label }) => (
              <Grid key={key} size={{ xs: 4, sm: 2 }}>
                <TextField
                  label={label}
                  size="small"
                  fullWidth
                  type="number"
                  value={medicalForm[key]}
                  onChange={(e) => setMedicalForm((p) => ({ ...p, [key]: e.target.value }))}
                />
              </Grid>
            ))}
            <Grid size={12}>
              <TextField label={`${assessTab === 'pre-medical' ? 'Pre' : 'Post'}-ECT Medical Notes`} size="small" fullWidth multiline rows={3}
                value={medicalForm.notes} onChange={e => setMedicalForm(p => ({ ...p, notes: e.target.value }))} />
            </Grid>
          </Grid>
          <Box sx={{ mt: 2, display: 'flex', justifyContent: 'flex-end' }}>
            <Button variant="contained" onClick={() => saveAssessment(assessTab.replace('-', '_'), { ...medicalForm, phase: assessTab.startsWith('pre') ? 'pre' : 'post' })} disabled={saving}
              sx={{ bgcolor: '#327C8D', textTransform: 'none' }}>{saving ? 'Saving...' : `Save ${assessTab === 'pre-medical' ? 'Pre' : 'Post'}-ECT Medical`}</Button>
          </Box>
        </Paper>
      )}

      {/* Assessment History */}
      {history.length > 0 && (
        <Paper variant="outlined" sx={{ p: 2, mt: 2 }}>
          <Typography variant="subtitle2" fontWeight={700} sx={{ mb: 1 }}>History ({history.length})</Typography>
          {history.map((h, i: number) => {
            const d = readAssessmentData<EctAssessmentHistoryData>(h);
            return (
            <Box key={h.id ?? i} sx={{ py: 0.75, borderBottom: '1px solid #eee', display: 'flex', justifyContent: 'space-between' }}>
              <Typography variant="body2" sx={{ fontSize: 11 }}>
                Tx #{d.treatmentNumber ?? '?'} — {h.assessmentDatetime ? new Date(h.assessmentDatetime).toLocaleDateString('en-AU') : ''}
              </Typography>
              <Typography variant="caption" color="text.secondary" sx={{ fontSize: 10 }}>
                {d.notes ?? ''}
              </Typography>
            </Box>
            );
          })}
        </Paper>
      )}
    </Box>
  );
}
