import React, { useState } from 'react';
import {
  Alert, Box, Button, Card, CardContent, Chip, CircularProgress, Dialog, DialogActions,
  DialogContent, DialogTitle, Divider, FormControl, Grid, IconButton, InputLabel,
  MenuItem, Paper, Select, Tab, Tabs, TextField, Tooltip, Typography,
} from '@mui/material';
import AssignmentIcon from '@mui/icons-material/Assignment';
import FlagIcon from '@mui/icons-material/Flag';
import AddIcon from '@mui/icons-material/Add';
import SearchIcon from '@mui/icons-material/Search';
import TrendingUpIcon from '@mui/icons-material/TrendingUp';
import OpenInNewIcon from '@mui/icons-material/OpenInNew';
import { useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '../../../shared/services/apiClient';
import { caseManagementKeys } from '../queryKeys';

const fmtDate = (iso: string) => {
  try { return new Date(iso).toLocaleDateString('en-AU', { day: '2-digit', month: 'short', year: 'numeric' }); } catch { return iso; }
};

const daysSince = (iso: string): number => {
  try { return Math.floor((Date.now() - new Date(iso).getTime()) / 86400000); } catch { return 999; }
};

const ragColor = (days: number): { color: string; bg: string; label: string } => {
  if (days <= 7) return { color: '#2E7D32', bg: '#E8F5E9', label: 'Green' };
  if (days <= 14) return { color: '#b8621a', bg: '#FFF3E0', label: 'Amber' };
  return { color: '#D32F2F', bg: '#FDECEA', label: 'Red' };
};

type CaseloadPatientRow = {
  id?: string;
  displayName?: string;
  patientDisplayName?: string;
  givenName?: string;
  familyName?: string;
  lastContactDate?: string;
  episodeName?: string;
  episode?: string;
  episodeType?: string;
};

type CaseloadResponse =
  | CaseloadPatientRow[]
  | {
      patients?: CaseloadPatientRow[];
      data?: CaseloadPatientRow[];
    };

type CarePlanInterventionRow = {
  id?: string;
  text?: string;
  description?: string;
  name?: string;
};

type CarePlanGoalRow = {
  id?: string;
  title?: string;
  name?: string;
  status?: string;
  targetDate?: string;
  description?: string;
  interventions?: CarePlanInterventionRow[];
};

type CarePlanGoalsResponse =
  | CarePlanGoalRow[]
  | {
      goals?: CarePlanGoalRow[];
      data?: CarePlanGoalRow[];
    };

type OutcomeScoreRow = {
  date?: string;
  score?: number;
  value?: number;
};

type OutcomesResponse = {
  phq9?: OutcomeScoreRow[];
  k10?: OutcomeScoreRow[];
  honos?: OutcomeScoreRow[];
};

type CommunityResourceRow = {
  id?: string;
  name?: string;
  category?: string;
  description?: string;
  area?: string;
  url?: string;
  phone?: string;
};

type CommunityResourcesResponse =
  | CommunityResourceRow[]
  | {
      resources?: CommunityResourceRow[];
      data?: CommunityResourceRow[];
    };

const toCaseloadPatients = (value: CaseloadResponse | undefined): CaseloadPatientRow[] =>
  Array.isArray(value) ? value : value?.patients ?? value?.data ?? [];

const toCarePlanGoals = (value: CarePlanGoalsResponse | undefined): CarePlanGoalRow[] =>
  Array.isArray(value) ? value : value?.goals ?? value?.data ?? [];

const toCommunityResources = (
  value: CommunityResourcesResponse | undefined,
): CommunityResourceRow[] => (Array.isArray(value) ? value : value?.resources ?? value?.data ?? []);

export default function CaseManagementPage(): React.ReactElement {
  const [tab, setTab] = useState(0);

  return (
    <Box sx={{ p: { xs: 2, md: 3 }, bgcolor: '#FBF8F5', minHeight: '100vh' }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, mb: 3 }}>
        <AssignmentIcon sx={{ color: '#327C8D', fontSize: 28 }} />
        <Box>
          <Typography variant="h5" fontWeight={700} fontFamily="Albert Sans, sans-serif" color="#3D484B">Case Management</Typography>
          <Typography variant="body2" color="text.secondary">Caseload overview, care plans, outcomes, and community resources</Typography>
        </Box>
      </Box>

      <Tabs aria-label="Navigation tabs" value={tab} onChange={(_, v) => setTab(v)} sx={{ mb: 3, '& .MuiTab-root': { textTransform: 'none', fontWeight: 600 } }}>
        <Tab label="Caseload" />
        <Tab label="Care Plans" />
        <Tab label="Outcomes" />
        <Tab label="Resources" />
      </Tabs>

      {tab === 0 && <CaseloadTab />}
      {tab === 1 && <CarePlansTab />}
      {tab === 2 && <OutcomesTab />}
      {tab === 3 && <ResourcesTab />}
    </Box>
  );
}

