// apps/web/src/features/clinical-review/components/ReviewPlanSection.tsx
import {
  Box,
  Button,
  TextField,
  Grid,
  FormControlLabel,
  Switch,
  Select,
  MenuItem,
  FormControl,
  InputLabel,
  Typography,
  Alert,
  CircularProgress,
  Divider,
  Paper,
} from '@mui/material';
import { useForm, Controller, useFieldArray, type Resolver } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import AddIcon from '@mui/icons-material/Add';
import DeleteIcon from '@mui/icons-material/Delete';
import { ReviewPlanSchema, type ReviewPlan } from '../types/reviewTypes';
import { useSaveReviewPlan } from '../hooks/useClinicalReview';

interface Props {
  encounterId: string;
  patientId: string;
  episodeId: string | null;
  initialPlan?: string;
  readOnly?: boolean;
}

const PRIORITY_OPTIONS = ['low', 'medium', 'high', 'urgent'] as const;
const FOLLOWUP_OPTIONS = ['review', 'phone', 'group', 'homevisit', 'discharge'] as const;
const LETTER_TYPE_OPTIONS = ['gpupdate', 'discharge', 'referral', 'topatient', 'tocarer'] as const;

export function ReviewPlanSection({
  encounterId,
  patientId,
  episodeId,
  initialPlan,
  readOnly = false,
}: Props) {
  const save = useSaveReviewPlan();
  const {
    control,
    handleSubmit,
    watch,
    formState: { errors, isDirty },
  } = useForm<ReviewPlan>({
    resolver: zodResolver(ReviewPlanSchema) as Resolver<ReviewPlan>,
    defaultValues: {
      encounterId,
      patientId,
      episodeId,
      planText: initialPlan ?? '',
      followUpDate: '',
      followUpType: 'review',
      tasksToCreate: [],
      generateLetter: false,
      letterType: undefined,
      letterRecipient: '',
    },
  });

  const { fields: tasks, append: addTask, remove: removeTask } = useFieldArray({
    control,
    name: 'tasksToCreate',
  });

  const generateLetter = watch('generateLetter');
  const onSubmit = (values: ReviewPlan) => save.mutate(values);

  return (
    <Box component="form" onSubmit={handleSubmit(onSubmit)}>
      {save.isError && (
        <Alert role="alert" severity="error" sx={{ mb: 2 }}>
          Failed to save review plan. Please try again.
        </Alert>
      )}
      {save.isSuccess && save.data && (
        <Alert severity="success" sx={{ mb: 2 }}>
          Plan saved.{' '}
          {save.data.tasksCreated > 0 && `${save.data.tasksCreated} tasks created. `}
          {save.data.letterJobId && 'Letter generation queued.'}
        </Alert>
      )}

      {/* Plan Text */}
      <Controller
        name="planText"
        control={control}
        render={({ field }) => (
          <TextField
            {...field}
            label="Review Plan"
            multiline
            rows={5}
            fullWidth
            disabled={readOnly}
            error={Boolean(errors.planText)}
            helperText={errors.planText?.message}
            placeholder="Document the clinical plan, including medication changes, referrals, safety planning, follow-up"
            sx={{ mb: 2 }}
          />
        )}
      />

      {/* Follow-up */}
      <Grid container spacing={2} mb={2}>
        <Grid>
          <Controller
            name="followUpDate"
            control={control}
            render={({ field }) => (
              <TextField
                {...field}
                label="Follow-up Date"
                type="date"
                fullWidth
                disabled={readOnly}
                InputLabelProps={{ shrink: true }}
              />
            )}
          />
        </Grid>
        <Grid>
          <Controller
            name="followUpType"
            control={control}
            render={({ field }) => (
              <FormControl fullWidth>
                <InputLabel>Follow-up Type</InputLabel>
                <Select {...field} label="Follow-up Type" disabled={readOnly}>
                  {FOLLOWUP_OPTIONS.map((o) => (
                    <MenuItem key={o} value={o} sx={{ textTransform: 'capitalize' }}>
                      {o.replace(/([A-Z])/g, ' $1')}
                    </MenuItem>
                  ))}
                </Select>
              </FormControl>
            )}
          />
        </Grid>
      </Grid>

      <Divider sx={{ my: 2 }} />

      {/* Tasks to Create */}
      <Typography variant="subtitle2" gutterBottom>
        Tasks to Create ({tasks.length})
      </Typography>

      {tasks.map((task, idx) => (
        <Paper key={task.id} variant="outlined" sx={{ p: 1.5, mb: 1 }}>
          <Grid container spacing={1} alignItems="center">
            <Grid>
              <Controller
                name={`tasksToCreate.${idx}.title`}
                control={control}
                render={({ field }) => (
                  <TextField {...field} label="Task" size="small" fullWidth disabled={readOnly} />
                )}
              />
            </Grid>
            <Grid>
              <Controller
                name={`tasksToCreate.${idx}.dueDate`}
                control={control}
                render={({ field }) => (
                  <TextField
                    {...field}
                    label="Due Date"
                    type="date"
                    size="small"
                    fullWidth
                    disabled={readOnly}
                    InputLabelProps={{ shrink: true }}
                  />
                )}
              />
            </Grid>
            <Grid>
              <Controller
                name={`tasksToCreate.${idx}.priority`}
                control={control}
                render={({ field }) => (
                  <FormControl fullWidth size="small">
                    <InputLabel>Priority</InputLabel>
                    <Select {...field} label="Priority" disabled={readOnly}>
                      {PRIORITY_OPTIONS.map((p) => (
                        <MenuItem key={p} value={p} sx={{ textTransform: 'capitalize' }}>
                          {p}
                        </MenuItem>
                      ))}
                    </Select>
                  </FormControl>
                )}
              />
            </Grid>
            {!readOnly && (
              <Grid>
                <Button size="small" color="error" onClick={() => removeTask(idx)} sx={{ minWidth: 0 }}>
                  <DeleteIcon fontSize="small" />
                </Button>
              </Grid>
            )}
          </Grid>
        </Paper>
      ))}

      {!readOnly && (
        <Button
          startIcon={<AddIcon />}
          size="small"
          onClick={() => addTask({ title: '', priority: 'low', dueDate: '', assignToStaffId: undefined })}
          sx={{ mb: 2 }}
        >
          Add Task
        </Button>
      )}

      <Divider sx={{ my: 2 }} />

      {/* Letter Generation */}
      <Box mb={2}>
        <Controller
          name="generateLetter"
          control={control}
          render={({ field }) => (
            <FormControlLabel
              control={<Switch {...field} checked={field.value} disabled={readOnly} />}
              label="Auto-generate correspondence letter on save"
            />
          )}
        />
        {generateLetter && (
          <Grid container spacing={2} mt={0.5}>
            <Grid>
              <Controller
                name="letterType"
                control={control}
                render={({ field }) => (
                  <FormControl fullWidth size="small">
                    <InputLabel>Letter Type</InputLabel>
                    <Select
                      {...field}
                      label="Letter Type"
                      disabled={readOnly}
                      value={field.value ?? ''}
                    >
                      {LETTER_TYPE_OPTIONS.map((t) => (
                        <MenuItem key={t} value={t} sx={{ textTransform: 'capitalize' }}>
                          {t.replace(/([A-Z])/g, ' $1')}
                        </MenuItem>
                      ))}
                    </Select>
                  </FormControl>
                )}
              />
            </Grid>
            <Grid>
              <Controller
                name="letterRecipient"
                control={control}
                render={({ field }) => (
                  <TextField
                    {...field}
                    label="Recipient name / organisation"
                    size="small"
                    fullWidth
                    disabled={readOnly}
                  />
                )}
              />
            </Grid>
          </Grid>
        )}
      </Box>

      {!readOnly && (
        <Box display="flex" justifyContent="flex-end">
          <Button
            type="submit"
            variant="contained"
            color="primary"
            disabled={!isDirty || save.isPending}
            startIcon={save.isPending ? <CircularProgress role="progressbar" aria-label="Loading" size={16} /> : undefined}
          >
            Save Plan
          </Button>
        </Box>
      )}
    </Box>
  );
}
