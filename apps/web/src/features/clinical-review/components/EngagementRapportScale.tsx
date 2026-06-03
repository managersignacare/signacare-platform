// apps/web/src/features/clinical-review/components/EngagementRapportScale.tsx
import {
  Box,
  Typography,
  Slider,
  Grid,
  Button,
  CircularProgress,
  Alert,
  TextField,
  Paper,
} from '@mui/material';
import { useForm, Controller } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { EngagementRapportScoreSchema, type EngagementRapportScore } from '../types/reviewTypes';
import { useSaveEngagementScore } from '../hooks/useClinicalReview';

interface Props {
  encounterId: string;
  patientId: string;
  initialValues?: Partial<EngagementRapportScore>;
  readOnly?: boolean;
}

const SCALE_LABELS: Record<string, string> = {
  rapport: '1 = No rapport, 4 = Moderate, 7 = Excellent rapport',
  engagement: '1 = Refused, 4 = Partial, 7 = Fully engaged',
  compliance: '1 = Non-compliant, 4 = Variable, 7 = Fully compliant',
  insight: '1 = No insight, 4 = Partial, 7 = Full insight',
  affect: '1 = Flat/blunted, 4 = Restricted, 7 = Full range',
};

const SCALE_FIELDS: Array<{ name: keyof EngagementRapportScore; label: string }> = [
  { name: 'rapport', label: 'Therapeutic Rapport' },
  { name: 'engagement', label: 'Session Engagement' },
  { name: 'compliance', label: 'Treatment Compliance' },
  { name: 'insight', label: 'Insight into Illness' },
  { name: 'affect', label: 'Affect Range' },
];

const DEFAULTS: Omit<EngagementRapportScore, 'id' | 'recordedAt'> = {
  encounterId: '',
  patientId: '',
  rapport: 4,
  engagement: 4,
  compliance: 4,
  insight: 4,
  affect: 4,
  notes: '',
};

export function EngagementRapportScale({
  encounterId,
  patientId,
  initialValues,
  readOnly = false,
}: Props) {
  const save = useSaveEngagementScore();
  const {
    control,
    handleSubmit,
    formState: { isDirty },
  } = useForm<EngagementRapportScore>({
    resolver: zodResolver(EngagementRapportScoreSchema),
    defaultValues: {
      ...DEFAULTS,
      ...initialValues,
      encounterId,
      patientId,
    },
  });

  const onSubmit = (values: EngagementRapportScore) => save.mutate(values);

  return (
    <Box component="form" onSubmit={handleSubmit(onSubmit)}>
      {save.isError && (
        <Alert role="alert" severity="error" sx={{ mb: 2 }}>
          Failed to save engagement scores. Please try again.
        </Alert>
      )}
      {save.isSuccess && (
        <Alert severity="success" sx={{ mb: 2 }}>
          Engagement scores saved.
        </Alert>
      )}
      <Grid container spacing={3}>
        {SCALE_FIELDS.map(({ name, label }) => (
          <Grid size={{ xs: 12, md: 6 }} key={name as string}>
            <Paper variant="outlined" sx={{ p: 2 }}>
              <Typography variant="subtitle2" gutterBottom>
                {label}
              </Typography>
              <Controller
                name={name}
                control={control}
                render={({ field }) => (
                  <Slider
                    {...field}
                    value={Number(field.value) || 1}
                    disabled={readOnly}
                    min={1}
                    max={7}
                    step={1}
                    marks={Array.from({ length: 7 }, (_, i) => ({
                      value: i + 1,
                      label: String(i + 1),
                    }))}
                    valueLabelDisplay="auto"
                    onChange={(_e, val) => field.onChange(val)}
                  />
                )}
              />
              <Box display="flex" justifyContent="space-between">
                {(SCALE_LABELS[name as string] ?? '').split(', ').map((l, i) => (
                  <Typography key={i} variant="caption" color="text.secondary">
                    {l}
                  </Typography>
                ))}
              </Box>
            </Paper>
          </Grid>
        ))}
        <Grid>
          <Controller
            name="notes"
            control={control}
            render={({ field }) => (
              <TextField
                {...field}
                label="Clinician notes on engagement"
                multiline
                rows={2}
                fullWidth
                disabled={readOnly}
                placeholder="Optional context about engagement quality this session"
              />
            )}
          />
        </Grid>
      </Grid>
      {!readOnly && (
        <Box display="flex" justifyContent="flex-end" mt={2}>
          <Button
            type="submit"
            variant="contained"
            disabled={!isDirty || save.isPending}
            startIcon={save.isPending ? <CircularProgress role="progressbar" aria-label="Loading" size={16} /> : undefined}
          >
            Save Scores
          </Button>
        </Box>
      )}
    </Box>
  );
}