/* ─── Caseload ─── */
function CaseloadTab() {
  const navigate = useNavigate();
  const { data, isLoading, error } = useQuery<CaseloadResponse>({
    queryKey: caseManagementKeys.caseload(),
    queryFn: async (): Promise<CaseloadResponse> => {
      try {
        return await apiClient.get<CaseloadResponse>('dashboard/caseload');
      } catch (err) {
        console.warn('CaseManagementPage: query failed', err);
        return [];
      }
    },
  });

  const patients = toCaseloadPatients(data);

  if (isLoading) return <CircularProgress role="progressbar" aria-label="Loading" sx={{ display: 'block', mx: 'auto', mt: 4 }} />;
  if (error) return <Alert role="alert" severity="error" sx={{ mt: 2 }}>Failed to load caseload</Alert>;

  return (
    <Box>
      {patients.length === 0 && (
        <Typography color="text.secondary" sx={{ py: 4, textAlign: 'center' }}>No patients assigned to your caseload</Typography>
      )}
      <Grid container spacing={2}>
        {patients.map((p: CaseloadPatientRow, i: number) => {
          const lastContactDays = p.lastContactDate ? daysSince(p.lastContactDate) : 999;
          const rag = ragColor(lastContactDays);
          return (
            <Grid size={{ xs: 12, sm: 6, md: 4, lg: 3 }} key={p.id ?? i}>
              <Card variant="outlined"
                {...(p.id ? {
                  role: 'button' as const,
                  tabIndex: 0,
                  'aria-label': `Open patient ${p.displayName ?? p.patientDisplayName ?? (`${p.givenName ?? ''} ${p.familyName ?? ''}`.trim() || 'Patient')}`,
                  onClick: () => navigate(`/patients/${p.id}`),
                  onKeyDown: (e: React.KeyboardEvent) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); navigate(`/patients/${p.id}`); } },
                } : {})}
                sx={{
                  cursor: p.id ? 'pointer' : 'default', '&:hover': p.id ? { boxShadow: 3 } : {}, transition: 'box-shadow 0.2s',
                  borderLeft: `4px solid ${rag.color}`,
                  '&:focus-visible': p.id ? { outline: '2px solid #b8621a', outlineOffset: 2 } : {},
                }}>
                <CardContent sx={{ pb: '12px !important' }}>
                  <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', mb: 1 }}>
                    <Box>
                      <Typography variant="body1" fontWeight={700} color="#3D484B" fontFamily="Albert Sans, sans-serif">
                        {p.displayName ?? p.patientDisplayName ?? `${p.givenName ?? ''} ${p.familyName ?? ''}`.trim() ?? 'Patient'}
                      </Typography>
                      <Typography variant="caption" color="text.secondary">
                        {p.episodeName ?? p.episode ?? p.episodeType ?? ''}
                      </Typography>
                    </Box>
                    <Chip label={rag.label} size="small" sx={{ bgcolor: rag.bg, color: rag.color, fontWeight: 700, fontSize: 10 }} />
                  </Box>
                  <Divider sx={{ my: 1 }} />
                  <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <Typography variant="caption" color="text.secondary">
                      Last contact: {p.lastContactDate ? fmtDate(p.lastContactDate) : 'None'}
                    </Typography>
                    <Typography variant="caption" color={rag.color} fontWeight={600}>
                      {lastContactDays < 999 ? `${lastContactDays}d ago` : 'N/A'}
                    </Typography>
                  </Box>
                </CardContent>
              </Card>
            </Grid>
          );
        })}
      </Grid>
    </Box>
  );
}

