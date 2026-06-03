import { useEffect, useMemo, useState } from 'react';
import {
  Alert, Box, Button, Chip, CircularProgress, Dialog, DialogActions, DialogContent,
  DialogTitle, Divider, FormControl, Grid, InputLabel, LinearProgress, MenuItem,
  Paper, Select, Stack, Table, TableBody, TableCell, TableContainer, TableHead,
  TableRow, TextField, Typography,
} from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import PsychologyIcon from '@mui/icons-material/Psychology';
import PlayArrowIcon from '@mui/icons-material/PlayArrow';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { apiClient } from '../../../shared/services/apiClient';
import { extractListResponse } from '../../../shared/services/extractListResponse';
import { pathwayKeys } from '../queryKeys';
import PathwayDigitalCareDialog from '../components/PathwayDigitalCareDialog';
import { BehavioralEngagementPanel } from '../components/BehavioralEngagementPanel';
import type {
  PathwayInterventionTemplateKey,
  PathwayResearchLaneSummary,
  StepCareRule,
  WearableDeviceSource,
  WearableProvider,
  WearableProviderCatalogItem,
  DigitalPhenotypeSnapshot,
} from '@signacare/shared';

const PATHWAY_TYPES = [
  { id: 'cbt', label: 'CBT (12 sessions)', name: 'Cognitive Behavioural Therapy', sessions: 12 },
  { id: 'dbt', label: 'DBT (24 sessions)', name: 'Dialectical Behaviour Therapy', sessions: 24 },
  { id: 'act', label: 'ACT (10 sessions)', name: 'Acceptance & Commitment Therapy', sessions: 10 },
  { id: 'emdr', label: 'EMDR (12 sessions)', name: 'Eye Movement Desensitization & Reprocessing', sessions: 12 },
  { id: 'ipp', label: 'IPP (16 sessions)', name: 'Interpersonal Psychotherapy', sessions: 16 },
  { id: 'schema', label: 'Schema Therapy (20 sessions)', name: 'Schema Therapy', sessions: 20 },
  { id: 'cat', label: 'CAT (16 sessions)', name: 'Cognitive Analytic Therapy', sessions: 16 },
] as const;

const INTERVENTION_TEMPLATE_OPTIONS: Array<{
  key: PathwayInterventionTemplateKey;
  label: string;
}> = [
  { key: 'cbt_homework', label: 'CBT Homework Pack' },
  { key: 'dbt_skills', label: 'DBT Skills Pack' },
  { key: 'thought_diary_journey', label: 'Thought Diary Journey' },
  { key: 'sleep_hygiene_journey', label: 'Sleep Hygiene Journey' },
];

interface PathwayRow {
  id: string;
  patientId: string;
  status: string;
  lockVersion: number;
  totalSessions: number;
  completedSessions: number;
  pathwayName: string;
  pathwayType: string;
  startDate: string;
}

interface PathwayFormState {
  patientId: string;
  pathwayType: string;
  startDate: string;
  notes: string;
}

interface StepCareRuleFormState {
  name: string;
  description: string;
  pathwayType: string;
  interventionTemplateKey: PathwayInterventionTemplateKey;
  moodBelowThreshold: string;
  anxietyAboveThreshold: string;
  sleepHoursBelow: string;
  phq9MinScore: string;
  gad7MinScore: string;
  riskIndexMin: string;
}

interface WearableSourceFormState {
  provider: WearableProvider;
  deviceLabel: string;
  externalDeviceId: string;
}

interface ApiErrorResponsePayload {
  code?: string;
  error?: string;
}

interface ApiErrorLike {
  code?: string;
  message?: string;
  response?: {
    data?: ApiErrorResponsePayload;
  };
}

const asApiErrorLike = (error: unknown): ApiErrorLike =>
  (error && typeof error === 'object' ? error : {}) as ApiErrorLike;

const getApiErrorCode = (error: unknown): string | undefined => {
  const parsed = asApiErrorLike(error);
  return parsed.response?.data?.code ?? parsed.code;
};

const getApiErrorMessage = (error: unknown): string => {
  const parsed = asApiErrorLike(error);
  return parsed.response?.data?.error ?? parsed.message ?? 'Failed to record session';
};

const parseNullableNumber = (value: string): number | null => {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : null;
};

const ruleConditionSummary = (rule: StepCareRule): string => {
  const segments: string[] = [];
  if (rule.conditions.moodBelowThreshold != null) {
    segments.push(`Mood <= ${rule.conditions.moodBelowThreshold}`);
  }
  if (rule.conditions.anxietyAboveThreshold != null) {
    segments.push(`Anxiety >= ${rule.conditions.anxietyAboveThreshold}`);
  }
  if (rule.conditions.sleepHoursBelow != null) {
    segments.push(`Sleep <= ${rule.conditions.sleepHoursBelow}h`);
  }
  if (rule.conditions.phq9MinScore != null) {
    segments.push(`PHQ-9 >= ${rule.conditions.phq9MinScore}`);
  }
  if (rule.conditions.gad7MinScore != null) {
    segments.push(`GAD-7 >= ${rule.conditions.gad7MinScore}`);
  }
  if (rule.conditions.riskIndexMin != null) {
    segments.push(`Risk >= ${rule.conditions.riskIndexMin}`);
  }
  return segments.join(' · ');
};

