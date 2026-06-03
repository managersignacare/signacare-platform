// apps/web/src/features/pathology/components/PathologyOrderForm.tsx
import {
  Box,
  Button,
  TextField,
  Grid,
  Typography,
  Divider,
  FormControlLabel,
  Checkbox,
  MenuItem,
  Alert,
  CircularProgress,
  IconButton,
} from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import DeleteIcon from '@mui/icons-material/Delete';
import { useForm, Controller, useFieldArray, type Resolver } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import {
  CreateLabOrderSchema,
  type CreateLabOrderDTO,
} from '../types/pathologyTypes';
import { useCreateLabOrder } from '../hooks/usePathology';

interface Props {
  patientId: string;
  episodeId?: string;
  onSuccess: () => void;
  onCancel: () => void;
}

export const PathologyOrderForm: React.FC<Props> = ({
  patientId,
  episodeId,
  onSuccess,
  onCancel,
}) => {
  const {
    control,
    handleSubmit,
    formState: { errors },
  } = useForm<CreateLabOrderDTO>({
    resolver: zodResolver(CreateLabOrderSchema) as Resolver<CreateLabOrderDTO>,
    defaultValues: {
      patientId,
      episodeId: episodeId ?? undefined,
      urgency: 'routine',
      fasting: false,
      tests: [{ testCode: '', testName: '' }],
    },
  });

  const { fields, append, remove } = useFieldArray({ control, name: 'tests' });
  const createMutation = useCreateLabOrder();

  const onSubmit = (data: CreateLabOrderDTO) => {
    createMutation.mutate(data, { onSuccess });
  };

  return (
    <Box component="form" onSubmit={handleSubmit(onSubmit)} sx={{ p: 2 }}>
      <Typography variant="h6" sx={{ mb: 2 }}>
        New Pathology Order
      </Typography>
      <Divider sx={{ mb: 3 }} />

      {createMutation.isError && (
        <Alert role="alert" severity="error" sx={{ mb: 2 }}>
          Failed to create pathology order.
        </Alert>
      )}

      <Grid container spacing={2}>
        <Grid>
          <Controller
            name="labProvider"
            control={control}
            render={({ field }) => (
              <TextField
                {...field}
                label="Lab Provider"
                fullWidth
                error={!!errors.labProvider}
                helperText={errors.labProvider?.message}
              />
            )}
          />
        </Grid>

        <Grid>
          <Controller
            name="urgency"
            control={control}
            render={({ field }) => (
              <TextField {...field} select label="Urgency" fullWidth>
                {(['routine', 'urgent', 'stat'] as const).map((u) => (
                  <MenuItem key={u} value={u}>
                    {u.charAt(0).toUpperCase() + u.slice(1)}
                  </MenuItem>
                ))}
              </TextField>
            )}
          />
        </Grid>

        <Grid>
          <Controller
            name="specimenType"
            control={control}
            render={({ field }) => (
              <TextField {...field} label="Specimen Type" fullWidth />
            )}
          />
        </Grid>

        <Grid>
          <Controller
            name="collectionDate"
            control={control}
            render={({ field }) => (
              <TextField
                {...field}
                label="Collection Date"
                type="date"
                fullWidth
                InputLabelProps={{ shrink: true }}
              />
            )}
          />
        </Grid>

        <Grid>
          <Controller
            name="fasting"
            control={control}
            render={({ field }) => (
              <FormControlLabel
                control={
                  <Checkbox
                    checked={field.value}
                    onChange={field.onChange}
                  />
                }
                label="Fasting required"
              />
            )}
          />
        </Grid>

        <Grid>
          <Controller
            name="clinicalNotes"
            control={control}
            render={({ field }) => (
              <TextField
                {...field}
                label="Clinical Notes"
                fullWidth
                multiline
                rows={2}
              />
            )}
          />
        </Grid>
      </Grid>

      <Box sx={{ mt: 3 }}>
        <Box
          sx={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            mb: 1,
          }}
        >
          <Typography variant="subtitle2">Tests Requested</Typography>
          <Button
            size="small"
            startIcon={<AddIcon />}
            onClick={() => append({ testCode: '', testName: '' })}
          >
            Add Test
          </Button>
        </Box>

        {fields.map((fieldItem, index) => (
          <Grid container spacing={1} key={fieldItem.id} sx={{ mb: 1 }}>
            <Grid>
              <Controller
                name={`tests.${index}.testCode`}
                control={control}
                render={({ field }) => (
                  <TextField
                    {...field}
                    label="Test Code"
                    fullWidth
                    size="small"
                    error={!!errors.tests?.[index]?.testCode}
                  />
                )}
              />
            </Grid>
            <Grid>
              <Controller
                name={`tests.${index}.testName`}
                control={control}
                render={({ field }) => (
                  <TextField
                    {...field}
                    label="Test Name"
                    fullWidth
                    size="small"
                    error={!!errors.tests?.[index]?.testName}
                  />
                )}
              />
            </Grid>
            <Grid size={1} sx={{ display: 'flex', alignItems: 'center' }}>
              {fields.length > 1 && (
                <IconButton size="small" onClick={() => remove(index)}>
                  <DeleteIcon fontSize="small" />
                </IconButton>
              )}
            </Grid>
          </Grid>
        ))}

        {errors.tests && (
          <Typography variant="caption" color="error">
            At least one test is required.
          </Typography>
        )}
      </Box>

      <Box
        sx={{ display: 'flex', gap: 1, justifyContent: 'flex-end', mt: 3 }}
      >
        <Button
          variant="outlined"
          onClick={onCancel}
          disabled={createMutation.isPending}
        >
          Cancel
        </Button>
        <Button
          variant="contained"
          type="submit"
          disabled={createMutation.isPending}
        >
          {createMutation.isPending ? (
            <CircularProgress role="progressbar" aria-label="Loading" size={20} />
          ) : (
            'Create Order'
          )}
        </Button>
      </Box>
    </Box>
  );
};