/* ─── Care Plans ─── */
function CarePlansTab() {
  const qc = useQueryClient();
  const [patientId, setPatientId] = useState('');
  const [goalOpen, setGoalOpen] = useState(false);
  const [goalForm, setGoalForm] = useState({ title: '', description: '', targetDate: '', status: 'active' });
  const [interventionOpen, setInterventionOpen] = useState<string | null>(null);
  const [interventionText, setInterventionText] = useState('');

  const { data: patients } = useQuery<CaseloadResponse>({
    queryKey: caseManagementKeys.caseload(),
    queryFn: async (): Promise<CaseloadResponse> => {
      try {
        return await apiClient.get<CaseloadResponse>('dashboard/caseload');
      } catch (err) {
        console.warn('CaseManagementPage: query failed', err);
        return [];
      }
    },
  });
  const { data: goalsData, isLoading } = useQuery<CarePlanGoalsResponse>({
    queryKey: caseManagementKeys.carePlanGoals(patientId),
    queryFn: async (): Promise<CarePlanGoalsResponse> => {
      try {
        return await apiClient.get<CarePlanGoalsResponse>(`care-plans/${patientId}/goals`);
      } catch (err) {
        console.warn('CaseManagementPage: query failed', err);
        return [];
      }
    },
    enabled: !!patientId,
  });

  const addGoalMut = useMutation({
    mutationFn: (d: typeof goalForm) => apiClient.post(`care-plans/${patientId}/goals`, d),
    onSuccess: () => { qc.invalidateQueries({ queryKey: caseManagementKeys.carePlanGoals(patientId) }); setGoalOpen(false); setGoalForm({ title: '', description: '', targetDate: '', status: 'active' }); },
  });
  const addInterventionMut = useMutation({
    mutationFn: (d: { goalId: string; text: string }) => apiClient.post(`care-plans/${patientId}/goals/${d.goalId}/interventions`, { text: d.text }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: caseManagementKeys.carePlanGoals(patientId) }); setInterventionOpen(null); setInterventionText(''); },
  });

  const patientList = toCaseloadPatients(patients);
  const goals = toCarePlanGoals(goalsData);

  const STATUS_COLORS: Record<string, { color: string; bg: string }> = {
    active: { color: '#327C8D', bg: '#E8F5F7' },
    achieved: { color: '#2E7D32', bg: '#E8F5E9' },
    'in-progress': { color: '#b8621a', bg: '#FFF3E0' },
    discontinued: { color: '#999', bg: '#F5F5F5' },
  };

  return (
    <Box>
      <Box sx={{ display: 'flex', gap: 2, mb: 3, alignItems: 'center' }}>
        <FormControl size="small" sx={{ minWidth: 280 }}>
          <InputLabel>Select Patient</InputLabel>
          <Select label="Select Patient" value={patientId} onChange={(e) => setPatientId(e.target.value)}>
            {patientList.map((p: CaseloadPatientRow) => (
              <MenuItem key={p.id} value={p.id}>{p.displayName ?? `${p.givenName ?? ''} ${p.familyName ?? ''}`.trim()}</MenuItem>
            ))}
          </Select>
        </FormControl>
        {patientId && (
          <Button startIcon={<AddIcon />} variant="contained" size="small" onClick={() => setGoalOpen(true)}
            sx={{ bgcolor: '#327C8D', textTransform: 'none', '&:hover': { bgcolor: '#286A78' } }}>
            Add Goal
          </Button>
        )}
      </Box>

      {!patientId && <Typography color="text.secondary" sx={{ py: 4, textAlign: 'center' }}>Select a patient to view their care plan</Typography>}
      {isLoading && <CircularProgress role="progressbar" aria-label="Loading" sx={{ display: 'block', mx: 'auto', mt: 4 }} />}

      {goals.map((g: CarePlanGoalRow, i: number) => {
        const status = g.status ?? 'active';
        const sc = STATUS_COLORS[status] ?? STATUS_COLORS.active;
        const interventions = g.interventions ?? [];
        return (
          <Paper key={g.id ?? i} variant="outlined" sx={{ p: 2, mb: 2 }}>
            <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 1 }}>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                <FlagIcon sx={{ color: sc.color, fontSize: 20 }} />
                <Typography variant="body1" fontWeight={700} color="#3D484B" fontFamily="Albert Sans, sans-serif">{g.title ?? g.name ?? `Goal ${i + 1}`}</Typography>
              </Box>
              <Box sx={{ display: 'flex', gap: 1, alignItems: 'center' }}>
                <Chip label={status} size="small" sx={{ bgcolor: sc.bg, color: sc.color, fontWeight: 600, fontSize: 11, textTransform: 'capitalize' }} />
                {g.targetDate && <Typography variant="caption" color="text.secondary">Target: {fmtDate(g.targetDate)}</Typography>}
              </Box>
            </Box>
            {g.description && <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>{g.description}</Typography>}

            {/* Interventions */}
            {interventions.length > 0 && (
              <Box sx={{ pl: 2, borderLeft: '2px solid #E8F5F7' }}>
                {interventions.map((iv: CarePlanInterventionRow, j: number) => (
                  <Box key={iv.id ?? j} sx={{ py: 0.5, display: 'flex', gap: 1, alignItems: 'flex-start' }}>
                    <Box sx={{ width: 6, height: 6, borderRadius: '50%', bgcolor: '#327C8D', mt: 0.8, flexShrink: 0 }} />
                    <Typography variant="body2" color="#3D484B">{iv.text ?? iv.description ?? iv.name}</Typography>
                  </Box>
                ))}
              </Box>
            )}
            <Button size="small" startIcon={<AddIcon />} onClick={() => setInterventionOpen(g.id ?? null)}
              sx={{ mt: 1, textTransform: 'none', color: '#327C8D', fontSize: 12 }}>
              Add Intervention
            </Button>
          </Paper>
        );
      })}

      {/* Add Goal Dialog */}
      <Dialog aria-labelledby="dialog-title" open={goalOpen} onClose={() => setGoalOpen(false)} maxWidth="xs" fullWidth>
        <DialogTitle id="dialog-title" sx={{ fontFamily: 'Albert Sans, sans-serif', fontWeight: 700, color: '#3D484B' }}>Add Care Plan Goal</DialogTitle>
        <DialogContent sx={{ display: 'flex', flexDirection: 'column', gap: 2, pt: '12px !important' }}>
          <TextField label="Goal Title" size="small" fullWidth value={goalForm.title}
            onChange={(e) => setGoalForm(p => ({ ...p, title: e.target.value }))} />
          <TextField label="Description" size="small" fullWidth multiline rows={2} value={goalForm.description}
            onChange={(e) => setGoalForm(p => ({ ...p, description: e.target.value }))} />
          <TextField label="Target Date" size="small" fullWidth type="date" InputLabelProps={{ shrink: true }}
            value={goalForm.targetDate} onChange={(e) => setGoalForm(p => ({ ...p, targetDate: e.target.value }))} />
          <FormControl size="small" fullWidth>
            <InputLabel>Status</InputLabel>
            <Select label="Status" value={goalForm.status} onChange={(e) => setGoalForm(p => ({ ...p, status: e.target.value }))}>
              <MenuItem value="active">Active</MenuItem>
              <MenuItem value="in-progress">In Progress</MenuItem>
              <MenuItem value="achieved">Achieved</MenuItem>
              <MenuItem value="discontinued">Discontinued</MenuItem>
            </Select>
          </FormControl>
          {addGoalMut.isError && <Alert role="alert" severity="error">Failed to add goal</Alert>}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setGoalOpen(false)} sx={{ textTransform: 'none' }}>Cancel</Button>
          <Button variant="contained" disabled={addGoalMut.isPending || !goalForm.title}
            onClick={() => addGoalMut.mutate(goalForm)}
            sx={{ bgcolor: '#327C8D', textTransform: 'none', '&:hover': { bgcolor: '#286A78' } }}>
            {addGoalMut.isPending ? <CircularProgress role="progressbar" aria-label="Loading" size={20} /> : 'Save Goal'}
          </Button>
        </DialogActions>
      </Dialog>

      {/* Add Intervention Dialog */}
      <Dialog aria-labelledby="dialog-title" open={!!interventionOpen} onClose={() => setInterventionOpen(null)} maxWidth="xs" fullWidth>
        <DialogTitle id="dialog-title" sx={{ fontFamily: 'Albert Sans, sans-serif', fontWeight: 700, color: '#3D484B' }}>Add Intervention</DialogTitle>
        <DialogContent sx={{ pt: '12px !important' }}>
          <TextField label="Intervention" size="small" fullWidth multiline rows={3} value={interventionText}
            onChange={(e) => setInterventionText(e.target.value)} />
          {addInterventionMut.isError && <Alert role="alert" severity="error" sx={{ mt: 1 }}>Failed to add intervention</Alert>}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setInterventionOpen(null)} sx={{ textTransform: 'none' }}>Cancel</Button>
          <Button variant="contained" disabled={addInterventionMut.isPending || !interventionText}
            onClick={() => interventionOpen && addInterventionMut.mutate({ goalId: interventionOpen, text: interventionText })}
            sx={{ bgcolor: '#327C8D', textTransform: 'none', '&:hover': { bgcolor: '#286A78' } }}>
            {addInterventionMut.isPending ? <CircularProgress role="progressbar" aria-label="Loading" size={20} /> : 'Save'}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}