export default function PathwaysPage() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [addOpen, setAddOpen] = useState(false);
  const [stepCareOpen, setStepCareOpen] = useState(false);
  const [periodDays, setPeriodDays] = useState(180);
  const [form, setForm] = useState<PathwayFormState>({
    patientId: '',
    pathwayType: 'cbt',
    startDate: new Date().toISOString().split('T')[0],
    notes: '',
  });
  const [stepCareForm, setStepCareForm] = useState<StepCareRuleFormState>({
    name: '',
    description: '',
    pathwayType: 'cbt',
    interventionTemplateKey: 'cbt_homework',
    moodBelowThreshold: '',
    anxietyAboveThreshold: '',
    sleepHoursBelow: '',
    phq9MinScore: '',
    gad7MinScore: '',
    riskIndexMin: '',
  });
  const [selectedWearablePatientId, setSelectedWearablePatientId] = useState('');
  const [wearableForm, setWearableForm] = useState<WearableSourceFormState>({
    provider: 'manual_import',
    deviceLabel: '',
    externalDeviceId: '',
  });

  const { data: pathways = [], isLoading, isError: pathwaysLoadError } = useQuery({
    queryKey: pathwayKeys.list(),
    queryFn: async () => {
      const response = await apiClient.get<unknown>('pathways/patient/all');
      return extractListResponse<PathwayRow>(response, {
        endpoint: 'pathways/patient/all',
        keys: ['pathways', 'data', 'items'],
      });
    },
  });

  const patientIdsWithPathways = useMemo(
    () => Array.from(new Set((pathways ?? []).map((pathway) => pathway.patientId).filter(Boolean))),
    [pathways],
  );

  useEffect(() => {
    if (!selectedWearablePatientId && patientIdsWithPathways.length > 0) {
      setSelectedWearablePatientId(patientIdsWithPathways[0] ?? '');
    }
    if (selectedWearablePatientId && !patientIdsWithPathways.includes(selectedWearablePatientId)) {
      setSelectedWearablePatientId(patientIdsWithPathways[0] ?? '');
    }
  }, [patientIdsWithPathways, selectedWearablePatientId]);

  const createMut = useMutation({
    mutationFn: (data: PathwayFormState) => {
      const selected = PATHWAY_TYPES.find((item) => item.id === data.pathwayType);
      return apiClient.post('pathways', {
        patientId: data.patientId,
        pathwayType: data.pathwayType,
        pathwayName: selected?.name ?? data.pathwayType.toUpperCase(),
        name: selected?.name ?? data.pathwayType.toUpperCase(),
        totalSessions: selected?.sessions ?? 12,
        startDate: data.startDate,
        notes: data.notes,
      });
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: pathwayKeys.all }); setAddOpen(false); },
  });

  const { data: stepCareRules = [] } = useQuery({
    queryKey: pathwayKeys.stepCareRules(),
    queryFn: async () => {
      const response = await apiClient.get<{ rules?: StepCareRule[] }>('pathways/step-care/rules');
      return Array.isArray(response.rules) ? response.rules : [];
    },
  });

  const { data: researchLane } = useQuery({
    queryKey: pathwayKeys.researchSummary(periodDays),
    queryFn: () =>
      apiClient.get<PathwayResearchLaneSummary>('pathways/research/effectiveness', {
        periodDays,
      }),
  });

  const { data: wearableProviders = [] } = useQuery({
    queryKey: pathwayKeys.wearableProviders(),
    queryFn: async () => {
      const response = await apiClient.get<{ providers?: WearableProviderCatalogItem[] }>('pathways/wearables/providers/catalog');
      return Array.isArray(response.providers) ? response.providers : [];
    },
  });

  const { data: wearableSources = [] } = useQuery({
    queryKey: pathwayKeys.wearableSources(selectedWearablePatientId || 'none'),
    enabled: selectedWearablePatientId.length > 0,
    queryFn: async () => {
      const response = await apiClient.get<{ sources?: WearableDeviceSource[] }>(
        `pathways/wearables/${selectedWearablePatientId}/sources`,
        { includeInactive: 'true' },
      );
      return Array.isArray(response.sources) ? response.sources : [];
    },
  });

  const { data: wearablePhenotypes = [] } = useQuery({
    queryKey: pathwayKeys.phenotypes(selectedWearablePatientId || 'none', 10),
    enabled: selectedWearablePatientId.length > 0,
    queryFn: async () => {
      const response = await apiClient.get<{ rows?: DigitalPhenotypeSnapshot[] }>(
        `pathways/research/phenotypes/${selectedWearablePatientId}`,
        { limit: 10 },
      );
      return Array.isArray(response.rows) ? response.rows : [];
    },
  });

  const createStepCareRule = useMutation({
    mutationFn: () =>
      apiClient.post<StepCareRule>('pathways/step-care/rules', {
        name: stepCareForm.name.trim(),
        description: stepCareForm.description.trim() || undefined,
        pathwayType: stepCareForm.pathwayType,
        interventionTemplateKey: stepCareForm.interventionTemplateKey,
        autoAssignEnabled: true,
        autoEscalateEnabled: true,
        escalationPriority: 'high',
        assignmentScope: 'primary_clinician',
        isActive: true,
        conditions: {
          moodBelowThreshold: parseNullableNumber(stepCareForm.moodBelowThreshold),
          anxietyAboveThreshold: parseNullableNumber(stepCareForm.anxietyAboveThreshold),
          sleepHoursBelow: parseNullableNumber(stepCareForm.sleepHoursBelow),
          phq9MinScore: parseNullableNumber(stepCareForm.phq9MinScore),
          gad7MinScore: parseNullableNumber(stepCareForm.gad7MinScore),
          riskIndexMin: parseNullableNumber(stepCareForm.riskIndexMin),
          minimumObservationDays: 7,
          cooldownDays: 7,
        },
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: pathwayKeys.stepCareRules() });
      setStepCareOpen(false);
      setStepCareForm({
        name: '',
        description: '',
        pathwayType: 'cbt',
        interventionTemplateKey: 'cbt_homework',
        moodBelowThreshold: '',
        anxietyAboveThreshold: '',
        sleepHoursBelow: '',
        phq9MinScore: '',
        gad7MinScore: '',
        riskIndexMin: '',
      });
    },
  });

  const updateStepCareRule = useMutation({
    mutationFn: (rule: StepCareRule) =>
      apiClient.patch<StepCareRule>(`pathways/step-care/rules/${rule.id}`, {
        expectedLockVersion: rule.lockVersion,
        isActive: !rule.isActive,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: pathwayKeys.stepCareRules() });
      qc.invalidateQueries({ queryKey: pathwayKeys.researchRoot() });
    },
  });

  const createWearableSource = useMutation({
    mutationFn: () =>
      apiClient.post<{ source: WearableDeviceSource }>(
        `pathways/wearables/${selectedWearablePatientId}/sources`,
        {
          provider: wearableForm.provider,
          deviceLabel: wearableForm.deviceLabel.trim(),
          externalDeviceId: wearableForm.externalDeviceId.trim() || undefined,
        },
      ),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: pathwayKeys.wearableSources(selectedWearablePatientId) });
      setWearableForm({
        provider: 'manual_import',
        deviceLabel: '',
        externalDeviceId: '',
      });
    },
  });

  const updateWearableSource = useMutation({
    mutationFn: ({
      source,
      isActive,
    }: {
      source: WearableDeviceSource;
      isActive: boolean;
    }) =>
      apiClient.patch<WearableDeviceSource>(
        `pathways/wearables/${selectedWearablePatientId}/sources/${source.id}`,
        {
          expectedLockVersion: source.lockVersion,
          isActive,
        },
      ),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: pathwayKeys.wearableSources(selectedWearablePatientId) });
    },
  });

  const requestWearableSync = useMutation({
    mutationFn: (source: WearableDeviceSource) =>
      apiClient.post(
        `pathways/wearables/${selectedWearablePatientId}/sources/${source.id}/sync`,
        {
          expectedLockVersion: source.lockVersion,
          forceBackfill: false,
          lookbackDays: 14,
        },
      ),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: pathwayKeys.wearableSources(selectedWearablePatientId) });
    },
  });

  // BUG-402 — record-session opt-locked. Caller passes lockVersion read
  // from the GET; server enforces predicate and rejects (409) if a
  // sibling tab already recorded a session.
  // R-FIX-BUG-402-FRONTEND-PATHWAYSPAGE
  const [recordSessionError, setRecordSessionError] = useState('');
  const [digitalPathway, setDigitalPathway] = useState<PathwayRow | null>(null);
  const recordSession = useMutation({
    mutationFn: ({ id, lockVersion }: { id: string; lockVersion: number }) =>
      apiClient.post(`pathways/${id}/session`, { expectedLockVersion: lockVersion }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: pathwayKeys.all });
      setRecordSessionError('');
    },
    onError: (error: unknown) => {
      const code = getApiErrorCode(error);
      if (code === 'OPTIMISTIC_LOCK_CONFLICT') {
        setRecordSessionError('This pathway was just updated elsewhere. The list has been refreshed — try again.');
        qc.invalidateQueries({ queryKey: pathwayKeys.all });
      } else {
        setRecordSessionError(getApiErrorMessage(error));
      }
    },
  });

  return (
    <Box sx={{ p: { xs: 2, md: 3 }, bgcolor: '#FBF8F5', minHeight: '100vh' }}>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 3 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
          <PsychologyIcon sx={{ color: '#327C8D', fontSize: 28 }} />
          <Box>
            <Typography variant="h5" fontWeight={700} fontFamily="Albert Sans, sans-serif" color="#3D484B">Treatment Pathways</Typography>
            <Typography variant="body2" color="text.secondary">Track evidence-based therapy programs (CBT, DBT, ACT, EMDR)</Typography>
          </Box>
        </Box>
        <Stack direction="row" spacing={1}>
          <Button variant="outlined" onClick={() => setStepCareOpen(true)} sx={{ textTransform: 'none' }}>
            New Step-Care Rule
          </Button>
          <Button variant="contained" startIcon={<AddIcon />} onClick={() => setAddOpen(true)}
            sx={{ bgcolor: '#b8621a', '&:hover': { bgcolor: '#d6741f' }, textTransform: 'none' }}>
            New Pathway
          </Button>
        </Stack>
      </Box>

      {recordSessionError && (
        <Alert role="alert" severity="warning" sx={{ mb: 2 }} onClose={() => setRecordSessionError('')}>
          {recordSessionError}
        </Alert>
      )}
      {pathwaysLoadError && (
        <Alert role="alert" severity="error" sx={{ mb: 2 }}>
          Failed to load treatment pathways. Refresh to retry.
        </Alert>
      )}

      {isLoading ? <CircularProgress role="progressbar" aria-label="Loading" /> : (
        <TableContainer role="region" aria-label="Data table" component={Paper} variant="outlined">
          <Table size="small">
            <TableHead>
              <TableRow sx={{ bgcolor: '#FBF8F5' }}>
                <TableCell sx={{ fontWeight: 600 }}>Pathway</TableCell>
                <TableCell sx={{ fontWeight: 600 }}>Type</TableCell>
                <TableCell sx={{ fontWeight: 600 }}>Progress</TableCell>
                <TableCell sx={{ fontWeight: 600, width: 200 }}>Sessions</TableCell>
                <TableCell sx={{ fontWeight: 600 }}>Start Date</TableCell>
                <TableCell sx={{ fontWeight: 600 }}>Status</TableCell>
                <TableCell sx={{ fontWeight: 600 }}>Actions</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {(!pathways || pathways.length === 0) && (
                <TableRow><TableCell colSpan={7}><Alert severity="info">No treatment pathways. Click "New Pathway" to create one.</Alert></TableCell></TableRow>
              )}
              {(pathways ?? []).map((p) => {
                const totalSessions = p.totalSessions;
                const completedSessions = p.completedSessions;
                const pathwayName = p.pathwayName;
                const pathwayType = p.pathwayType;
                const startDate = p.startDate;
                const lockVersion = p.lockVersion;
                const pct = totalSessions > 0 ? Math.round((completedSessions / totalSessions) * 100) : 0;
                return (
                  <TableRow key={p.id} hover>
                    <TableCell sx={{ fontWeight: 500 }}>{pathwayName}</TableCell>
                    <TableCell><Chip label={pathwayType.toUpperCase()} size="small" sx={{ fontSize: 10, bgcolor: '#327C8D', color: '#fff' }} /></TableCell>
                    <TableCell>
                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                        <Box sx={{ flex: 1 }}>
                          <LinearProgress variant="determinate" value={pct}
                            sx={{ height: 8, borderRadius: 4, bgcolor: '#eee',
                              '& .MuiLinearProgress-bar': { bgcolor: pct >= 100 ? '#2E7D32' : pct >= 50 ? '#327C8D' : '#b8621a', borderRadius: 4 } }} />
                        </Box>
                        <Typography variant="caption" fontWeight={600}>{pct}%</Typography>
                      </Box>
                    </TableCell>
                    <TableCell>{completedSessions}/{totalSessions}</TableCell>
                    <TableCell>{startDate ? new Date(startDate).toLocaleDateString('en-AU') : '—'}</TableCell>
                    <TableCell><Chip label={p.status} size="small" color={p.status === 'completed' ? 'success' : p.status === 'active' ? 'primary' : 'default'} sx={{ fontSize: 10 }} /></TableCell>
                    <TableCell>
                      <Box sx={{ display: 'flex', gap: 0.5, flexWrap: 'wrap' }}>
                        <Button
                          size="small"
                          variant="outlined"
                          onClick={() => setDigitalPathway(p)}
                          sx={{ fontSize: 10, textTransform: 'none' }}
                        >
                          Digital Care
                        </Button>
                        {p.status === 'active' && (
                          <Button size="small" variant="outlined" startIcon={<PlayArrowIcon />}
                            onClick={() => {
                              if (typeof lockVersion === 'number') {
                                recordSession.mutate({ id: p.id, lockVersion });
                              }
                            }}
                            disabled={recordSession.isPending || typeof lockVersion !== 'number'}
                            sx={{ fontSize: 10, textTransform: 'none', borderColor: '#327C8D', color: '#327C8D' }}>
                            Record Session
                          </Button>
                        )}
                        {p.patientId && (
                          <Button
                            size="small"
                            variant="text"
                            onClick={() => navigate(`/patients/${p.patientId}?tab=pathways`)}
                            sx={{ fontSize: 10, textTransform: 'none' }}
                          >
                            Open in Workbench
                          </Button>
                        )}
                      </Box>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </TableContainer>
      )}

      <Paper variant="outlined" sx={{ p: 2, mt: 2 }}>
        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 1 }}>
          <Typography variant="h6" fontWeight={700} color="#3D484B">Step-Care Rules Engine</Typography>
          <Typography variant="caption" color="text.secondary">
            Active rules: {stepCareRules.filter((rule) => rule.isActive).length}
          </Typography>
        </Box>
        {stepCareRules.length === 0 ? (
          <Alert severity="info">No step-care rules configured yet.</Alert>
        ) : (
          <TableContainer component={Paper} variant="outlined">
            <Table size="small">
              <TableHead>
                <TableRow sx={{ bgcolor: '#FBF8F5' }}>
                  <TableCell sx={{ fontWeight: 600 }}>Rule</TableCell>
                  <TableCell sx={{ fontWeight: 600 }}>Pathway</TableCell>
                  <TableCell sx={{ fontWeight: 600 }}>Intervention</TableCell>
                  <TableCell sx={{ fontWeight: 600 }}>Conditions</TableCell>
                  <TableCell sx={{ fontWeight: 600 }}>Status</TableCell>
                  <TableCell sx={{ fontWeight: 600 }}>Action</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {stepCareRules.map((rule) => (
                  <TableRow key={rule.id} hover>
                    <TableCell sx={{ fontWeight: 600 }}>{rule.name}</TableCell>
                    <TableCell>{rule.pathwayType.toUpperCase()}</TableCell>
                    <TableCell>{INTERVENTION_TEMPLATE_OPTIONS.find((item) => item.key === rule.interventionTemplateKey)?.label ?? rule.interventionTemplateKey}</TableCell>
                    <TableCell>{ruleConditionSummary(rule) || 'No threshold configured'}</TableCell>
                    <TableCell>
                      <Chip size="small" label={rule.isActive ? 'active' : 'inactive'} color={rule.isActive ? 'success' : 'default'} />
                    </TableCell>
                    <TableCell>
                      <Button
                        size="small"
                        variant="outlined"
                        onClick={() => updateStepCareRule.mutate(rule)}
                        disabled={updateStepCareRule.isPending}
                        sx={{ textTransform: 'none', fontSize: 11 }}
                      >
                        {rule.isActive ? 'Deactivate' : 'Activate'}
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>
        )}
      </Paper>

      <Paper variant="outlined" sx={{ p: 2, mt: 2 }}>
        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2, gap: 2, flexWrap: 'wrap' }}>
          <Typography variant="h6" fontWeight={700} color="#3D484B">Wearables & Digital Phenotyping</Typography>
          <FormControl size="small" sx={{ minWidth: 320 }}>
            <InputLabel>Patient</InputLabel>
            <Select
              value={selectedWearablePatientId}
              label="Patient"
              onChange={(event) => setSelectedWearablePatientId(event.target.value)}
            >
              {patientIdsWithPathways.length === 0 && (
                <MenuItem value="">No pathway patients</MenuItem>
              )}
              {patientIdsWithPathways.map((patientId) => (
                <MenuItem key={patientId} value={patientId}>
                  {patientId}
                </MenuItem>
              ))}
            </Select>
          </FormControl>
        </Box>

        <Grid container spacing={2}>
          <Grid size={{ xs: 12, md: 6 }}>
            <Typography variant="subtitle2" fontWeight={700} sx={{ mb: 1 }}>Connected Sources</Typography>
            {selectedWearablePatientId ? (
              <TableContainer component={Paper} variant="outlined">
                <Table size="small">
                  <TableHead>
                    <TableRow sx={{ bgcolor: '#FBF8F5' }}>
                      <TableCell sx={{ fontWeight: 600 }}>Provider</TableCell>
                      <TableCell sx={{ fontWeight: 600 }}>Source</TableCell>
                      <TableCell sx={{ fontWeight: 600 }}>Status</TableCell>
                      <TableCell sx={{ fontWeight: 600 }}>Last Ingest</TableCell>
                      <TableCell sx={{ fontWeight: 600 }}>Actions</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {wearableSources.length === 0 && (
                      <TableRow>
                        <TableCell colSpan={5}>
                          <Typography variant="body2" color="text.secondary">No wearable sources for selected patient.</Typography>
                        </TableCell>
                      </TableRow>
                    )}
                    {wearableSources.map((source) => (
                      <TableRow key={source.id}>
                        <TableCell>{source.provider}</TableCell>
                        <TableCell>{source.deviceLabel}</TableCell>
                        <TableCell>
                          <Chip
                            size="small"
                            label={source.isActive ? 'active' : 'inactive'}
                            color={source.isActive ? 'success' : 'default'}
                          />
                        </TableCell>
                        <TableCell>{source.lastIngestedAt ? new Date(source.lastIngestedAt).toLocaleString('en-AU') : '—'}</TableCell>
                        <TableCell>
                          <Stack direction="row" spacing={1}>
                            <Button
                              size="small"
                              variant="outlined"
                              onClick={() =>
                                updateWearableSource.mutate({
                                  source,
                                  isActive: !source.isActive,
                                })
                              }
                              disabled={updateWearableSource.isPending}
                              sx={{ textTransform: 'none' }}
                            >
                              {source.isActive ? 'Deactivate' : 'Activate'}
                            </Button>
                            <Button
                              size="small"
                              variant="outlined"
                              onClick={() => requestWearableSync.mutate(source)}
                              disabled={requestWearableSync.isPending || !source.isActive}
                              sx={{ textTransform: 'none' }}
                            >
                              Sync
                            </Button>
                          </Stack>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </TableContainer>
            ) : (
              <Alert severity="info">Select a patient to manage wearable sources.</Alert>
            )}

            <Paper variant="outlined" sx={{ p: 1.5, mt: 1.5 }}>
              <Typography variant="subtitle2" fontWeight={700} sx={{ mb: 1 }}>Add Source</Typography>
              <Grid container spacing={1}>
                <Grid size={{ xs: 12, sm: 4 }}>
                  <FormControl fullWidth size="small">
                    <InputLabel>Provider</InputLabel>
                    <Select
                      value={wearableForm.provider}
                      label="Provider"
                      onChange={(event) =>
                        setWearableForm((prev) => ({
                          ...prev,
                          provider: event.target.value as WearableProvider,
                        }))
                      }
                    >
                      {wearableProviders.map((provider) => (
                        <MenuItem
                          key={provider.provider}
                          value={provider.provider}
                          disabled={!provider.isConfigured}
                        >
                          {provider.displayName}{provider.isConfigured ? '' : ' (not configured)'}
                        </MenuItem>
                      ))}
                    </Select>
                  </FormControl>
                </Grid>
                <Grid size={{ xs: 12, sm: 4 }}>
                  <TextField
                    size="small"
                    fullWidth
                    label="Source Label"
                    value={wearableForm.deviceLabel}
                    onChange={(event) =>
                      setWearableForm((prev) => ({ ...prev, deviceLabel: event.target.value }))
                    }
                  />
                </Grid>
                <Grid size={{ xs: 12, sm: 4 }}>
                  <TextField
                    size="small"
                    fullWidth
                    label="External Device ID (optional)"
                    value={wearableForm.externalDeviceId}
                    onChange={(event) =>
                      setWearableForm((prev) => ({ ...prev, externalDeviceId: event.target.value }))
                    }
                  />
                </Grid>
                <Grid size={{ xs: 12 }}>
                  <Button
                    variant="contained"
                    onClick={() => createWearableSource.mutate()}
                    disabled={
                      createWearableSource.isPending
                      || !selectedWearablePatientId
                      || wearableForm.deviceLabel.trim().length === 0
                    }
                    sx={{ bgcolor: '#b8621a', '&:hover': { bgcolor: '#d6741f' }, textTransform: 'none' }}
                  >
                    Add Source
                  </Button>
                </Grid>
              </Grid>
            </Paper>
          </Grid>

          <Grid size={{ xs: 12, md: 6 }}>
            <Typography variant="subtitle2" fontWeight={700} sx={{ mb: 1 }}>Recent Phenotypes</Typography>
            {selectedWearablePatientId ? (
              <TableContainer component={Paper} variant="outlined">
                <Table size="small">
                  <TableHead>
                    <TableRow sx={{ bgcolor: '#FBF8F5' }}>
                      <TableCell sx={{ fontWeight: 600 }}>Day</TableCell>
                      <TableCell sx={{ fontWeight: 600 }}>Risk Band</TableCell>
                      <TableCell sx={{ fontWeight: 600 }}>Risk Index</TableCell>
                      <TableCell sx={{ fontWeight: 600 }}>Adherence</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {wearablePhenotypes.length === 0 && (
                      <TableRow>
                        <TableCell colSpan={4}>
                          <Typography variant="body2" color="text.secondary">No phenotype snapshots yet.</Typography>
                        </TableCell>
                      </TableRow>
                    )}
                    {wearablePhenotypes.map((row) => (
                      <TableRow key={row.id}>
                        <TableCell>{new Date(row.computationDay).toLocaleDateString('en-AU')}</TableCell>
                        <TableCell>
                          <Chip
                            size="small"
                            label={row.riskBand}
                            color={row.riskBand === 'critical' ? 'error' : row.riskBand === 'high' ? 'warning' : row.riskBand === 'moderate' ? 'primary' : 'success'}
                          />
                        </TableCell>
                        <TableCell>{row.riskIndex.toFixed(1)}</TableCell>
                        <TableCell>{row.adherenceScore.toFixed(1)}%</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </TableContainer>
            ) : (
              <Alert severity="info">Select a patient to view phenotype timeline.</Alert>
            )}

            <Paper variant="outlined" sx={{ p: 1.5, mt: 1.5 }}>
              <Typography variant="subtitle2" fontWeight={700} sx={{ mb: 1 }}>Provider Readiness</Typography>
              <Stack spacing={1}>
                {wearableProviders.map((provider) => (
                  <Box key={provider.provider} sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <Typography variant="body2">{provider.displayName}</Typography>
                    <Chip
                      size="small"
                      label={provider.isConfigured ? 'configured' : 'not configured'}
                      color={provider.isConfigured ? 'success' : 'warning'}
                    />
                  </Box>
                ))}
              </Stack>
            </Paper>
          </Grid>
        </Grid>
      </Paper>

      <Paper variant="outlined" sx={{ p: 2, mt: 2 }}>
        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
          <Typography variant="h6" fontWeight={700} color="#3D484B">Research Lane & Effectiveness Analytics</Typography>
          <FormControl size="small" sx={{ minWidth: 150 }}>
            <InputLabel>Window</InputLabel>
            <Select
              value={String(periodDays)}
              label="Window"
              onChange={(event) => setPeriodDays(Number(event.target.value))}
            >
              <MenuItem value="90">Last 90 days</MenuItem>
              <MenuItem value="180">Last 180 days</MenuItem>
              <MenuItem value="365">Last 365 days</MenuItem>
            </Select>
          </FormControl>
        </Box>

        {!researchLane ? (
          <LinearProgress />
        ) : (
          <Stack spacing={2}>
            <Grid container spacing={1.5}>
              <Grid size={{ xs: 6, md: 2 }}>
                <Paper variant="outlined" sx={{ p: 1.2 }}>
                  <Typography variant="caption" color="text.secondary">Active Pathways</Typography>
                  <Typography variant="h6" fontWeight={700}>{researchLane.activePathways}</Typography>
                </Paper>
              </Grid>
              <Grid size={{ xs: 6, md: 2 }}>
                <Paper variant="outlined" sx={{ p: 1.2 }}>
                  <Typography variant="caption" color="text.secondary">Assigned Packs</Typography>
                  <Typography variant="h6" fontWeight={700}>{researchLane.assignedInterventionPacks}</Typography>
                </Paper>
              </Grid>
              <Grid size={{ xs: 6, md: 2 }}>
                <Paper variant="outlined" sx={{ p: 1.2 }}>
                  <Typography variant="caption" color="text.secondary">Pack Completion</Typography>
                  <Typography variant="h6" fontWeight={700}>{researchLane.interventionCompletionRatePct.toFixed(1)}%</Typography>
                </Paper>
              </Grid>
              <Grid size={{ xs: 6, md: 2 }}>
                <Paper variant="outlined" sx={{ p: 1.2 }}>
                  <Typography variant="caption" color="text.secondary">Auto Assignments</Typography>
                  <Typography variant="h6" fontWeight={700}>{researchLane.stepCareAutoAssignments}</Typography>
                </Paper>
              </Grid>
              <Grid size={{ xs: 6, md: 2 }}>
                <Paper variant="outlined" sx={{ p: 1.2 }}>
                  <Typography variant="caption" color="text.secondary">Escalations</Typography>
                  <Typography variant="h6" fontWeight={700}>{researchLane.stepCareEscalations}</Typography>
                </Paper>
              </Grid>
              <Grid size={{ xs: 6, md: 2 }}>
                <Paper variant="outlined" sx={{ p: 1.2 }}>
                  <Typography variant="caption" color="text.secondary">Phenotype Coverage</Typography>
                  <Typography variant="h6" fontWeight={700}>{researchLane.digitalPhenotypingCoveragePct.toFixed(1)}%</Typography>
                </Paper>
              </Grid>
            </Grid>

            <Typography variant="body2" color="text.secondary">
              Outcome delta cohort ({researchLane.outcomeDelta.cohortSize} patients):
              {' '}PHQ-9 Δ {researchLane.outcomeDelta.phq9AverageDelta?.toFixed(2) ?? 'n/a'},
              {' '}GAD-7 Δ {researchLane.outcomeDelta.gad7AverageDelta?.toFixed(2) ?? 'n/a'}.
            </Typography>

            <TableContainer component={Paper} variant="outlined">
              <Table size="small">
                <TableHead>
                  <TableRow sx={{ bgcolor: '#FBF8F5' }}>
                    <TableCell sx={{ fontWeight: 600 }}>Template</TableCell>
                    <TableCell sx={{ fontWeight: 600 }}>Assigned</TableCell>
                    <TableCell sx={{ fontWeight: 600 }}>Completed</TableCell>
                    <TableCell sx={{ fontWeight: 600 }}>Completion Rate</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {researchLane.templateEffectiveness.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={4}>
                        <Typography variant="body2" color="text.secondary">No intervention pack activity in selected window.</Typography>
                      </TableCell>
                    </TableRow>
                  )}
                  {researchLane.templateEffectiveness.map((item) => (
                    <TableRow key={item.templateKey}>
                      <TableCell>{INTERVENTION_TEMPLATE_OPTIONS.find((option) => option.key === item.templateKey)?.label ?? item.templateKey}</TableCell>
                      <TableCell>{item.assignedCount}</TableCell>
                      <TableCell>{item.completedCount}</TableCell>
                      <TableCell>{item.completionRatePct.toFixed(1)}%</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TableContainer>
          </Stack>
        )}
      </Paper>

      <Box sx={{ mt: 2 }}>
        <BehavioralEngagementPanel
          patientIds={patientIdsWithPathways}
          selectedPatientId={selectedWearablePatientId}
          onSelectPatientId={setSelectedWearablePatientId}
        />
      </Box>

      <Dialog aria-labelledby="dialog-title" open={addOpen} onClose={() => setAddOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle id="dialog-title" sx={{ fontWeight: 700 }}>New Treatment Pathway</DialogTitle>
        <Divider />
        <DialogContent>
          <Grid container spacing={2} sx={{ mt: 0.5 }}>
            <Grid size={{ xs: 12 }}>
              <TextField
                label="Patient ID"
                fullWidth
                size="small"
                value={form.patientId ?? ''}
                onChange={(event) => setForm((prev) => ({ ...prev, patientId: event.target.value }))}
                helperText="Use the patient ID from the patient profile."
              />
            </Grid>
            <Grid size={{ xs: 8 }}>
              <FormControl fullWidth size="small"><InputLabel>Pathway Type</InputLabel>
                <Select value={form.pathwayType} onChange={e => setForm(p => ({ ...p, pathwayType: e.target.value }))} label="Pathway Type">
                  {PATHWAY_TYPES.map(t => <MenuItem key={t.id} value={t.id}>{t.label}</MenuItem>)}
                </Select>
              </FormControl>
            </Grid>
            <Grid size={{ xs: 4 }}><TextField label="Start Date" type="date" fullWidth size="small" value={form.startDate} onChange={e => setForm(p => ({ ...p, startDate: e.target.value }))} slotProps={{ inputLabel: { shrink: true } }} /></Grid>
            <Grid size={{ xs: 12 }}><TextField label="Notes" fullWidth multiline rows={2} size="small" value={form.notes ?? ''} onChange={e => setForm(p => ({ ...p, notes: e.target.value }))} /></Grid>
          </Grid>
        </DialogContent>
        <DialogActions sx={{ px: 3, py: 2 }}>
          <Button onClick={() => setAddOpen(false)}>Cancel</Button>
          <Button variant="contained" onClick={() => createMut.mutate(form)} disabled={createMut.isPending || !form.patientId}
            sx={{ bgcolor: '#b8621a', '&:hover': { bgcolor: '#d6741f' } }}>
            {createMut.isPending ? 'Creating...' : 'Start Pathway'}
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog open={stepCareOpen} onClose={() => setStepCareOpen(false)} maxWidth="md" fullWidth>
        <DialogTitle sx={{ fontWeight: 700 }}>Create Step-Care Automation Rule</DialogTitle>
        <Divider />
        <DialogContent>
          <Grid container spacing={2} sx={{ mt: 0.5 }}>
            <Grid size={{ xs: 12, md: 6 }}>
              <TextField
                fullWidth
                size="small"
                label="Rule Name"
                value={stepCareForm.name}
                onChange={(event) => setStepCareForm((prev) => ({ ...prev, name: event.target.value }))}
              />
            </Grid>
            <Grid size={{ xs: 12, md: 3 }}>
              <FormControl fullWidth size="small">
                <InputLabel>Pathway</InputLabel>
                <Select
                  value={stepCareForm.pathwayType}
                  label="Pathway"
                  onChange={(event) => setStepCareForm((prev) => ({ ...prev, pathwayType: event.target.value }))}
                >
                  {PATHWAY_TYPES.map((item) => (
                    <MenuItem key={item.id} value={item.id}>{item.id.toUpperCase()}</MenuItem>
                  ))}
                </Select>
              </FormControl>
            </Grid>
            <Grid size={{ xs: 12, md: 3 }}>
              <FormControl fullWidth size="small">
                <InputLabel>Intervention</InputLabel>
                <Select
                  value={stepCareForm.interventionTemplateKey}
                  label="Intervention"
                  onChange={(event) =>
                    setStepCareForm((prev) => ({
                      ...prev,
                      interventionTemplateKey: event.target.value as PathwayInterventionTemplateKey,
                    }))
                  }
                >
                  {INTERVENTION_TEMPLATE_OPTIONS.map((option) => (
                    <MenuItem key={option.key} value={option.key}>{option.label}</MenuItem>
                  ))}
                </Select>
              </FormControl>
            </Grid>
            <Grid size={{ xs: 12 }}>
              <TextField
                fullWidth
                size="small"
                label="Description (optional)"
                value={stepCareForm.description}
                onChange={(event) => setStepCareForm((prev) => ({ ...prev, description: event.target.value }))}
              />
            </Grid>
            <Grid size={{ xs: 6, md: 2 }}>
              <TextField
                fullWidth
                size="small"
                label="Mood ≤"
                value={stepCareForm.moodBelowThreshold}
                onChange={(event) => setStepCareForm((prev) => ({ ...prev, moodBelowThreshold: event.target.value }))}
              />
            </Grid>
            <Grid size={{ xs: 6, md: 2 }}>
              <TextField
                fullWidth
                size="small"
                label="Anxiety ≥"
                value={stepCareForm.anxietyAboveThreshold}
                onChange={(event) => setStepCareForm((prev) => ({ ...prev, anxietyAboveThreshold: event.target.value }))}
              />
            </Grid>
            <Grid size={{ xs: 6, md: 2 }}>
              <TextField
                fullWidth
                size="small"
                label="Sleep hours ≤"
                value={stepCareForm.sleepHoursBelow}
                onChange={(event) => setStepCareForm((prev) => ({ ...prev, sleepHoursBelow: event.target.value }))}
              />
            </Grid>
            <Grid size={{ xs: 6, md: 2 }}>
              <TextField
                fullWidth
                size="small"
                label="PHQ-9 ≥"
                value={stepCareForm.phq9MinScore}
                onChange={(event) => setStepCareForm((prev) => ({ ...prev, phq9MinScore: event.target.value }))}
              />
            </Grid>
            <Grid size={{ xs: 6, md: 2 }}>
              <TextField
                fullWidth
                size="small"
                label="GAD-7 ≥"
                value={stepCareForm.gad7MinScore}
                onChange={(event) => setStepCareForm((prev) => ({ ...prev, gad7MinScore: event.target.value }))}
              />
            </Grid>
            <Grid size={{ xs: 6, md: 2 }}>
              <TextField
                fullWidth
                size="small"
                label="Risk index ≥"
                value={stepCareForm.riskIndexMin}
                onChange={(event) => setStepCareForm((prev) => ({ ...prev, riskIndexMin: event.target.value }))}
              />
            </Grid>
          </Grid>
        </DialogContent>
        <DialogActions sx={{ px: 3, py: 2 }}>
          <Button onClick={() => setStepCareOpen(false)}>Cancel</Button>
          <Button
            variant="contained"
            onClick={() => createStepCareRule.mutate()}
            disabled={createStepCareRule.isPending || stepCareForm.name.trim().length === 0}
            sx={{ bgcolor: '#b8621a', '&:hover': { bgcolor: '#d6741f' } }}
          >
            {createStepCareRule.isPending ? 'Saving...' : 'Create Rule'}
          </Button>
        </DialogActions>
      </Dialog>

      {digitalPathway && (
        <PathwayDigitalCareDialog
          open={!!digitalPathway}
          pathwayId={digitalPathway.id}
          pathwayName={digitalPathway.pathwayName}
          onClose={() => setDigitalPathway(null)}
        />
      )}
    </Box>
  );
}
