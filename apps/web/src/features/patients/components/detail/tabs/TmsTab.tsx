/**
 * TMS (Transcranial Magnetic Stimulation) Module
 * Similar structure to ECT but adapted for TMS-specific parameters.
 */
import AddIcon from '@mui/icons-material/Add';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import DescriptionIcon from '@mui/icons-material/Description';
import ElectricalServicesIcon from '@mui/icons-material/ElectricalServices';
import MonitorHeartIcon from '@mui/icons-material/MonitorHeart';
import {
    Alert, Box, Button, Chip, CircularProgress, Dialog, DialogActions,
    DialogContent, DialogTitle, Divider, FormControl, FormControlLabel, Grid, InputLabel,
    MenuItem, Paper, Select, Switch, Tab, Table, TableBody, TableCell, TableContainer,
    TableHead, TableRow, Tabs, TextField, Typography
} from '@mui/material';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  canApproveEctTmsForms,
  canCompleteEctTmsForms,
  requiresConsultantApprovalForEctTms,
} from '@signacare/shared';
import React, { useState } from 'react';
import LockIcon from '@mui/icons-material/Lock';
import { useAuthStore } from '../../../../../shared/store/authStore';
import { apiClient } from '../../../../../shared/services/apiClient';
import { tmsKeys } from '../../../queryKeys';

type TmsSubTab = 'course' | 'sessions' | 'prescription' | 'consent';

const TMS_PROTOCOLS = [
  'Standard rTMS (10 Hz, L-DLPFC)',
  'Deep TMS (H-coil)',
  'Intermittent Theta Burst (iTBS)',
  'Continuous Theta Burst (cTBS)',
  'Low-frequency rTMS (1 Hz, R-DLPFC)',
  'Bilateral rTMS',
  'Accelerated iTBS (Stanford SAINT)',
  'Custom Protocol',
];

const TMS_INDICATIONS = [
  'Treatment-resistant depression',
  'Major depressive disorder',
  'Obsessive-compulsive disorder',
  'PTSD',
  'Generalised anxiety disorder',
  'Chronic pain',
  'Smoking cessation',
  'Other',
];

const TMS_COIL_TYPES = ['Figure-8 coil', 'H-coil (Deep TMS)', 'Double cone coil', 'Circular coil'];
const TMS_TARGETS = ['Left DLPFC', 'Right DLPFC', 'Bilateral DLPFC', 'DMPFC', 'OFC', 'Custom target'];

type TmsAssessmentValue = string | number | boolean | null | undefined;

interface TmsAssessmentPayload {
  [key: string]: TmsAssessmentValue;
  protocol?: string;
  indication?: string;
  status?: string;
  targetSite?: string;
  totalSessions?: string | number;
  sessionNumber?: string | number;
  sessionDate?: string;
  intensity?: string | number;
  totalPulses?: string | number;
  tolerability?: string;
  phq9Post?: string | number;
  headache?: boolean;
  scalp_discomfort?: boolean;
  lightheadedness?: boolean;
}

interface TmsAssessmentRow {
  id?: string;
  assessmentData?: TmsAssessmentPayload | null;
  scores?: TmsAssessmentPayload | null;
  assessmentDatetime?: string;
}

interface NursingAssessmentsResponse {
  data?: TmsAssessmentRow[];
}