/* ─── Outcomes ─── */
function OutcomesTab() {
  const [patientId, setPatientId] = useState('');
  const { data: patients } = useQuery<CaseloadResponse>({
    queryKey: caseManagementKeys.caseload(),
    queryFn: async (): Promise<CaseloadResponse> => {
      try {
        return await apiClient.get<CaseloadResponse>('dashboard/caseload');
      } catch (err) {
        console.warn('CaseManagementPage: query failed', err);
        return [];
      }
    },
  });
  const { data: outcomesData, isLoading } = useQuery<OutcomesResponse>({
    queryKey: caseManagementKeys.outcomes(patientId),
    queryFn: async (): Promise<OutcomesResponse> => {
      try {
        return await apiClient.get<OutcomesResponse>('outcomes', { patientId });
      } catch {
        return { phq9: [], k10: [], honos: [] };
      }
    },
    enabled: !!patientId,
  });

  const patientList = toCaseloadPatients(patients);
  const phq9Scores: OutcomeScoreRow[] = outcomesData?.phq9 ?? [];
  const k10Scores: OutcomeScoreRow[] = outcomesData?.k10 ?? [];
  const honosScores: OutcomeScoreRow[] = outcomesData?.honos ?? [];

  return (
    <Box>
      <FormControl size="small" sx={{ minWidth: 280, mb: 3 }}>
        <InputLabel>Select Patient</InputLabel>
        <Select label="Select Patient" value={patientId} onChange={(e) => setPatientId(e.target.value)}>
          {patientList.map((p: CaseloadPatientRow) => (
            <MenuItem key={p.id} value={p.id}>{p.displayName ?? `${p.givenName ?? ''} ${p.familyName ?? ''}`.trim()}</MenuItem>
          ))}
        </Select>
      </FormControl>

      {!patientId && <Typography color="text.secondary" sx={{ py: 4, textAlign: 'center' }}>Select a patient to view outcome scores</Typography>}
      {isLoading && <CircularProgress role="progressbar" aria-label="Loading" sx={{ display: 'block', mx: 'auto', mt: 4 }} />}

      {patientId && (
        <Grid container spacing={3}>
          <Grid size={{ xs: 12, md: 4 }}>
            <OutcomeChart title="PHQ-9" scores={phq9Scores} maxScore={27} thresholds={[5, 10, 15, 20]} labels={['Minimal', 'Mild', 'Moderate', 'Mod-Severe', 'Severe']} />
          </Grid>
          <Grid size={{ xs: 12, md: 4 }}>
            <OutcomeChart title="Kessler K10" scores={k10Scores} maxScore={50} thresholds={[20, 25, 30]} labels={['Low', 'Moderate', 'High', 'Very High']} />
          </Grid>
          <Grid size={{ xs: 12, md: 4 }}>
            <OutcomeChart title="HoNOS" scores={honosScores} maxScore={48} thresholds={[8, 16, 24]} labels={['Mild', 'Moderate', 'Severe', 'Very Severe']} />
          </Grid>
        </Grid>
      )}
    </Box>
  );
}

