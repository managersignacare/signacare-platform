import { useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Checkbox,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  FormControl,
  Grid,
  InputLabel,
  LinearProgress,
  MenuItem,
  Paper,
  Select,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  PathwayDigitalInterventionBundle,
  PathwayInterventionTemplateKey,
} from '@signacare/shared';
import { apiClient } from '../../../shared/services/apiClient';
import { pathwayKeys } from '../queryKeys';

type TemplateOption = {
  key: PathwayInterventionTemplateKey;
  label: string;
  accent: string;
};

const TEMPLATE_OPTIONS: TemplateOption[] = [
  { key: 'cbt_homework', label: 'CBT Homework Pack', accent: '#327C8D' },
  { key: 'dbt_skills', label: 'DBT Skills Pack', accent: '#6A4C93' },
  { key: 'thought_diary_journey', label: 'Thought Diary Journey', accent: '#00796B' },
  { key: 'sleep_hygiene_journey', label: 'Sleep Hygiene Journey', accent: '#2E7D32' },
];

interface PathwayDigitalCareDialogProps {
  open: boolean;
  pathwayId: string;
  pathwayName: string;
  onClose: () => void;
}

type ThoughtDiaryForm = {
  situation: string;
  automaticThought: string;
  emotion: string;
  emotionIntensity: number;
  balancedThought: string;
};

type SleepForm = {
  date: string;
  bedtime: string;
  wakeTime: string;
  sleepHours: number;
  sleepQuality: number;
  caffeineAfterNoon: boolean;
  screenAfterBed: boolean;
  exerciseDone: boolean;
  notes: string;
};

function getErrorMessage(error: unknown, fallback: string): string {
  if (error && typeof error === 'object') {
    const maybeError = error as { message?: string };
    return maybeError.message ?? fallback;
  }
  return fallback;
}

function formatDateTime(value: string | null | undefined): string {
  if (!value) return '—';
  return new Date(value).toLocaleString('en-AU');
}

function formatDate(value: string | null | undefined): string {
  if (!value) return '—';
  return new Date(value).toLocaleDateString('en-AU');
}