interface TmsTabProps { patientId: string }
export function TmsTab({ patientId }: TmsTabProps): React.ReactElement {
  const [selectedCourseId, setSelectedCourseId] = useState<string | null>(null);
  const [subTab, setSubTab] = useState<TmsSubTab>('course');

  const { data: coursesData } = useQuery({
    queryKey: tmsKeys.courses(patientId),
    queryFn: () =>
      apiClient
        .get<NursingAssessmentsResponse | TmsAssessmentRow[]>('nursing-assessments', { patientId, assessmentType: 'tms_course', limit: 20 })
        .catch(() => ({ data: [] })),
  });
  const courses: TmsAssessmentRow[] = Array.isArray(coursesData) ? coursesData : coursesData?.data ?? [];
  const activeCourse = selectedCourseId ? courses.find((c) => c.id === selectedCourseId) : courses[0];
  const courseId = activeCourse?.id ?? '';

  return (
    <Box>
      {/* Course selector */}
      <Box sx={{ display: 'flex', gap: 1.5, mb: 2, alignItems: 'center', flexWrap: 'wrap' }}>
        <ElectricalServicesIcon sx={{ color: '#1565C0', fontSize: 24 }} />
        <Typography variant="subtitle1" fontWeight={700} fontFamily="Albert Sans, sans-serif">TMS</Typography>
        {courses.length > 0 && (
          <FormControl size="small" sx={{ minWidth: 220 }}>
            <Select value={courseId} onChange={e => setSelectedCourseId(e.target.value)} displayEmpty sx={{ fontSize: 12 }}>
              {courses.map((c, i: number) => {
                const d = c.assessmentData ?? c.scores ?? {};
                return <MenuItem key={c.id} value={c.id} sx={{ fontSize: 12 }}>
                  Course {courses.length - i}: {d.protocol ?? d.indication ?? 'TMS'} ({d.status ?? 'active'})
                </MenuItem>;
              })}
            </Select>
          </FormControl>
        )}
      </Box>

      <Tabs aria-label="Navigation tabs" value={subTab} onChange={(_, v) => setSubTab(v)} variant="scrollable" scrollButtons="auto"
        sx={{ mb: 2, '& .MuiTab-root': { textTransform: 'none', fontFamily: 'Albert Sans, sans-serif', fontSize: 13 } }}>
        <Tab icon={<ElectricalServicesIcon sx={{ fontSize: 16 }} />} iconPosition="start" label="TMS Courses" value="course" />
        <Tab icon={<MonitorHeartIcon sx={{ fontSize: 16 }} />} iconPosition="start" label="Session Log" value="sessions" disabled={!courseId} />
        <Tab icon={<DescriptionIcon sx={{ fontSize: 16 }} />} iconPosition="start" label="Prescription" value="prescription" disabled={!courseId} />
        <Tab icon={<CheckCircleIcon sx={{ fontSize: 16 }} />} iconPosition="start" label="Consent" value="consent" disabled={!courseId} />
      </Tabs>

      {subTab === 'course' && <TmsCoursePanel patientId={patientId} />}
      {subTab === 'sessions' && courseId && <TmsSessionLogPanel patientId={patientId} />}
      {subTab === 'prescription' && courseId && <TmsPrescriptionPanel patientId={patientId} />}
      {subTab === 'consent' && courseId && <TmsConsentPanel patientId={patientId} />}
    </Box>
  );
}

