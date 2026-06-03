import { Alert, Box, Button, Grid, TextField } from '@mui/material';
import { useForm, Controller } from 'react-hook-form';
import { useCreateLaiSchedule } from '../hooks/useLaiSchedules';
import { INJECTION_SITES, INJECTION_TECHNIQUES } from '../types/laiTypes';
import type { LaiScheduleCreateDTO } from '@signacare/shared';

interface Props {
  patientId: string;
  prescriberStaffId?: string;
  onSuccess: () => void;
}

export default function LaiScheduleForm({ patientId, prescriberStaffId = '', onSuccess }: Props) {
  const createS = useCreateLaiSchedule(patientId);
  const { control, handleSubmit, formState: { errors } } = useForm<LaiScheduleCreateDTO>({
    defaultValues: {
      patientId,
      prescriberStaffId,
      frequencyDays: 28,
      injectionSite: 'gluteal',
      injectionTechnique: 'IM',
      loadingDoseRequired: false,
      loadingDosesRequired: 0,
      oralOverlapRequired: false,
      startDate: new Date().toISOString().slice(0, 10),
      firstDueDate: new Date().toISOString().slice(0, 10),
    },
  });

  const onSubmit = (data: LaiScheduleCreateDTO) => {
    createS.mutate(data, { onSuccess });
  };

  return (
    <Box component="form" onSubmit={handleSubmit(onSubmit)} sx={{ pt: 1 }}>
      {createS.isError && <Alert role="alert" severity="error" sx={{ mb: 2 }}>Failed to create schedule.</Alert>}
      <Grid container spacing={2}>
        <Grid>
          <Controller
            name="drugName"
            control={control}
            rules={{ required: 'Drug name required' }}
            render={({ field }) => (
              <TextField
                {...field}
                label="Drug Name *"
                fullWidth
                error={!!errors.drugName}
                helperText={errors.drugName?.message}
              />
            )}
          />
        </Grid>
        <Grid>
          <Controller
            name="doseMg"
            control={control}
            rules={{ required: 'Dose required' }}
            render={({ field }) => (
              <TextField
                {...field}
                label="Dose (mg) *"
                fullWidth
                error={!!errors.doseMg}
                helperText={errors.doseMg?.message}
              />
            )}
          />
        </Grid>
        <Grid>
          <Controller
            name="frequencyDays"
            control={control}
            rules={{ required: true, min: 1 }}
            render={({ field }) => (
              <TextField
                {...field}
                label="Frequency (days) *"
                type="number"
                fullWidth
                onChange={(e) => field.onChange(Number(e.target.value))}
              />
            )}
          />
        </Grid>
        <Grid>
          <Controller
            name="injectionSite"
            control={control}
            render={({ field }) => (
              <TextField {...field} label="Injection Site" fullWidth select SelectProps={{ native: true }}>
                {INJECTION_SITES.map((s) => <option key={s} value={s}>{s}</option>)}
              </TextField>
            )}
          />
        </Grid>
        <Grid>
          <Controller
            name="injectionTechnique"
            control={control}
            render={({ field }) => (
              <TextField {...field} label="Technique" fullWidth select SelectProps={{ native: true }}>
                {INJECTION_TECHNIQUES.map((t) => <option key={t} value={t}>{t}</option>)}
              </TextField>
            )}
          />
        </Grid>
        <Grid>
          <Controller
            name="startDate"
            control={control}
            rules={{ required: true }}
            render={({ field }) => (
              <TextField {...field} label="Start Date *" type="date" fullWidth InputLabelProps={{ shrink: true }} />
            )}
          />
        </Grid>
        <Grid>
          <Controller
            name="firstDueDate"
            control={control}
            rules={{ required: true }}
            render={({ field }) => (
              <TextField {...field} label="First Due Date *" type="date" fullWidth InputLabelProps={{ shrink: true }} />
            )}
          />
        </Grid>
        <Grid>
          <Controller
            name="indication"
            control={control}
            render={({ field }) => (
              <TextField {...field} label="Indication" fullWidth multiline rows={2} />
            )}
          />
        </Grid>
        <Grid size={12} sx={{ display: 'flex', justifyContent: 'flex-end', gap: 1 }}>
          <Button onClick={onSuccess}>Cancel</Button>
          <Button type="submit" variant="contained" disabled={createS.isPending} sx={{ bgcolor: '#327C8D' }}>
            {createS.isPending ? 'Saving…' : 'Create Schedule'}
          </Button>
        </Grid>
      </Grid>
    </Box>
  );
}