export function PathwayDigitalCareDialog({
  open,
  pathwayId,
  pathwayName,
  onClose,
}: PathwayDigitalCareDialogProps) {
  const qc = useQueryClient();
  const [errorBanner, setErrorBanner] = useState('');
  const [assignTemplate, setAssignTemplate] = useState<PathwayInterventionTemplateKey>('cbt_homework');
  const [assignDueDate, setAssignDueDate] = useState('');
  const [assignNotes, setAssignNotes] = useState('');
  const [thoughtForm, setThoughtForm] = useState<ThoughtDiaryForm>({
    situation: '',
    automaticThought: '',
    emotion: '',
    emotionIntensity: 50,
    balancedThought: '',
  });
  const [sleepForm, setSleepForm] = useState<SleepForm>({
    date: new Date().toISOString().split('T')[0],
    bedtime: '',
    wakeTime: '',
    sleepHours: 7,
    sleepQuality: 3,
    caffeineAfterNoon: false,
    screenAfterBed: false,
    exerciseDone: false,
    notes: '',
  });

  const detailQuery = useQuery({
    queryKey: pathwayKeys.digitalDetail(pathwayId),
    queryFn: () => apiClient.get<PathwayDigitalInterventionBundle>(`pathways/${pathwayId}/digital-interventions`),
    enabled: open && !!pathwayId,
  });

  const assignMutation = useMutation({
    mutationFn: (lockVersion: number) =>
      apiClient.post<PathwayDigitalInterventionBundle>(`pathways/${pathwayId}/digital-interventions/assign`, {
        expectedLockVersion: lockVersion,
        templateKey: assignTemplate,
        dueDate: assignDueDate || undefined,
        notes: assignNotes || undefined,
      }),
    onSuccess: () => {
      setAssignNotes('');
      setAssignDueDate('');
      setErrorBanner('');
      qc.invalidateQueries({ queryKey: pathwayKeys.digitalDetail(pathwayId) });
      qc.invalidateQueries({ queryKey: pathwayKeys.all });
    },
    onError: (error: unknown) => setErrorBanner(getErrorMessage(error, 'Failed to assign intervention pack')),
  });

  const updateItemMutation = useMutation({
    mutationFn: ({
      lockVersion,
      packId,
      itemId,
      completed,
    }: { lockVersion: number; packId: string; itemId: string; completed: boolean }) =>
      apiClient.post<PathwayDigitalInterventionBundle>(
        `pathways/${pathwayId}/digital-interventions/${packId}/items/${itemId}`,
        {
          expectedLockVersion: lockVersion,
          completed,
        },
      ),
    onSuccess: () => {
      setErrorBanner('');
      qc.invalidateQueries({ queryKey: pathwayKeys.digitalDetail(pathwayId) });
      qc.invalidateQueries({ queryKey: pathwayKeys.all });
    },
    onError: (error: unknown) => setErrorBanner(getErrorMessage(error, 'Failed to update intervention item')),
  });

  const thoughtMutation = useMutation({
    mutationFn: (lockVersion: number) =>
      apiClient.post<PathwayDigitalInterventionBundle>(`pathways/${pathwayId}/thought-diary`, {
        expectedLockVersion: lockVersion,
        situation: thoughtForm.situation,
        automaticThought: thoughtForm.automaticThought,
        emotion: thoughtForm.emotion,
        emotionIntensity: thoughtForm.emotionIntensity,
        balancedThought: thoughtForm.balancedThought || undefined,
      }),
    onSuccess: () => {
      setThoughtForm({
        situation: '',
        automaticThought: '',
        emotion: '',
        emotionIntensity: 50,
        balancedThought: '',
      });
      setErrorBanner('');
      qc.invalidateQueries({ queryKey: pathwayKeys.digitalDetail(pathwayId) });
      qc.invalidateQueries({ queryKey: pathwayKeys.all });
    },
    onError: (error: unknown) => setErrorBanner(getErrorMessage(error, 'Failed to save thought diary entry')),
  });

  const sleepMutation = useMutation({
    mutationFn: (lockVersion: number) =>
      apiClient.post<PathwayDigitalInterventionBundle>(`pathways/${pathwayId}/sleep-hygiene/check-in`, {
        expectedLockVersion: lockVersion,
        date: sleepForm.date,
        bedtime: sleepForm.bedtime || undefined,
        wakeTime: sleepForm.wakeTime || undefined,
        sleepHours: sleepForm.sleepHours,
        sleepQuality: sleepForm.sleepQuality,
        caffeineAfterNoon: sleepForm.caffeineAfterNoon,
        screenAfterBed: sleepForm.screenAfterBed,
        exerciseDone: sleepForm.exerciseDone,
        notes: sleepForm.notes || undefined,
      }),
    onSuccess: () => {
      setSleepForm((prev) => ({
        ...prev,
        bedtime: '',
        wakeTime: '',
        sleepHours: 7,
        sleepQuality: 3,
        caffeineAfterNoon: false,
        screenAfterBed: false,
        exerciseDone: false,
        notes: '',
      }));
      setErrorBanner('');
      qc.invalidateQueries({ queryKey: pathwayKeys.digitalDetail(pathwayId) });
      qc.invalidateQueries({ queryKey: pathwayKeys.all });
    },
    onError: (error: unknown) => setErrorBanner(getErrorMessage(error, 'Failed to save sleep hygiene check-in')),
  });

  const data = detailQuery.data;
  const lockVersion = data?.lockVersion;

  return (
    <Dialog open={open} onClose={onClose} maxWidth="lg" fullWidth>
      <DialogTitle sx={{ fontWeight: 700 }}>
        Digital Care Pathway — {pathwayName}
      </DialogTitle>
      <Divider />
      <DialogContent sx={{ py: 2 }}>
        {errorBanner && (
          <Alert severity="warning" sx={{ mb: 2 }} onClose={() => setErrorBanner('')}>
            {errorBanner}
          </Alert>
        )}

        {detailQuery.isLoading && <LinearProgress sx={{ mb: 2 }} />}

        <Grid container spacing={2}>
          <Grid size={{ xs: 12, md: 6 }}>
            <Paper variant="outlined" sx={{ p: 2, height: '100%' }}>
              <Typography variant="subtitle2" fontWeight={700} sx={{ mb: 1 }}>
                Structured Homework Packs
              </Typography>
              <Stack spacing={1} sx={{ mb: 2 }}>
                {(data?.packs ?? []).map((pack) => {
                  const option = TEMPLATE_OPTIONS.find((item) => item.key === pack.templateKey);
                  return (
                    <Paper key={pack.id} variant="outlined" sx={{ p: 1.5, borderLeft: `4px solid ${option?.accent ?? '#999'}` }}>
                      <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 0.5, gap: 1 }}>
                        <Box>
                          <Typography variant="body2" fontWeight={700}>{pack.title}</Typography>
                          <Typography variant="caption" color="text.secondary">
                            Assigned {formatDateTime(pack.assignedAt)} · Due {formatDate(pack.dueDate)}
                          </Typography>
                        </Box>
                        <Chip size="small" label={pack.status} color={pack.status === 'completed' ? 'success' : 'primary'} />
                      </Box>
                      <Stack spacing={0.5}>
                        {pack.items.map((item) => (
                          <Box key={item.id} sx={{ display: 'flex', alignItems: 'flex-start', gap: 0.5 }}>
                            <Checkbox
                              size="small"
                              checked={item.completed}
                              onChange={(event) => {
                                if (typeof lockVersion === 'number') {
                                  updateItemMutation.mutate({
                                    lockVersion,
                                    packId: pack.id,
                                    itemId: item.id,
                                    completed: event.target.checked,
                                  });
                                }
                              }}
                              disabled={typeof lockVersion !== 'number' || updateItemMutation.isPending}
                            />
                            <Box sx={{ mt: 0.6 }}>
                              <Typography variant="caption" fontWeight={600}>{item.title}</Typography>
                              <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
                                {item.description}
                              </Typography>
                            </Box>
                          </Box>
                        ))}
                      </Stack>
                    </Paper>
                  );
                })}
                {(data?.packs ?? []).length === 0 && (
                  <Alert severity="info">No packs assigned yet.</Alert>
                )}
              </Stack>

              <Grid container spacing={1}>
                <Grid size={{ xs: 12, sm: 7 }}>
                  <FormControl fullWidth size="small">
                    <InputLabel>Pack Template</InputLabel>
                    <Select
                      value={assignTemplate}
                      label="Pack Template"
                      onChange={(event) => setAssignTemplate(event.target.value as PathwayInterventionTemplateKey)}
                    >
                      {TEMPLATE_OPTIONS.map((option) => (
                        <MenuItem key={option.key} value={option.key}>{option.label}</MenuItem>
                      ))}
                    </Select>
                  </FormControl>
                </Grid>
                <Grid size={{ xs: 12, sm: 5 }}>
                  <TextField
                    size="small"
                    fullWidth
                    label="Due Date"
                    type="date"
                    value={assignDueDate}
                    onChange={(event) => setAssignDueDate(event.target.value)}
                    slotProps={{ inputLabel: { shrink: true } }}
                  />
                </Grid>
                <Grid size={{ xs: 12 }}>
                  <TextField
                    size="small"
                    fullWidth
                    label="Notes"
                    value={assignNotes}
                    onChange={(event) => setAssignNotes(event.target.value)}
                  />
                </Grid>
                <Grid size={{ xs: 12 }}>
                  <Button
                    variant="contained"
                    size="small"
                    onClick={() => {
                      if (typeof lockVersion === 'number') {
                        assignMutation.mutate(lockVersion);
                      }
                    }}
                    disabled={typeof lockVersion !== 'number' || assignMutation.isPending}
                  >
                    Assign Pack
                  </Button>
                </Grid>
              </Grid>
            </Paper>
          </Grid>

          <Grid size={{ xs: 12, md: 6 }}>
            <Stack spacing={2}>
              <Paper variant="outlined" sx={{ p: 2 }}>
                <Typography variant="subtitle2" fontWeight={700} sx={{ mb: 1 }}>
                  Thought Diary
                </Typography>
                <Grid container spacing={1}>
                  <Grid size={{ xs: 12 }}>
                    <TextField size="small" fullWidth label="Situation" value={thoughtForm.situation} onChange={(event) => setThoughtForm((prev) => ({ ...prev, situation: event.target.value }))} />
                  </Grid>
                  <Grid size={{ xs: 12 }}>
                    <TextField size="small" fullWidth label="Automatic Thought" value={thoughtForm.automaticThought} onChange={(event) => setThoughtForm((prev) => ({ ...prev, automaticThought: event.target.value }))} />
                  </Grid>
                  <Grid size={{ xs: 6 }}>
                    <TextField size="small" fullWidth label="Emotion" value={thoughtForm.emotion} onChange={(event) => setThoughtForm((prev) => ({ ...prev, emotion: event.target.value }))} />
                  </Grid>
                  <Grid size={{ xs: 6 }}>
                    <TextField size="small" fullWidth label="Intensity (0-100)" type="number" value={thoughtForm.emotionIntensity} onChange={(event) => setThoughtForm((prev) => ({ ...prev, emotionIntensity: Number(event.target.value) || 0 }))} />
                  </Grid>
                  <Grid size={{ xs: 12 }}>
                    <TextField size="small" fullWidth label="Balanced Thought" value={thoughtForm.balancedThought} onChange={(event) => setThoughtForm((prev) => ({ ...prev, balancedThought: event.target.value }))} />
                  </Grid>
                  <Grid size={{ xs: 12 }}>
                    <Button
                      variant="outlined"
                      size="small"
                      onClick={() => {
                        if (typeof lockVersion === 'number') {
                          thoughtMutation.mutate(lockVersion);
                        }
                      }}
                      disabled={
                        typeof lockVersion !== 'number'
                        || thoughtMutation.isPending
                        || !thoughtForm.situation.trim()
                        || !thoughtForm.automaticThought.trim()
                        || !thoughtForm.emotion.trim()
                      }
                    >
                      Add Entry
                    </Button>
                  </Grid>
                </Grid>
                <Stack spacing={0.75} sx={{ mt: 1.5 }}>
                  {(data?.thoughtDiaryEntries ?? []).slice(0, 5).map((entry) => (
                    <Paper key={entry.id} variant="outlined" sx={{ p: 1 }}>
                      <Typography variant="caption" fontWeight={700}>{entry.emotion} ({entry.emotionIntensity}/100)</Typography>
                      <Typography variant="caption" display="block" color="text.secondary">{entry.situation}</Typography>
                      <Typography variant="caption" display="block">Thought: {entry.automaticThought}</Typography>
                    </Paper>
                  ))}
                </Stack>
              </Paper>

              <Paper variant="outlined" sx={{ p: 2 }}>
                <Typography variant="subtitle2" fontWeight={700} sx={{ mb: 1 }}>
                  Sleep Hygiene Journey
                </Typography>
                <Grid container spacing={1}>
                  <Grid size={{ xs: 12, sm: 6 }}>
                    <TextField size="small" fullWidth label="Date" type="date" value={sleepForm.date} onChange={(event) => setSleepForm((prev) => ({ ...prev, date: event.target.value }))} slotProps={{ inputLabel: { shrink: true } }} />
                  </Grid>
                  <Grid size={{ xs: 6, sm: 3 }}>
                    <TextField size="small" fullWidth label="Bedtime" type="time" value={sleepForm.bedtime} onChange={(event) => setSleepForm((prev) => ({ ...prev, bedtime: event.target.value }))} slotProps={{ inputLabel: { shrink: true } }} />
                  </Grid>
                  <Grid size={{ xs: 6, sm: 3 }}>
                    <TextField size="small" fullWidth label="Wake Time" type="time" value={sleepForm.wakeTime} onChange={(event) => setSleepForm((prev) => ({ ...prev, wakeTime: event.target.value }))} slotProps={{ inputLabel: { shrink: true } }} />
                  </Grid>
                  <Grid size={{ xs: 6 }}>
                    <TextField size="small" fullWidth label="Hours Slept" type="number" value={sleepForm.sleepHours} onChange={(event) => setSleepForm((prev) => ({ ...prev, sleepHours: Number(event.target.value) || 0 }))} />
                  </Grid>
                  <Grid size={{ xs: 6 }}>
                    <TextField size="small" fullWidth label="Quality (1-5)" type="number" value={sleepForm.sleepQuality} onChange={(event) => setSleepForm((prev) => ({ ...prev, sleepQuality: Number(event.target.value) || 1 }))} />
                  </Grid>
                  <Grid size={{ xs: 12 }}>
                    <TextField size="small" fullWidth label="Notes" value={sleepForm.notes} onChange={(event) => setSleepForm((prev) => ({ ...prev, notes: event.target.value }))} />
                  </Grid>
                  <Grid size={{ xs: 12 }}>
                    <Stack direction="row" spacing={1}>
                      <Chip
                        size="small"
                        label={`Caffeine after noon: ${sleepForm.caffeineAfterNoon ? 'Yes' : 'No'}`}
                        color={sleepForm.caffeineAfterNoon ? 'warning' : 'success'}
                        onClick={() => setSleepForm((prev) => ({ ...prev, caffeineAfterNoon: !prev.caffeineAfterNoon }))}
                      />
                      <Chip
                        size="small"
                        label={`Screen after bed: ${sleepForm.screenAfterBed ? 'Yes' : 'No'}`}
                        color={sleepForm.screenAfterBed ? 'warning' : 'success'}
                        onClick={() => setSleepForm((prev) => ({ ...prev, screenAfterBed: !prev.screenAfterBed }))}
                      />
                      <Chip
                        size="small"
                        label={`Exercise done: ${sleepForm.exerciseDone ? 'Yes' : 'No'}`}
                        color={sleepForm.exerciseDone ? 'success' : 'default'}
                        onClick={() => setSleepForm((prev) => ({ ...prev, exerciseDone: !prev.exerciseDone }))}
                      />
                    </Stack>
                  </Grid>
                  <Grid size={{ xs: 12 }}>
                    <Button
                      variant="outlined"
                      size="small"
                      onClick={() => {
                        if (typeof lockVersion === 'number') {
                          sleepMutation.mutate(lockVersion);
                        }
                      }}
                      disabled={typeof lockVersion !== 'number' || sleepMutation.isPending}
                    >
                      Add Sleep Check-in
                    </Button>
                  </Grid>
                </Grid>
                <Stack spacing={0.75} sx={{ mt: 1.5 }}>
                  {(data?.sleepJourneyCheckIns ?? []).slice(0, 5).map((entry) => (
                    <Paper key={entry.id} variant="outlined" sx={{ p: 1 }}>
                      <Typography variant="caption" fontWeight={700}>
                        {formatDate(entry.date)} · Quality {entry.sleepQuality}/5
                      </Typography>
                      <Typography variant="caption" display="block" color="text.secondary">
                        Hours: {entry.sleepHours ?? '—'} · Bed {entry.bedtime ?? '—'} · Wake {entry.wakeTime ?? '—'}
                      </Typography>
                    </Paper>
                  ))}
                </Stack>
              </Paper>
            </Stack>
          </Grid>
        </Grid>
      </DialogContent>
      <Divider />
      <DialogActions>
        <Button onClick={onClose}>Close</Button>
      </DialogActions>
    </Dialog>
  );
}

export default PathwayDigitalCareDialog;