// ── TMS Course ──
interface TmsCoursePanelProps { patientId: string }
function TmsCoursePanel({ patientId }: TmsCoursePanelProps) {
  const qc = useQueryClient();
  const [addOpen, setAddOpen] = useState(false);
  const { data, isLoading } = useQuery({
    queryKey: tmsKeys.courses(patientId),
    queryFn: () =>
      apiClient
        .get<NursingAssessmentsResponse | TmsAssessmentRow[]>('nursing-assessments', { patientId, assessmentType: 'tms_course', limit: 20 })
        .catch(() => ({ data: [] })),
  });
  const courses: TmsAssessmentRow[] = Array.isArray(data) ? data : data?.data ?? [];

  const [form, setForm] = useState({
    indication: '', protocol: 'Standard rTMS (10 Hz, L-DLPFC)',
    coilType: 'Figure-8 coil', targetSite: 'Left DLPFC',
    totalSessions: '20', frequency: 'daily_weekdays',
    motorThreshold: '', stimulationIntensity: '120',
    pulsesPerSession: '3000', trainDuration: '', interTrainInterval: '',
    psychiatrist: '', notes: '',
  });

  const saveMut = useMutation({
    mutationFn: () => apiClient.post('nursing-assessments', {
      patientId, assessmentType: 'tms_course',
      scores: { ...form, status: 'active' }, totalScore: 0, riskLevel: 'active',
    }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: tmsKeys.coursesAll() }); setAddOpen(false); },
  });

  return (
    <Box>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
        <Typography variant="h6" fontWeight={600}>TMS Courses</Typography>
        <Button startIcon={<AddIcon />} variant="contained" size="small" onClick={() => setAddOpen(true)}
          sx={{ bgcolor: '#1565C0', textTransform: 'none' }}>New TMS Course</Button>
      </Box>

      {isLoading && <CircularProgress role="progressbar" aria-label="Loading" size={24} />}
      {courses.length === 0 && !isLoading && <Alert severity="info">No TMS courses recorded.</Alert>}

      {courses.map((c, i: number) => {
        const d = c.assessmentData ?? c.scores ?? {};
        return (
          <Paper key={c.id ?? i} variant="outlined" sx={{ p: 2.5, mb: 2, borderLeft: '4px solid #1565C0' }}>
            <Grid container spacing={2}>
              <Grid size={{ xs: 12, sm: 4 }}>
                <Typography variant="subtitle2" fontWeight={700}>Course #{courses.length - i}</Typography>
                <Typography variant="caption" color="text.secondary">{c.assessmentDatetime ? new Date(c.assessmentDatetime).toLocaleDateString('en-AU') : ''}</Typography>
              </Grid>
              <Grid size={{ xs: 6, sm: 2 }}><Typography variant="caption" fontWeight={600}>Protocol</Typography><Typography variant="body2" sx={{ fontSize: 12 }}>{d.protocol ?? '—'}</Typography></Grid>
              <Grid size={{ xs: 6, sm: 2 }}><Typography variant="caption" fontWeight={600}>Target</Typography><Typography variant="body2" sx={{ fontSize: 12 }}>{d.targetSite ?? '—'}</Typography></Grid>
              <Grid size={{ xs: 6, sm: 2 }}><Typography variant="caption" fontWeight={600}>Sessions</Typography><Typography variant="body2" sx={{ fontSize: 12 }}>{d.totalSessions ?? '—'}</Typography></Grid>
              <Grid size={{ xs: 6, sm: 2 }}><Chip label={d.status ?? 'active'} size="small" sx={{ textTransform: 'capitalize', fontSize: 10, bgcolor: '#E3F2FD', color: '#1565C0' }} /></Grid>
            </Grid>
          </Paper>
        );
      })}

      {/* New Course Dialog */}
      {addOpen && (
        <Dialog open onClose={() => setAddOpen(false)} maxWidth="md" fullWidth>
          <DialogTitle sx={{ fontWeight: 700 }}><ElectricalServicesIcon sx={{ mr: 1, verticalAlign: 'middle', color: '#1565C0' }} />New TMS Course</DialogTitle>
          <DialogContent>
            <Grid container spacing={2} sx={{ mt: 0.5 }}>
              <Grid size={{ xs: 12, sm: 6 }}>
                <FormControl fullWidth size="small"><InputLabel>Indication *</InputLabel>
                  <Select label="Indication *" value={form.indication} onChange={e => setForm(p => ({ ...p, indication: e.target.value }))}>
                    {TMS_INDICATIONS.map(i => <MenuItem key={i} value={i}>{i}</MenuItem>)}
                  </Select>
                </FormControl>
              </Grid>
              <Grid size={{ xs: 12, sm: 6 }}>
                <FormControl fullWidth size="small"><InputLabel>Protocol *</InputLabel>
                  <Select label="Protocol *" value={form.protocol} onChange={e => setForm(p => ({ ...p, protocol: e.target.value }))}>
                    {TMS_PROTOCOLS.map(pr => <MenuItem key={pr} value={pr}>{pr}</MenuItem>)}
                  </Select>
                </FormControl>
              </Grid>
              <Grid size={{ xs: 12, sm: 4 }}>
                <FormControl fullWidth size="small"><InputLabel>Coil Type</InputLabel>
                  <Select label="Coil Type" value={form.coilType} onChange={e => setForm(p => ({ ...p, coilType: e.target.value }))}>
                    {TMS_COIL_TYPES.map(c => <MenuItem key={c} value={c}>{c}</MenuItem>)}
                  </Select>
                </FormControl>
              </Grid>
              <Grid size={{ xs: 12, sm: 4 }}>
                <FormControl fullWidth size="small"><InputLabel>Target Site</InputLabel>
                  <Select label="Target Site" value={form.targetSite} onChange={e => setForm(p => ({ ...p, targetSite: e.target.value }))}>
                    {TMS_TARGETS.map(t => <MenuItem key={t} value={t}>{t}</MenuItem>)}
                  </Select>
                </FormControl>
              </Grid>
              <Grid size={{ xs: 6, sm: 2 }}>
                <TextField label="Total Sessions" size="small" fullWidth type="number" value={form.totalSessions}
                  onChange={e => setForm(p => ({ ...p, totalSessions: e.target.value }))} />
              </Grid>
              <Grid size={{ xs: 6, sm: 2 }}>
                <FormControl fullWidth size="small"><InputLabel>Frequency</InputLabel>
                  <Select label="Frequency" value={form.frequency} onChange={e => setForm(p => ({ ...p, frequency: e.target.value }))}>
                    <MenuItem value="daily_weekdays">Daily (weekdays)</MenuItem>
                    <MenuItem value="3_per_week">3× per week</MenuItem>
                    <MenuItem value="accelerated">Accelerated (multiple/day)</MenuItem>
                  </Select>
                </FormControl>
              </Grid>
              <Grid size={12}><Divider><Typography variant="caption">Stimulation Parameters</Typography></Divider></Grid>
              <Grid size={{ xs: 4, sm: 2 }}>
                <TextField label="Motor Threshold (%)" size="small" fullWidth value={form.motorThreshold}
                  onChange={e => setForm(p => ({ ...p, motorThreshold: e.target.value }))} />
              </Grid>
              <Grid size={{ xs: 4, sm: 2 }}>
                <TextField label="Intensity (% MT)" size="small" fullWidth value={form.stimulationIntensity}
                  onChange={e => setForm(p => ({ ...p, stimulationIntensity: e.target.value }))} />
              </Grid>
              <Grid size={{ xs: 4, sm: 2 }}>
                <TextField label="Pulses/Session" size="small" fullWidth value={form.pulsesPerSession}
                  onChange={e => setForm(p => ({ ...p, pulsesPerSession: e.target.value }))} />
              </Grid>
              <Grid size={{ xs: 6, sm: 3 }}>
                <TextField label="Train Duration (s)" size="small" fullWidth value={form.trainDuration}
                  onChange={e => setForm(p => ({ ...p, trainDuration: e.target.value }))} />
              </Grid>
              <Grid size={{ xs: 6, sm: 3 }}>
                <TextField label="Inter-train Interval (s)" size="small" fullWidth value={form.interTrainInterval}
                  onChange={e => setForm(p => ({ ...p, interTrainInterval: e.target.value }))} />
              </Grid>
              <Grid size={{ xs: 12, sm: 6 }}>
                <TextField label="Treating Psychiatrist" size="small" fullWidth value={form.psychiatrist}
                  onChange={e => setForm(p => ({ ...p, psychiatrist: e.target.value }))} />
              </Grid>
              <Grid size={{ xs: 12, sm: 6 }}>
                <TextField label="Notes" size="small" fullWidth value={form.notes}
                  onChange={e => setForm(p => ({ ...p, notes: e.target.value }))} />
              </Grid>
            </Grid>
          </DialogContent>
          <DialogActions>
            <Button onClick={() => setAddOpen(false)}>Cancel</Button>
            <Button variant="contained" onClick={() => saveMut.mutate()} disabled={!form.indication || saveMut.isPending}
              sx={{ bgcolor: '#1565C0' }}>{saveMut.isPending ? 'Saving...' : 'Create Course'}</Button>
          </DialogActions>
        </Dialog>
      )}
    </Box>
  );
}

