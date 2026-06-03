import {
  Alert,
  Box,
  Button,
  Chip,
  FormControl,
  Grid,
  InputLabel,
  MenuItem,
  Paper,
  Select,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  TextField,
  Typography,
} from '@mui/material';
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  BehaviorContract,
  BehavioralSegmentCode,
  ChoiceArchitectureDefaults,
  EscalationSlaBoardItem,
  FrictionRadarItem,
  MicroLearningCard,
  MicroLearningRule,
  RecoveryStreakItem,
  RoutineActionKind,
  RoutineConditionKind,
  RoutinePlan,
} from '@signacare/shared';
import { apiClient } from '../../../shared/services/apiClient';
import { pathwayKeys } from '../queryKeys';

interface BehavioralEngagementPanelProps {
  patientIds: string[];
  selectedPatientId: string;
  onSelectPatientId: (value: string) => void;
}

type ContractFormState = {
  triggerText: string;
  commitmentBehavior: string;
  fallbackPlan: string;
  reviewDate: string;
  accountabilityPartner: string;
};

type RoutineFormState = {
  name: string;
  conditionKind: RoutineConditionKind;
  conditionThreshold: string;
  thenActionKind: RoutineActionKind;
  thenActionText: string;
  fallbackAfterMinutes: string;
  fallbackActionText: string;
  reviewDate: string;
};

type MicroRuleFormState = {
  name: string;
  trackingType: 'anxiety' | 'mood' | 'sleep_hours';
  deltaThreshold: string;
  windowDays: string;
  cardId: string;
  cooldownDays: string;
};

