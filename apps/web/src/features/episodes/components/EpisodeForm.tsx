import { useForm, Controller } from 'react-hook-form';
import { zodResolver }         from '@hookform/resolvers/zod';
import {
  Alert,
  Box,
  Button,
  Grid,
  MenuItem,
  Paper,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import {
  CreateEpisodeDTOSchema,
  type CreateEpisodeDTO,
  EpisodeTypeSchema,
  EPISODE_TYPE_LABELS,
} from '../types/episodeTypes';
import { useCreateEpisode } from '../hooks/useCreateEpisode';

interface Props {
  patientId:  string;
  onSuccess?: () => void;
  onCancel?:  () => void;
}

export const EpisodeForm = ({ patientId, onSuccess, onCancel }: Props) => {
  const { mutate, isPending, error } = useCreateEpisode(patientId);

  const {
    control,
    handleSubmit,
    formState: { errors },
  } = useForm<CreateEpisodeDTO>({
    resolver: zodResolver(CreateEpisodeDTOSchema),
    defaultValues: {
      patientId,
      title:      '',
      episodeType: undefined,
      startDate:  new Date().toISOString().slice(0, 10),
    },
  });

  const onSubmit = (dto: CreateEpisodeDTO) => {
    mutate(dto, {
      onSuccess: () => onSuccess?.(),
    });
  };

  const episodeTypes = EpisodeTypeSchema.options;

  return (
    <Paper
      variant="outlined"
      sx={{ p: 3, borderRadius: 3, backgroundColor: '#FBF8F5' }}
    >
      <Typography
        fontFamily="Albert Sans, sans-serif"
        fontWeight={700}
        fontSize={15}
        color="#3D484B"
        mb={2}
      >
        New Episode
      </Typography>

      {error && (
        <Alert role="alert" severity="error" sx={{ mb: 2 }}>
          {error instanceof Error ? error.message : 'Failed to create episode.'}
        </Alert>
      )}

      <Box component="form" onSubmit={handleSubmit(onSubmit)}>
        <Grid container spacing={2}>
          {/* Title */}
          <Grid>
            <Controller
              name="title"
              control={control}
              render={({ field }) => (
                <TextField
                  {...field}
                  label="Episode Title"
                  fullWidth
                  required
                  size="small"
                  error={Boolean(errors.title)}
                  helperText={errors.title?.message}
                  inputProps={{ style: { fontFamily: 'Albert Sans, sans-serif' } }}
                />
              )}
            />
          </Grid>

          {/* Episode Type */}
          <Grid>
            <Controller
              name="episodeType"
              control={control}
              render={({ field }) => (
                <TextField
                  {...field}
                  select
                  label="Episode Type"
                  fullWidth
                  size="small"
                  error={Boolean(errors.episodeType)}
                  helperText={errors.episodeType?.message}
                >
                  <MenuItem value="">— Select —</MenuItem>
                  {episodeTypes.map((t) => (
                    <MenuItem key={t} value={t}>
                      {EPISODE_TYPE_LABELS[t]}
                    </MenuItem>
                  ))}
                </TextField>
              )}
            />
          </Grid>

          {/* Start Date */}
          <Grid>
            <Controller
              name="startDate"
              control={control}
              render={({ field }) => (
                <TextField
                  {...field}
                  label="Start Date"
                  type="date"
                  fullWidth
                  required
                  size="small"
                  InputLabelProps={{ shrink: true }}
                  error={Boolean(errors.startDate)}
                  helperText={errors.startDate?.message}
                />
              )}
            />
          </Grid>

          {/* Primary Diagnosis */}
          <Grid>
            <Controller
              name="primaryDiagnosis"
              control={control}
              render={({ field }) => (
                <TextField
                  {...field}
                  label="Primary Diagnosis (optional)"
                  fullWidth
                  size="small"
                  placeholder="e.g. F32.1 Major Depressive Disorder"
                  error={Boolean(errors.primaryDiagnosis)}
                  helperText={errors.primaryDiagnosis?.message}
                />
              )}
            />
          </Grid>

          {/* Summary */}
          <Grid>
            <Controller
              name="summary"
              control={control}
              render={({ field }) => (
                <TextField
                  {...field}
                  label="Summary (optional)"
                  fullWidth
                  multiline
                  minRows={3}
                  size="small"
                />
              )}
            />
          </Grid>
        </Grid>

        <Stack direction="row" justifyContent="flex-end" spacing={1.5} mt={3}>
          {onCancel && (
            <Button
              variant="outlined"
              onClick={onCancel}
              disabled={isPending}
              sx={{
                fontFamily: 'Albert Sans, sans-serif',
                borderColor: '#327C8D',
                color: '#327C8D',
                textTransform: 'none',
                borderRadius: 2,
              }}
            >
              Cancel
            </Button>
          )}
          <Button
            type="submit"
            variant="contained"
            disabled={isPending}
            sx={{
              fontFamily: 'Albert Sans, sans-serif',
              bgcolor: '#327C8D',
              '&:hover': { bgcolor: '#265f6d' },
              textTransform: 'none',
              borderRadius: 2,
            }}
          >
            {isPending ? 'Saving…' : 'Create Episode'}
          </Button>
        </Stack>
      </Box>
    </Paper>
  );
};