// ── TMS Session Log ──
interface TmsSessionLogPanelProps { patientId: string }
function TmsSessionLogPanel({ patientId }: TmsSessionLogPanelProps) {
  const qc = useQueryClient();
  const [addOpen, setAddOpen] = useState(false);
  const { data, isLoading } = useQuery({
    queryKey: tmsKeys.sessions(patientId),
    queryFn: () =>
      apiClient
        .get<NursingAssessmentsResponse | TmsAssessmentRow[]>('nursing-assessments', { patientId, assessmentType: 'tms_session', limit: 50 })
        .catch(() => ({ data: [] })),
  });
  const sessions: TmsAssessmentRow[] = Array.isArray(data) ? data : data?.data ?? [];

  const [form, setForm] = useState({
    sessionNumber: String(sessions.length + 1), sessionDate: new Date().toISOString().slice(0, 10),
    motorThreshold: '', intensity: '', totalPulses: '', coilPosition: '',
    sideEffects: '', headache: false, scalp_discomfort: false, lightheadedness: false,
    phq9Pre: '', phq9Post: '', tolerability: 'good', notes: '',
  });

  const saveMut = useMutation({
    mutationFn: () => apiClient.post('nursing-assessments', {
      patientId, assessmentType: 'tms_session',
      scores: form, totalScore: parseInt(form.sessionNumber, 10) || 0,
    }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: tmsKeys.sessionsAll() }); setAddOpen(false); },
  });

  return (
    <Box>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
        <Typography variant="h6" fontWeight={600}>Session Log ({sessions.length})</Typography>
        <Button startIcon={<AddIcon />} variant="contained" size="small"
          onClick={() => { setForm(f => ({ ...f, sessionNumber: String(sessions.length + 1) })); setAddOpen(true); }}
          sx={{ bgcolor: '#1565C0', textTransform: 'none' }}>Record Session</Button>
      </Box>

      {isLoading && <CircularProgress role="progressbar" aria-label="Loading" size={24} />}
      {sessions.length > 0 && (
        <TableContainer role="region" aria-label="Data table" component={Paper} variant="outlined">
          <Table size="small">
            <TableHead><TableRow sx={{ bgcolor: '#E3F2FD' }}>
              {['#', 'Date', 'Intensity', 'Pulses', 'Tolerability', 'PHQ-9', 'Side Effects'].map(h => (
                <TableCell key={h} sx={{ fontWeight: 700, fontSize: 10 }}>{h}</TableCell>
              ))}
            </TableRow></TableHead>
            <TableBody>
              {sessions.map((s, i: number) => {
                const d = s.assessmentData ?? s.scores ?? {};
                return (
                  <TableRow key={s.id ?? i}>
                    <TableCell sx={{ fontWeight: 700, fontSize: 11 }}>{d.sessionNumber ?? sessions.length - i}</TableCell>
                    <TableCell sx={{ fontSize: 11 }}>{d.sessionDate ?? (s.assessmentDatetime ? new Date(s.assessmentDatetime).toLocaleDateString('en-AU') : '')}</TableCell>
                    <TableCell sx={{ fontSize: 11 }}>{d.intensity ? `${d.intensity}% MT` : '—'}</TableCell>
                    <TableCell sx={{ fontSize: 11 }}>{d.totalPulses ?? '—'}</TableCell>
                    <TableCell><Chip label={d.tolerability ?? 'good'} size="small" sx={{ fontSize: 9, height: 18, textTransform: 'capitalize',
                      bgcolor: d.tolerability === 'poor' ? '#FDECEA' : d.tolerability === 'moderate' ? '#FFF3E0' : '#E8F5E9',
                      color: d.tolerability === 'poor' ? '#D32F2F' : d.tolerability === 'moderate' ? '#b8621a' : '#2E7D32',
                    }} /></TableCell>
                    <TableCell sx={{ fontSize: 11 }}>{d.phq9Post ?? '—'}</TableCell>
                    <TableCell sx={{ fontSize: 10 }}>
                      {[d.headache && 'HA', d.scalp_discomfort && 'Scalp', d.lightheadedness && 'Dizzy'].filter(Boolean).join(', ') || 'None'}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </TableContainer>
      )}

      {addOpen && (
        <Dialog open onClose={() => setAddOpen(false)} maxWidth="sm" fullWidth>
          <DialogTitle sx={{ fontWeight: 700 }}>Record TMS Session #{form.sessionNumber}</DialogTitle>
          <DialogContent>
            <Grid container spacing={2} sx={{ mt: 0.5 }}>
              <Grid size={{ xs: 6, sm: 3 }}><TextField label="Session #" size="small" fullWidth value={form.sessionNumber} onChange={e => setForm(p => ({ ...p, sessionNumber: e.target.value }))} /></Grid>
              <Grid size={{ xs: 6, sm: 3 }}><TextField label="Date" type="date" size="small" fullWidth value={form.sessionDate} onChange={e => setForm(p => ({ ...p, sessionDate: e.target.value }))} slotProps={{ inputLabel: { shrink: true } }} /></Grid>
              <Grid size={{ xs: 4, sm: 2 }}><TextField label="MT (%)" size="small" fullWidth value={form.motorThreshold} onChange={e => setForm(p => ({ ...p, motorThreshold: e.target.value }))} /></Grid>
              <Grid size={{ xs: 4, sm: 2 }}><TextField label="Intensity (%MT)" size="small" fullWidth value={form.intensity} onChange={e => setForm(p => ({ ...p, intensity: e.target.value }))} /></Grid>
              <Grid size={{ xs: 4, sm: 2 }}><TextField label="Total Pulses" size="small" fullWidth value={form.totalPulses} onChange={e => setForm(p => ({ ...p, totalPulses: e.target.value }))} /></Grid>
              <Grid size={12}>
                <Typography variant="caption" fontWeight={600}>Side Effects</Typography>
                <Box sx={{ display: 'flex', gap: 1, mt: 0.5 }}>
                  {([['headache', 'Headache'], ['scalp_discomfort', 'Scalp Discomfort'], ['lightheadedness', 'Lightheadedness']] as const).map(([k, l]) => (
                    <Chip key={k} label={l} size="small" onClick={() => setForm(p => ({ ...p, [k]: !p[k] }))}
                      sx={{ cursor: 'pointer', fontSize: 10, bgcolor: form[k] ? '#FDECEA' : '#eee', color: form[k] ? '#D32F2F' : '#555' }} />
                  ))}
                </Box>
              </Grid>
              <Grid size={{ xs: 6, sm: 4 }}><TextField label="PHQ-9 (pre)" size="small" fullWidth type="number" value={form.phq9Pre} onChange={e => setForm(p => ({ ...p, phq9Pre: e.target.value }))} /></Grid>
              <Grid size={{ xs: 6, sm: 4 }}><TextField label="PHQ-9 (post)" size="small" fullWidth type="number" value={form.phq9Post} onChange={e => setForm(p => ({ ...p, phq9Post: e.target.value }))} /></Grid>
              <Grid size={{ xs: 12, sm: 4 }}>
                <FormControl fullWidth size="small"><InputLabel>Tolerability</InputLabel>
                  <Select label="Tolerability" value={form.tolerability} onChange={e => setForm(p => ({ ...p, tolerability: e.target.value }))}>
                    <MenuItem value="good">Good</MenuItem><MenuItem value="moderate">Moderate</MenuItem><MenuItem value="poor">Poor</MenuItem>
                  </Select>
                </FormControl>
              </Grid>
              <Grid size={12}><TextField label="Notes" size="small" fullWidth multiline rows={2} value={form.notes} onChange={e => setForm(p => ({ ...p, notes: e.target.value }))} /></Grid>
            </Grid>
          </DialogContent>
          <DialogActions>
            <Button onClick={() => setAddOpen(false)}>Cancel</Button>
            <Button variant="contained" onClick={() => saveMut.mutate()} disabled={saveMut.isPending}
              sx={{ bgcolor: '#1565C0' }}>{saveMut.isPending ? 'Saving...' : 'Save Session'}</Button>
          </DialogActions>
        </Dialog>
      )}
    </Box>
  );
}

// ── TMS Prescription ──
interface TmsPrescriptionPanelProps { patientId: string }
function TmsPrescriptionPanel({ patientId }: TmsPrescriptionPanelProps) {
  const qc = useQueryClient();
  const userRole = useAuthStore(s => s.user?.role);
  const [form, setForm] = useState({
    psychiatrist: '', indication: '', protocol: 'Standard rTMS (10 Hz, L-DLPFC)',
    targetSite: 'Left DLPFC', coilType: 'Figure-8 coil',
    motorThresholdMethod: 'Visual observation', stimulationIntensity: '120',
    pulsesPerSession: '3000', sessionsPerWeek: '5', totalSessions: '20',
    specialInstructions: '',
  });
  const saveMut = useMutation({
    mutationFn: () => apiClient.post('nursing-assessments', { patientId, assessmentType: 'tms_prescription', scores: form, totalScore: 0 }),
    onSuccess: () => qc.invalidateQueries({ queryKey: tmsKeys.prescriptionAll() }),
  });

  if (!canCompleteEctTmsForms(userRole)) {
    return (
      <Alert severity="warning" icon={<LockIcon />}>
        TMS forms can only be completed by psychiatry prescriber roles.
      </Alert>
    );
  }

  return (
    <Paper variant="outlined" sx={{ p: 3 }}>
      <Typography variant="h6" fontWeight={700} sx={{ mb: 2 }}><DescriptionIcon sx={{ mr: 1, verticalAlign: 'middle', color: '#1565C0' }} />TMS Prescription</Typography>
      <Grid container spacing={2}>
        {requiresConsultantApprovalForEctTms(userRole) && (
          <Grid size={12}>
            <Alert severity="info">
              This TMS prescription will save as pending consultant approval.
            </Alert>
          </Grid>
        )}
        {canApproveEctTmsForms(userRole) && (
          <Grid size={12}>
            <Alert severity="success">
              You are signed in as a prescriber consultant. Saving this TMS prescription records consultant approval immediately.
            </Alert>
          </Grid>
        )}
        <Grid size={{ xs: 12, sm: 4 }}><TextField label="Treating Psychiatrist *" size="small" fullWidth value={form.psychiatrist} onChange={e => setForm(p => ({ ...p, psychiatrist: e.target.value }))} /></Grid>
        <Grid size={{ xs: 12, sm: 4 }}>
          <FormControl fullWidth size="small"><InputLabel>Indication *</InputLabel>
            <Select label="Indication *" value={form.indication} onChange={e => setForm(p => ({ ...p, indication: e.target.value }))}>
              {TMS_INDICATIONS.map(i => <MenuItem key={i} value={i}>{i}</MenuItem>)}
            </Select>
          </FormControl>
        </Grid>
        <Grid size={{ xs: 12, sm: 4 }}>
          <FormControl fullWidth size="small"><InputLabel>Protocol</InputLabel>
            <Select label="Protocol" value={form.protocol} onChange={e => setForm(p => ({ ...p, protocol: e.target.value }))}>
              {TMS_PROTOCOLS.map(pr => <MenuItem key={pr} value={pr}>{pr}</MenuItem>)}
            </Select>
          </FormControl>
        </Grid>
        <Grid size={{ xs: 6, sm: 3 }}><TextField label="Intensity (% MT)" size="small" fullWidth value={form.stimulationIntensity} onChange={e => setForm(p => ({ ...p, stimulationIntensity: e.target.value }))} /></Grid>
        <Grid size={{ xs: 6, sm: 3 }}><TextField label="Pulses/Session" size="small" fullWidth value={form.pulsesPerSession} onChange={e => setForm(p => ({ ...p, pulsesPerSession: e.target.value }))} /></Grid>
        <Grid size={{ xs: 6, sm: 3 }}><TextField label="Sessions/Week" size="small" fullWidth value={form.sessionsPerWeek} onChange={e => setForm(p => ({ ...p, sessionsPerWeek: e.target.value }))} /></Grid>
        <Grid size={{ xs: 6, sm: 3 }}><TextField label="Total Sessions" size="small" fullWidth value={form.totalSessions} onChange={e => setForm(p => ({ ...p, totalSessions: e.target.value }))} /></Grid>
        <Grid size={12}><TextField label="Special Instructions" size="small" fullWidth multiline rows={2} value={form.specialInstructions} onChange={e => setForm(p => ({ ...p, specialInstructions: e.target.value }))} /></Grid>
      </Grid>
      <Box sx={{ mt: 2, display: 'flex', justifyContent: 'flex-end' }}>
        <Button variant="contained" onClick={() => saveMut.mutate()} disabled={!form.psychiatrist || !form.indication || saveMut.isPending}
          sx={{ bgcolor: '#1565C0', textTransform: 'none' }}>{saveMut.isPending ? 'Saving...' : 'Save Prescription'}</Button>
      </Box>
    </Paper>
  );
}

// ── TMS Consent ──
interface TmsConsentPanelProps { patientId: string }
function TmsConsentPanel({ patientId }: TmsConsentPanelProps) {
  const qc = useQueryClient();
  const userRole = useAuthStore(s => s.user?.role);
  const [form, setForm] = useState({
    consentDate: new Date().toISOString().slice(0, 10),
    consentedBy: '', risksExplained: true, benefitsExplained: true,
    alternativesDiscussed: true, seizureRiskDiscussed: true,
    contraindications_checked: true, notes: '',
  });
  const saveMut = useMutation({
    mutationFn: () => apiClient.post('nursing-assessments', { patientId, assessmentType: 'tms_consent', scores: form, totalScore: 0 }),
    onSuccess: () => qc.invalidateQueries({ queryKey: tmsKeys.consentAll() }),
  });

  if (!canCompleteEctTmsForms(userRole)) {
    return (
      <Alert severity="warning" icon={<LockIcon />}>
        TMS consent forms can only be completed by psychiatry prescriber roles.
      </Alert>
    );
  }

  return (
    <Paper variant="outlined" sx={{ p: 3 }}>
      <Typography variant="h6" fontWeight={700} sx={{ mb: 2 }}><CheckCircleIcon sx={{ mr: 1, verticalAlign: 'middle', color: '#1565C0' }} />TMS Consent</Typography>
      <Grid container spacing={2}>
        {requiresConsultantApprovalForEctTms(userRole) && (
          <Grid size={12}>
            <Alert severity="info">
              This TMS consent record will save as pending consultant approval.
            </Alert>
          </Grid>
        )}
        <Grid size={{ xs: 12, sm: 4 }}><TextField label="Consent Date" type="date" size="small" fullWidth value={form.consentDate} onChange={e => setForm(p => ({ ...p, consentDate: e.target.value }))} slotProps={{ inputLabel: { shrink: true } }} /></Grid>
        <Grid size={{ xs: 12, sm: 4 }}><TextField label="Consented By" size="small" fullWidth value={form.consentedBy} onChange={e => setForm(p => ({ ...p, consentedBy: e.target.value }))} /></Grid>
        <Grid size={12}>
          <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap' }}>
            {([['risksExplained', 'Risks Explained'], ['benefitsExplained', 'Benefits Explained'], ['alternativesDiscussed', 'Alternatives Discussed'],
              ['seizureRiskDiscussed', 'Seizure Risk Discussed'], ['contraindications_checked', 'Contraindications Checked']] as const).map(([k, l]) => (
              <FormControlLabel key={k} control={<Switch size="small" checked={form[k]} onChange={(_, v) => setForm(p => ({ ...p, [k]: v }))} />}
                label={<Typography variant="body2" sx={{ fontSize: 12 }}>{l}</Typography>} />
            ))}
          </Box>
        </Grid>
        <Grid size={12}><TextField label="Notes" size="small" fullWidth multiline rows={2} value={form.notes} onChange={e => setForm(p => ({ ...p, notes: e.target.value }))} /></Grid>
      </Grid>
      <Box sx={{ mt: 2, display: 'flex', justifyContent: 'flex-end' }}>
        <Button variant="contained" onClick={() => saveMut.mutate()} disabled={saveMut.isPending}
          sx={{ bgcolor: '#1565C0', textTransform: 'none' }}>{saveMut.isPending ? 'Saving...' : 'Save Consent'}</Button>
      </Box>
    </Paper>
  );
}