export function BehavioralEngagementPanel(props: BehavioralEngagementPanelProps) {
  const qc = useQueryClient();
  const [error, setError] = useState('');
  const [contractForm, setContractForm] = useState<ContractFormState>({
    triggerText: '',
    commitmentBehavior: '',
    fallbackPlan: '',
    reviewDate: new Date().toISOString().slice(0, 10),
    accountabilityPartner: '',
  });
  const [routineForm, setRoutineForm] = useState<RoutineFormState>({
    name: '',
    conditionKind: 'anxiety_gte',
    conditionThreshold: '7',
    thenActionKind: 'open_grounding_card',
    thenActionText: 'Open grounding card immediately and re-rate distress after 20 minutes.',
    fallbackAfterMinutes: '20',
    fallbackActionText: 'If no improvement, call support line and alert care team.',
    reviewDate: new Date().toISOString().slice(0, 10),
  });
  const [segmentOverride, setSegmentOverride] = useState<BehavioralSegmentCode>('motivated');
  const [segmentReason, setSegmentReason] = useState('');
  const [ruleForm, setRuleForm] = useState<MicroRuleFormState>({
    name: '',
    trackingType: 'anxiety',
    deltaThreshold: '3',
    windowDays: '3',
    cardId: '',
    cooldownDays: '7',
  });
  const [choiceDefaultsDraft, setChoiceDefaultsDraft] = useState<{
    nextReviewDueDaysDefault: string;
    safetyPlanRefreshDaysDefault: string;
    medicationReminderWindowMinutes: string;
  }>({
    nextReviewDueDaysDefault: '',
    safetyPlanRefreshDaysDefault: '',
    medicationReminderWindowMinutes: '',
  });

  const hasPatient = props.selectedPatientId.length > 0;

  const contractsQuery = useQuery({
    queryKey: pathwayKeys.behaviorContracts(props.selectedPatientId || 'none'),
    enabled: hasPatient,
    queryFn: async () => {
      const res = await apiClient.get<{ contracts?: BehaviorContract[] }>(
        `pathways/behavioral/contracts/${props.selectedPatientId}`,
      );
      return Array.isArray(res.contracts) ? res.contracts : [];
    },
  });

  const routinesQuery = useQuery({
    queryKey: pathwayKeys.routines(props.selectedPatientId || 'none'),
    enabled: hasPatient,
    queryFn: async () => {
      const res = await apiClient.get<{ routines?: RoutinePlan[] }>(
        `pathways/behavioral/routines/${props.selectedPatientId}`,
      );
      return Array.isArray(res.routines) ? res.routines : [];
    },
  });

  const streakQuery = useQuery({
    queryKey: pathwayKeys.streaks(props.selectedPatientId || 'none'),
    enabled: hasPatient,
    queryFn: async () => {
      const res = await apiClient.get<{ items?: RecoveryStreakItem[] }>(
        `pathways/behavioral/streaks/${props.selectedPatientId}`,
      );
      return Array.isArray(res.items) ? res.items : [];
    },
  });

  const frictionQuery = useQuery({
    queryKey: pathwayKeys.friction(props.selectedPatientId || 'none'),
    enabled: hasPatient,
    queryFn: async () => {
      const res = await apiClient.get<{ items?: FrictionRadarItem[] }>(
        `pathways/behavioral/friction/${props.selectedPatientId}`,
      );
      return Array.isArray(res.items) ? res.items : [];
    },
  });

  const segmentQuery = useQuery({
    queryKey: pathwayKeys.segment(props.selectedPatientId || 'none'),
    enabled: hasPatient,
    queryFn: () =>
      apiClient.get<{
        segment: BehavioralSegmentCode;
        confidence: number;
        rationale: string[];
        overrideReason?: string | null;
      }>(`pathways/behavioral/segments/${props.selectedPatientId}`),
  });

  const slaBoardQuery = useQuery({
    queryKey: pathwayKeys.slaBoard(),
    queryFn: async () => {
      const res = await apiClient.get<{ items?: EscalationSlaBoardItem[] }>('pathways/behavioral/sla-board');
      return Array.isArray(res.items) ? res.items : [];
    },
  });

  const cardsQuery = useQuery({
    queryKey: pathwayKeys.microLearningCards(),
    queryFn: async () => {
      const res = await apiClient.get<{ cards?: MicroLearningCard[] }>('pathways/behavioral/micro-learning/cards');
      return Array.isArray(res.cards) ? res.cards : [];
    },
  });

  const rulesQuery = useQuery({
    queryKey: pathwayKeys.microLearningRules(),
    queryFn: async () => {
      const res = await apiClient.get<{ rules?: MicroLearningRule[] }>('pathways/behavioral/micro-learning/rules');
      return Array.isArray(res.rules) ? res.rules : [];
    },
  });

  const assignmentsQuery = useQuery({
    queryKey: pathwayKeys.microLearningAssignments(props.selectedPatientId || 'none'),
    enabled: hasPatient,
    queryFn: async () => {
      const res = await apiClient.get<{ assignments?: Array<{ id: string; cardId: string; status: string; sourceReason?: string | null; assignedAt: string }> }>(
        `pathways/behavioral/micro-learning/assignments/${props.selectedPatientId}`,
      );
      return Array.isArray(res.assignments) ? res.assignments : [];
    },
  });

  const choiceDefaultsQuery = useQuery({
    queryKey: pathwayKeys.choiceArchitectureDefaults(),
    queryFn: () =>
      apiClient.get<ChoiceArchitectureDefaults>('pathways/behavioral/choice-architecture/defaults'),
  });

  const selectedCardOptions = cardsQuery.data?.map((card) => ({ id: card.id, label: card.title })) ?? [];

  const createContractMutation = useMutation({
    mutationFn: async () => {
      if (!props.selectedPatientId) return;
      await apiClient.post('pathways/behavioral/contracts', {
        patientId: props.selectedPatientId,
        triggerText: contractForm.triggerText.trim(),
        commitmentBehavior: contractForm.commitmentBehavior.trim(),
        fallbackPlan: contractForm.fallbackPlan.trim(),
        reviewDate: contractForm.reviewDate,
        accountabilityPartner: contractForm.accountabilityPartner.trim() || undefined,
      });
    },
    onSuccess: () => {
      setContractForm({
        triggerText: '',
        commitmentBehavior: '',
        fallbackPlan: '',
        reviewDate: new Date().toISOString().slice(0, 10),
        accountabilityPartner: '',
      });
      qc.invalidateQueries({ queryKey: pathwayKeys.behaviorContracts(props.selectedPatientId || 'none') });
      qc.invalidateQueries({ queryKey: pathwayKeys.friction(props.selectedPatientId || 'none') });
      setError('');
    },
    onError: (e: unknown) => setError((e as Error).message || 'Failed to create behavior contract'),
  });

  const createRoutineMutation = useMutation({
    mutationFn: async () => {
      if (!props.selectedPatientId) return;
      await apiClient.post('pathways/behavioral/routines', {
        patientId: props.selectedPatientId,
        name: routineForm.name.trim(),
        conditionKind: routineForm.conditionKind,
        conditionThreshold: routineForm.conditionThreshold.trim() ? Number(routineForm.conditionThreshold) : undefined,
        conditionWindowMinutes: 60,
        thenActionKind: routineForm.thenActionKind,
        thenActionText: routineForm.thenActionText.trim(),
        fallbackAfterMinutes: routineForm.fallbackAfterMinutes.trim() ? Number(routineForm.fallbackAfterMinutes) : undefined,
        fallbackActionText: routineForm.fallbackActionText.trim() || undefined,
        reviewDate: routineForm.reviewDate,
        isActive: true,
      });
    },
    onSuccess: () => {
      setRoutineForm({
        name: '',
        conditionKind: 'anxiety_gte',
        conditionThreshold: '7',
        thenActionKind: 'open_grounding_card',
        thenActionText: 'Open grounding card immediately and re-rate distress after 20 minutes.',
        fallbackAfterMinutes: '20',
        fallbackActionText: 'If no improvement, call support line and alert care team.',
        reviewDate: new Date().toISOString().slice(0, 10),
      });
      qc.invalidateQueries({ queryKey: pathwayKeys.routines(props.selectedPatientId || 'none') });
      setError('');
    },
    onError: (e: unknown) => setError((e as Error).message || 'Failed to create routine plan'),
  });

  const overrideSegmentMutation = useMutation({
    mutationFn: async () => {
      if (!props.selectedPatientId) return;
      await apiClient.put(`pathways/behavioral/segments/${props.selectedPatientId}/override`, {
        segment: segmentOverride,
        confidence: 0.95,
        overrideReason: segmentReason.trim(),
      });
    },
    onSuccess: () => {
      setSegmentReason('');
      qc.invalidateQueries({ queryKey: pathwayKeys.segment(props.selectedPatientId || 'none') });
      setError('');
    },
    onError: (e: unknown) => setError((e as Error).message || 'Failed to set segment override'),
  });

  const createRuleMutation = useMutation({
    mutationFn: async () => {
      await apiClient.post('pathways/behavioral/micro-learning/rules', {
        name: ruleForm.name.trim(),
        trackingType: ruleForm.trackingType,
        deltaThreshold: Number(ruleForm.deltaThreshold),
        windowDays: Number(ruleForm.windowDays),
        cardId: ruleForm.cardId,
        cooldownDays: Number(ruleForm.cooldownDays),
        isActive: true,
      });
    },
    onSuccess: () => {
      setRuleForm({
        name: '',
        trackingType: 'anxiety',
        deltaThreshold: '3',
        windowDays: '3',
        cardId: selectedCardOptions[0]?.id ?? '',
        cooldownDays: '7',
      });
      qc.invalidateQueries({ queryKey: pathwayKeys.microLearningRules() });
      setError('');
    },
    onError: (e: unknown) => setError((e as Error).message || 'Failed to create micro-learning rule'),
  });

  const saveChoiceDefaultsMutation = useMutation({
    mutationFn: async () => {
      await apiClient.patch('pathways/behavioral/choice-architecture/defaults', {
        nextReviewDueDaysDefault: Number(choiceDefaultsDraft.nextReviewDueDaysDefault),
        safetyPlanRefreshDaysDefault: Number(choiceDefaultsDraft.safetyPlanRefreshDaysDefault),
        medicationReminderWindowMinutes: Number(choiceDefaultsDraft.medicationReminderWindowMinutes),
      });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: pathwayKeys.choiceArchitectureDefaults() });
      setError('');
    },
    onError: (e: unknown) => setError((e as Error).message || 'Failed to save defaults'),
  });

  const choiceDefaults = choiceDefaultsQuery.data;
  const effectiveChoiceDraft = choiceDefaults
    ? {
      nextReviewDueDaysDefault: choiceDefaultsDraft.nextReviewDueDaysDefault || String(choiceDefaults.nextReviewDueDaysDefault),
      safetyPlanRefreshDaysDefault: choiceDefaultsDraft.safetyPlanRefreshDaysDefault || String(choiceDefaults.safetyPlanRefreshDaysDefault),
      medicationReminderWindowMinutes: choiceDefaultsDraft.medicationReminderWindowMinutes || String(choiceDefaults.medicationReminderWindowMinutes),
    }
    : choiceDefaultsDraft;

  return (
    <Paper variant="outlined" sx={{ p: 2, borderRadius: 2 }}>
      <Stack spacing={2}>
        <Typography variant="h6" fontWeight={700}>
          Behavioral Contracts, Routines, Friction & SLA
        </Typography>
        <Typography variant="body2" color="text.secondary">
          Enterprise behavioral layer linked to pathways, clinical intelligence, tasks, referrals, and Viva micro-learning.
        </Typography>
        {error && <Alert severity="warning">{error}</Alert>}
        <FormControl size="small" sx={{ maxWidth: 360 }}>
          <InputLabel>Patient Scope</InputLabel>
          <Select
            value={props.selectedPatientId}
            label="Patient Scope"
            onChange={(event) => props.onSelectPatientId(String(event.target.value))}
          >
            {props.patientIds.map((patientId) => (
              <MenuItem key={patientId} value={patientId}>
                {patientId}
              </MenuItem>
            ))}
          </Select>
        </FormControl>

        {!hasPatient && (
          <Alert severity="info">Select a patient with a pathway to activate behavioral workflows.</Alert>
        )}

        {hasPatient && (
          <Grid container spacing={2}>
            <Grid size={{ xs: 12, md: 6 }}>
              <Paper variant="outlined" sx={{ p: 1.5 }}>
                <Typography variant="subtitle2" fontWeight={700} sx={{ mb: 1 }}>
                  Behavior Contract Object
                </Typography>
                <Stack spacing={1}>
                  <TextField size="small" label="Trigger" value={contractForm.triggerText} onChange={(e) => setContractForm((v) => ({ ...v, triggerText: e.target.value }))} />
                  <TextField size="small" label="Commitment Behavior" value={contractForm.commitmentBehavior} onChange={(e) => setContractForm((v) => ({ ...v, commitmentBehavior: e.target.value }))} />
                  <TextField size="small" label="Fallback Plan" value={contractForm.fallbackPlan} onChange={(e) => setContractForm((v) => ({ ...v, fallbackPlan: e.target.value }))} />
                  <TextField size="small" label="Review Date" type="date" value={contractForm.reviewDate} onChange={(e) => setContractForm((v) => ({ ...v, reviewDate: e.target.value }))} slotProps={{ inputLabel: { shrink: true } }} />
                  <TextField size="small" label="Accountability Partner" value={contractForm.accountabilityPartner} onChange={(e) => setContractForm((v) => ({ ...v, accountabilityPartner: e.target.value }))} />
                  <Button
                    size="small"
                    variant="contained"
                    onClick={() => createContractMutation.mutate()}
                    disabled={createContractMutation.isPending || !contractForm.triggerText.trim() || !contractForm.commitmentBehavior.trim() || !contractForm.fallbackPlan.trim()}
                  >
                    Add Contract
                  </Button>
                </Stack>
                <Table size="small" sx={{ mt: 1 }}>
                  <TableHead>
                    <TableRow>
                      <TableCell>Trigger</TableCell>
                      <TableCell>Status</TableCell>
                      <TableCell>Review</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {(contractsQuery.data ?? []).map((contract) => (
                      <TableRow key={contract.id}>
                        <TableCell>{contract.triggerText}</TableCell>
                        <TableCell><Chip size="small" label={contract.adherenceStatus} /></TableCell>
                        <TableCell>{contract.reviewDate}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </Paper>
            </Grid>

            <Grid size={{ xs: 12, md: 6 }}>
              <Paper variant="outlined" sx={{ p: 1.5 }}>
                <Typography variant="subtitle2" fontWeight={700} sx={{ mb: 1 }}>
                  Routine Builder (If → Then → Fallback)
                </Typography>
                <Stack spacing={1}>
                  <TextField size="small" label="Routine Name" value={routineForm.name} onChange={(e) => setRoutineForm((v) => ({ ...v, name: e.target.value }))} />
                  <FormControl size="small">
                    <InputLabel>Condition</InputLabel>
                    <Select value={routineForm.conditionKind} label="Condition" onChange={(e) => setRoutineForm((v) => ({ ...v, conditionKind: e.target.value as RoutineConditionKind }))}>
                      <MenuItem value="anxiety_gte">Anxiety ≥ threshold</MenuItem>
                      <MenuItem value="mood_lte">Mood ≤ threshold</MenuItem>
                      <MenuItem value="sleep_hours_lte">Sleep hours ≤ threshold</MenuItem>
                      <MenuItem value="manual_signal">Manual distress signal</MenuItem>
                      <MenuItem value="custom">Custom</MenuItem>
                    </Select>
                  </FormControl>
                  <TextField size="small" label="Condition Threshold" value={routineForm.conditionThreshold} onChange={(e) => setRoutineForm((v) => ({ ...v, conditionThreshold: e.target.value }))} />
                  <TextField size="small" label="Then Action" value={routineForm.thenActionText} onChange={(e) => setRoutineForm((v) => ({ ...v, thenActionText: e.target.value }))} />
                  <TextField size="small" label="Fallback after minutes" value={routineForm.fallbackAfterMinutes} onChange={(e) => setRoutineForm((v) => ({ ...v, fallbackAfterMinutes: e.target.value }))} />
                  <TextField size="small" label="Fallback Action" value={routineForm.fallbackActionText} onChange={(e) => setRoutineForm((v) => ({ ...v, fallbackActionText: e.target.value }))} />
                  <Button
                    size="small"
                    variant="contained"
                    onClick={() => createRoutineMutation.mutate()}
                    disabled={createRoutineMutation.isPending || !routineForm.name.trim() || !routineForm.thenActionText.trim()}
                  >
                    Add Routine
                  </Button>
                </Stack>
                <Table size="small" sx={{ mt: 1 }}>
                  <TableHead>
                    <TableRow>
                      <TableCell>Name</TableCell>
                      <TableCell>Condition</TableCell>
                      <TableCell>Active</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {(routinesQuery.data ?? []).map((routine) => (
                      <TableRow key={routine.id}>
                        <TableCell>{routine.name}</TableCell>
                        <TableCell>{routine.conditionKind}</TableCell>
                        <TableCell><Chip size="small" label={routine.isActive ? 'yes' : 'no'} color={routine.isActive ? 'success' : 'default'} /></TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </Paper>
            </Grid>

            <Grid size={{ xs: 12 }}>
              <Paper variant="outlined" sx={{ p: 1.5 }}>
                <Typography variant="subtitle2" fontWeight={700} sx={{ mb: 1 }}>
                  Recovery Streak Engine + Friction Radar + Segmentation
                </Typography>
                <Stack direction={{ xs: 'column', md: 'row' }} spacing={2}>
                  <Box sx={{ flex: 1 }}>
                    <Typography variant="caption" color="text.secondary">Recovery Streaks</Typography>
                    <Stack direction="row" spacing={1} flexWrap="wrap" sx={{ mt: 0.5 }}>
                      {(streakQuery.data ?? []).map((item) => (
                        <Chip key={item.eventType} label={`${item.eventType}: ${item.currentStreakDays}d`} />
                      ))}
                    </Stack>
                  </Box>
                  <Box sx={{ flex: 1 }}>
                    <Typography variant="caption" color="text.secondary">Friction Radar</Typography>
                    <Stack spacing={0.5} sx={{ mt: 0.5 }}>
                      {(frictionQuery.data ?? []).map((item) => (
                        <Alert key={item.key} severity={item.severity === 'critical' || item.severity === 'high' ? 'warning' : 'info'}>
                          {item.label} ({item.count}) — {item.suggestedAction}
                        </Alert>
                      ))}
                    </Stack>
                  </Box>
                  <Box sx={{ flex: 1 }}>
                    <Typography variant="caption" color="text.secondary">Behavioral Segment</Typography>
                    {segmentQuery.data && (
                      <Stack spacing={1} sx={{ mt: 0.5 }}>
                        <Chip label={`${segmentQuery.data.segment} (${Math.round(segmentQuery.data.confidence * 100)}%)`} color="primary" />
                        <FormControl size="small">
                          <InputLabel>Override Segment</InputLabel>
                          <Select value={segmentOverride} label="Override Segment" onChange={(e) => setSegmentOverride(e.target.value as BehavioralSegmentCode)}>
                            <MenuItem value="motivated">motivated</MenuItem>
                            <MenuItem value="ambivalent">ambivalent</MenuItem>
                            <MenuItem value="avoidant">avoidant</MenuItem>
                            <MenuItem value="overwhelmed">overwhelmed</MenuItem>
                            <MenuItem value="externally_supported">externally_supported</MenuItem>
                            <MenuItem value="resistant">resistant</MenuItem>
                          </Select>
                        </FormControl>
                        <TextField size="small" label="Override reason" value={segmentReason} onChange={(e) => setSegmentReason(e.target.value)} />
                        <Button size="small" variant="outlined" disabled={!segmentReason.trim() || overrideSegmentMutation.isPending} onClick={() => overrideSegmentMutation.mutate()}>
                          Apply Override
                        </Button>
                      </Stack>
                    )}
                  </Box>
                </Stack>
              </Paper>
            </Grid>

            <Grid size={{ xs: 12 }}>
              <Paper variant="outlined" sx={{ p: 1.5 }}>
                <Typography variant="subtitle2" fontWeight={700} sx={{ mb: 1 }}>
                  Escalation SLA Board (Tasks + Referrals)
                </Typography>
                <Table size="small">
                  <TableHead>
                    <TableRow>
                      <TableCell>Queue</TableCell>
                      <TableCell>Title</TableCell>
                      <TableCell>Status</TableCell>
                      <TableCell>Remaining</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {(slaBoardQuery.data ?? []).slice(0, 8).map((item) => (
                      <TableRow key={item.id}>
                        <TableCell>{item.queueType}</TableCell>
                        <TableCell>{item.title}</TableCell>
                        <TableCell>{item.status}</TableCell>
                        <TableCell>
                          <Chip
                            size="small"
                            label={`${Math.floor(item.remainingSeconds / 3600)}h`}
                            color={item.isBreached ? 'error' : 'default'}
                          />
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </Paper>
            </Grid>

            <Grid size={{ xs: 12, md: 6 }}>
              <Paper variant="outlined" sx={{ p: 1.5 }}>
                <Typography variant="subtitle2" fontWeight={700} sx={{ mb: 1 }}>
                  Micro-learning Rules (Viva activation)
                </Typography>
                <Stack spacing={1}>
                  <TextField size="small" label="Rule name" value={ruleForm.name} onChange={(e) => setRuleForm((v) => ({ ...v, name: e.target.value }))} />
                  <FormControl size="small">
                    <InputLabel>Tracking Type</InputLabel>
                    <Select value={ruleForm.trackingType} label="Tracking Type" onChange={(e) => setRuleForm((v) => ({ ...v, trackingType: e.target.value as 'anxiety' | 'mood' | 'sleep_hours' }))}>
                      <MenuItem value="anxiety">anxiety</MenuItem>
                      <MenuItem value="mood">mood</MenuItem>
                      <MenuItem value="sleep_hours">sleep_hours</MenuItem>
                    </Select>
                  </FormControl>
                  <TextField size="small" label="Delta threshold" value={ruleForm.deltaThreshold} onChange={(e) => setRuleForm((v) => ({ ...v, deltaThreshold: e.target.value }))} />
                  <TextField size="small" label="Window days" value={ruleForm.windowDays} onChange={(e) => setRuleForm((v) => ({ ...v, windowDays: e.target.value }))} />
                  <FormControl size="small">
                    <InputLabel>Card</InputLabel>
                    <Select value={ruleForm.cardId} label="Card" onChange={(e) => setRuleForm((v) => ({ ...v, cardId: String(e.target.value) }))}>
                      {selectedCardOptions.map((card) => (
                        <MenuItem key={card.id} value={card.id}>{card.label}</MenuItem>
                      ))}
                    </Select>
                  </FormControl>
                  <TextField size="small" label="Cooldown days" value={ruleForm.cooldownDays} onChange={(e) => setRuleForm((v) => ({ ...v, cooldownDays: e.target.value }))} />
                  <Button size="small" variant="contained" disabled={createRuleMutation.isPending || !ruleForm.name.trim() || !ruleForm.cardId} onClick={() => createRuleMutation.mutate()}>
                    Add Rule
                  </Button>
                </Stack>
                <Table size="small" sx={{ mt: 1 }}>
                  <TableHead>
                    <TableRow>
                      <TableCell>Rule</TableCell>
                      <TableCell>Trigger</TableCell>
                      <TableCell>Card</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {(rulesQuery.data ?? []).map((rule) => (
                      <TableRow key={rule.id}>
                        <TableCell>{rule.name}</TableCell>
                        <TableCell>{rule.trackingType} Δ {rule.deltaThreshold}</TableCell>
                        <TableCell>{selectedCardOptions.find((c) => c.id === rule.cardId)?.label ?? rule.cardId}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </Paper>
            </Grid>

            <Grid size={{ xs: 12, md: 6 }}>
              <Paper variant="outlined" sx={{ p: 1.5 }}>
                <Typography variant="subtitle2" fontWeight={700} sx={{ mb: 1 }}>
                  Choice Architecture Defaults
                </Typography>
                <Stack spacing={1}>
                  <TextField
                    size="small"
                    label="Default review due days"
                    value={effectiveChoiceDraft.nextReviewDueDaysDefault}
                    onChange={(e) => setChoiceDefaultsDraft((v) => ({ ...v, nextReviewDueDaysDefault: e.target.value }))}
                  />
                  <TextField
                    size="small"
                    label="Safety plan refresh days"
                    value={effectiveChoiceDraft.safetyPlanRefreshDaysDefault}
                    onChange={(e) => setChoiceDefaultsDraft((v) => ({ ...v, safetyPlanRefreshDaysDefault: e.target.value }))}
                  />
                  <TextField
                    size="small"
                    label="Medication reminder window minutes"
                    value={effectiveChoiceDraft.medicationReminderWindowMinutes}
                    onChange={(e) => setChoiceDefaultsDraft((v) => ({ ...v, medicationReminderWindowMinutes: e.target.value }))}
                  />
                  <Button size="small" variant="contained" onClick={() => saveChoiceDefaultsMutation.mutate()} disabled={saveChoiceDefaultsMutation.isPending}>
                    Save Defaults
                  </Button>
                </Stack>
                <Typography variant="subtitle2" fontWeight={700} sx={{ mt: 2, mb: 1 }}>
                  Patient Micro-learning Assignments
                </Typography>
                <Table size="small">
                  <TableHead>
                    <TableRow>
                      <TableCell>Status</TableCell>
                      <TableCell>Card</TableCell>
                      <TableCell>Assigned</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {(assignmentsQuery.data ?? []).map((item) => (
                      <TableRow key={item.id}>
                        <TableCell><Chip size="small" label={item.status} /></TableCell>
                        <TableCell>{selectedCardOptions.find((card) => card.id === item.cardId)?.label ?? item.cardId}</TableCell>
                        <TableCell>{new Date(item.assignedAt).toLocaleDateString('en-AU')}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </Paper>
            </Grid>
          </Grid>
        )}
      </Stack>
    </Paper>
  );
}
