import { useState } from 'react';
import {
  Box,
  Button,
  Grid,
  TextField,
  Autocomplete,
  FormControlLabel,
  Checkbox,
  CircularProgress,
  Alert,
} from '@mui/material';
import { useForm, Controller } from 'react-hook-form';
import { useCreateMedication } from '../hooks/useMedications';
import { medicationApi } from '../services/medicationApi';
import { ROUTES, FREQUENCIES } from '../types/medicationTypes';
import type { MedicationCreateDTO } from '@signacare/shared';

interface Props {
  patientId: string;
  episodeId?: string;
  onSuccess: () => void;
}

export default function MedicationForm({ patientId, episodeId, onSuccess }: Props) {
  const createM = useCreateMedication(patientId);
  const [, setDrugQuery] = useState('');
  const [drugOptions, setDrugOptions] = useState<{ id: string; label: string; genericName: string; brandName: string | null }[]>([]);
  const [drugLoading, setDrugLoading] = useState(false);

  const { control, handleSubmit, formState: { errors } } = useForm<MedicationCreateDTO>({
    defaultValues: {
      patientId,
      episodeId,
      route: 'oral',
      isRegular: true,
      isPrn: false,
      isLai: false,
      source: 'manual',
    },
  });

  const searchDrugs = async (q: string) => {
    if (q.length < 2) return;
    setDrugLoading(true);
    try {
      const results = await medicationApi.searchDrugs(q);
      setDrugOptions(
        results.map((r) => ({
          id: r.id,
          label: `${r.genericName}${r.brandName ? ` (${r.brandName})` : ''}`,
          genericName: r.genericName,
          brandName: r.brandName,
        })),
      );
    } finally {
      setDrugLoading(false);
    }
  };

  const onSubmit = (data: MedicationCreateDTO) => {
    createM.mutate(data, { onSuccess });
  };

  return (
    <Box component="form" onSubmit={handleSubmit(onSubmit)} sx={{ pt: 1 }}>
      {createM.isError && (
        <Alert role="alert" severity="error" sx={{ mb: 2 }}>Failed to add medication. Please try again.</Alert>
      )}
      <Grid container spacing={2}>
        <Grid>
          <Controller
            name="drugLabel"
            control={control}
            rules={{ required: 'Drug name is required' }}
            render={({ field }) => (
              <Autocomplete
                freeSolo
                options={drugOptions}
                loading={drugLoading}
                onInputChange={(_, val) => { setDrugQuery(val); searchDrugs(val); }}
                onChange={(_, val) => {
                  if (val && typeof val !== 'string') {
                    field.onChange(val.label);
                  }
                }}
                renderInput={(params) => (
                  <TextField
                    {...params}
                    {...field}
                    label="Drug Name *"
                    error={!!errors.drugLabel}
                    helperText={errors.drugLabel?.message}
                    InputProps={{
                      ...params.InputProps,
                      endAdornment: (
                        <>
                          {drugLoading && <CircularProgress role="progressbar" aria-label="Loading" size={16} />}
                          {params.InputProps.endAdornment}
                        </>
                      ),
                    }}
                  />
                )}
              />
            )}
          />
        </Grid>

        <Grid>
          <Controller
            name="dose"
            control={control}
            rules={{ required: 'Dose is required' }}
            render={({ field }) => (
              <TextField
                {...field}
                label="Dose *"
                fullWidth
                error={!!errors.dose}
                helperText={errors.dose?.message}
              />
            )}
          />
        </Grid>

        <Grid>
          <Controller
            name="doseUnit"
            control={control}
            render={({ field }) => (
              <TextField {...field} label="Unit (mg, mL…)" fullWidth />
            )}
          />
        </Grid>

        <Grid>
          <Controller
            name="route"
            control={control}
            rules={{ required: true }}
            render={({ field }) => (
              <Autocomplete
                options={ROUTES}
                value={field.value ?? ''}
                onChange={(_, v) => field.onChange(v)}
                renderInput={(params) => <TextField {...params} label="Route *" />}
              />
            )}
          />
        </Grid>

        <Grid>
          <Controller
            name="frequency"
            control={control}
            rules={{ required: 'Frequency is required' }}
            render={({ field }) => (
              <Autocomplete
                freeSolo
                options={FREQUENCIES}
                value={field.value ?? ''}
                onInputChange={(_, v) => field.onChange(v)}
                onChange={(_, v) => field.onChange(v)}
                renderInput={(params) => (
                  <TextField
                    {...params}
                    label="Frequency *"
                    error={!!errors.frequency}
                    helperText={errors.frequency?.message}
                  />
                )}
              />
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
                InputLabelProps={{ shrink: true }}
              />
            )}
          />
        </Grid>

        <Grid>
          <Controller
            name="endDate"
            control={control}
            render={({ field }) => (
              <TextField
                {...field}
                label="End Date"
                type="date"
                fullWidth
                InputLabelProps={{ shrink: true }}
              />
            )}
          />
        </Grid>

        <Grid>
          <Controller
            name="instructions"
            control={control}
            render={({ field }) => (
              <TextField {...field} label="Special Instructions" fullWidth multiline rows={2} />
            )}
          />
        </Grid>

        <Grid size={12} sx={{ display: 'flex', gap: 2 }}>
          <Controller
            name="isRegular"
            control={control}
            render={({ field }) => (
              <FormControlLabel
                control={<Checkbox checked={field.value} onChange={(e) => field.onChange(e.target.checked)} />}
                label="Regular"
              />
            )}
          />
          <Controller
            name="isPrn"
            control={control}
            render={({ field }) => (
              <FormControlLabel
                control={<Checkbox checked={field.value} onChange={(e) => field.onChange(e.target.checked)} />}
                label="PRN"
              />
            )}
          />
        </Grid>

        <Grid size={12} sx={{ display: 'flex', justifyContent: 'flex-end', gap: 1 }}>
          <Button onClick={onSuccess}>Cancel</Button>
          <Button
            type="submit"
            variant="contained"
            disabled={createM.isPending}
            sx={{ bgcolor: '#327C8D' }}
          >
            {createM.isPending ? 'Saving…' : 'Add Medication'}
          </Button>
        </Grid>
      </Grid>
    </Box>
  );
}