interface OutcomeChartProps {
  title: string;
  scores: OutcomeScoreRow[];
  maxScore: number;
  thresholds: number[];
  labels?: string[];
}
function OutcomeChart({ title, scores, maxScore, thresholds }: OutcomeChartProps) {
  if (scores.length === 0) {
    return (
      <Paper variant="outlined" sx={{ p: 2.5 }}>
        <Typography variant="subtitle1" fontWeight={700} color="#3D484B" fontFamily="Albert Sans, sans-serif" sx={{ mb: 1 }}>{title}</Typography>
        <Typography variant="body2" color="text.secondary" sx={{ textAlign: 'center', py: 3 }}>No scores recorded</Typography>
      </Paper>
    );
  }

  const getColor = (val: number) => {
    if (val >= (thresholds[thresholds.length - 1] ?? maxScore)) return '#D32F2F';
    if (val >= (thresholds[Math.floor(thresholds.length / 2)] ?? maxScore / 2)) return '#b8621a';
    return '#2E7D32';
  };
  const latestScore = scores[scores.length - 1];
  const latestValue = latestScore?.score ?? latestScore?.value ?? 0;

  return (
    <Paper variant="outlined" sx={{ p: 2.5 }}>
      <Typography variant="subtitle1" fontWeight={700} color="#3D484B" fontFamily="Albert Sans, sans-serif" sx={{ mb: 1 }}>
        <TrendingUpIcon sx={{ fontSize: 18, mr: 0.5, verticalAlign: 'text-bottom', color: '#327C8D' }} />
        {title}
      </Typography>
      {/* Simple bar chart using MUI */}
      <Box sx={{ display: 'flex', alignItems: 'flex-end', gap: 0.5, height: 120, mb: 1 }}>
        {scores.slice(-10).map((s: OutcomeScoreRow, i: number) => {
          const val = s.score ?? s.value ?? 0;
          const pct = Math.min((val / maxScore) * 100, 100);
          return (
            <Tooltip key={i} title={`${val} | ${s.date ? fmtDate(s.date) : ''}`}>
              <Box sx={{
                flex: 1, height: `${pct}%`, bgcolor: getColor(val), borderRadius: '4px 4px 0 0',
                minHeight: 4, cursor: 'pointer', transition: 'height 0.3s',
                '&:hover': { opacity: 0.8 },
              }} />
            </Tooltip>
          );
        })}
      </Box>
      {/* Latest value */}
      {scores.length > 0 && (
        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <Typography variant="caption" color="text.secondary">Latest: {latestScore?.date ? fmtDate(latestScore.date) : ''}</Typography>
          <Chip label={`${latestValue} / ${maxScore}`}
            size="small" sx={{ bgcolor: getColor(latestValue), color: '#fff', fontWeight: 700, fontSize: 11 }} />
        </Box>
      )}
    </Paper>
  );
}

