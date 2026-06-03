// NOTE: TaskForm.tsx was listed in the spec index but its code block was not present
// in the retrieved source document. This is a reconstructed scaffold matching the
// project's patterns (React Hook Form + Zod + MUI). Replace with spec version if found.
import {
  Box,
  Button,
  TextField,
  Grid,
  Typography,
  Divider,
  MenuItem,
  Alert,
  CircularProgress,
} from '@mui/material';
import { useForm, Controller, type Resolver } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { CreateTaskSchema, type CreateTaskDTO, type TaskResponseView as TaskResponse } from '../types/taskTypes';
import { useCreateTask, useUpdateTask } from '../hooks/useTasks';

interface Props {
  patientId?: string;
  episodeId?: string;
  task?: TaskResponse;
  onSuccess: () => void;
  onCancel: () => void;
}

export const TaskForm: React.FC<Props> = ({
  patientId,
  episodeId,
  task,
  onSuccess,
  onCancel,
}) => {
  const {
    control,
    handleSubmit,
    formState: { errors },
  } = useForm<CreateTaskDTO>({
    resolver: zodResolver(CreateTaskSchema) as Resolver<CreateTaskDTO>,
    defaultValues: {
      patientId: patientId ?? task?.patientId ?? undefined,
      episodeId: episodeId ?? task?.episodeId ?? undefined,
      title: task?.title ?? '',
      description: task?.description ?? '',
      priority: task?.priority ?? 'medium',
      dueDate: task?.dueDate ?? undefined,
      assignedToId: task?.assignedToId ?? undefined,
    },
  });

  const createMutation = useCreateTask();
  const updateMutation = useUpdateTask();
  const isPending = createMutation.isPending || updateMutation.isPending;
  const isError = createMutation.isError || updateMutation.isError;

  const onSubmit = (data: CreateTaskDTO) => {
    if (task) {
      updateMutation.mutate({ id: task.id, dto: data }, { onSuccess });
    } else {
      createMutation.mutate(data, { onSuccess });
    }
  };

  return (
    <Box component="form" onSubmit={handleSubmit(onSubmit)} sx={{ p: 2 }}>
      <Typography variant="h6" sx={{ mb: 2 }}>
        {task ? 'Edit Task' : 'New Task'}
      </Typography>
      <Divider sx={{ mb: 3 }} />

      {isError && (
        <Alert role="alert" severity="error" sx={{ mb: 2 }}>
          Failed to save task.
        </Alert>
      )}

      <Grid container spacing={2}>
        <Grid>
          <Controller
            name="title"
            control={control}
            render={({ field }) => (
              <TextField
                {...field}
                label="Title"
                fullWidth
                required
                error={!!errors.title}
                helperText={errors.title?.message}
              />
            )}
          />
        </Grid>

        <Grid>
          <Controller
            name="description"
            control={control}
            render={({ field }) => (
              <TextField
                {...field}
                label="Description"
                fullWidth
                multiline
                rows={3}
              />
            )}
          />
        </Grid>

        <Grid>
          <Controller
            name="priority"
            control={control}
            render={({ field }) => (
              <TextField {...field} select label="Priority" fullWidth>
                {(['low', 'medium', 'high', 'urgent'] as const).map((p) => (
                  <MenuItem key={p} value={p}>
                    {p.charAt(0).toUpperCase() + p.slice(1)}
                  </MenuItem>
                ))}
              </TextField>
            )}
          />
        </Grid>

        <Grid>
          <Controller
            name="dueDate"
            control={control}
            render={({ field }) => (
              <TextField
                {...field}
                label="Due Date"
                type="date"
                fullWidth
                InputLabelProps={{ shrink: true }}
                error={!!errors.dueDate}
                helperText={errors.dueDate?.message}
              />
            )}
          />
        </Grid>
      </Grid>

      <Box sx={{ display: 'flex', gap: 1, justifyContent: 'flex-end', mt: 3 }}>
        <Button variant="outlined" onClick={onCancel} disabled={isPending}>
          Cancel
        </Button>
        <Button variant="contained" type="submit" disabled={isPending}>
          {isPending ? <CircularProgress role="progressbar" aria-label="Loading" size={20} /> : task ? 'Save Changes' : 'Create Task'}
        </Button>
      </Box>
    </Box>
  );
};