/* ─── Resources ─── */
function ResourcesTab() {
  const [search, setSearch] = useState('');
  const { data, isLoading, error } = useQuery<CommunityResourcesResponse>({
    queryKey: caseManagementKeys.communityResources(),
    queryFn: async (): Promise<CommunityResourcesResponse> => {
      try {
        return await apiClient.get<CommunityResourcesResponse>('community-resources');
      } catch (err) {
        console.warn('CaseManagementPage: query failed', err);
        return [];
      }
    },
  });

  const resources = toCommunityResources(data);
  const filtered = resources.filter((r: CommunityResourceRow) => {
    if (!search) return true;
    const s = search.toLowerCase();
    return (r.name ?? '').toLowerCase().includes(s) || (r.category ?? '').toLowerCase().includes(s) ||
      (r.description ?? '').toLowerCase().includes(s) || (r.area ?? '').toLowerCase().includes(s);
  });

  if (error) return <Alert role="alert" severity="error" sx={{ mt: 2 }}>Failed to load resources</Alert>;

  return (
    <Box>
      <TextField size="small" placeholder="Search resources..." value={search} onChange={(e) => setSearch(e.target.value)}
        InputProps={{ startAdornment: <SearchIcon sx={{ color: '#999', mr: 1 }} /> }}
        sx={{ mb: 3, width: 400, maxWidth: '100%' }} />
      {isLoading && <CircularProgress role="progressbar" aria-label="Loading" sx={{ display: 'block', mx: 'auto', mt: 4 }} />}
      {filtered.length === 0 && !isLoading && (
        <Typography color="text.secondary" sx={{ py: 4, textAlign: 'center' }}>No resources found</Typography>
      )}
      <Grid container spacing={2}>
        {filtered.map((r: CommunityResourceRow, i: number) => (
          <Grid size={{ xs: 12, sm: 6, md: 4 }} key={r.id ?? i}>
            <Card variant="outlined" sx={{ height: '100%' }}>
              <CardContent sx={{ pb: '12px !important' }}>
                <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                  <Typography variant="body1" fontWeight={700} color="#3D484B" fontFamily="Albert Sans, sans-serif">
                    {r.name ?? 'Resource'}
                  </Typography>
                  {r.url && (
                    <IconButton size="small" href={r.url} target="_blank" sx={{ color: '#327C8D' }}>
                      <OpenInNewIcon sx={{ fontSize: 16 }} />
                    </IconButton>
                  )}
                </Box>
                {r.category && <Chip label={r.category} size="small" sx={{ bgcolor: '#E8F5F7', color: '#327C8D', fontSize: 10, mt: 0.5, mb: 1 }} />}
                {r.description && <Typography variant="body2" color="text.secondary" sx={{ mb: 1, fontSize: 12 }}>{r.description}</Typography>}
                <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5 }}>
                  {r.phone && <Chip label={r.phone} size="small" variant="outlined" sx={{ fontSize: 10, height: 20 }} />}
                  {r.area && <Chip label={r.area} size="small" variant="outlined" sx={{ fontSize: 10, height: 20 }} />}
                </Box>
              </CardContent>
            </Card>
          </Grid>
        ))}
      </Grid>
    </Box>
  );
}
