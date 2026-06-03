import { useState } from 'react';
import {
  Alert,
  Box,
  Button,
  FormControlLabel,
  Grid,
  MenuItem,
  Switch,
  TextField,
  Typography,
} from '@mui/material';
import { ElectricBolt } from '@mui/icons-material';
import { useForm, Controller } from 'react-hook-form';
import { useCreatePrescription } from '../hooks/usePrescriptions';
import SafeScriptPanel from './SafeScriptPanel';
import { getErxAwareErrorMessage } from '../services/erxErrorMessage';
import type { PrescriptionCreateDTO, PrescriptionResponse } from '@signacare/shared';

interface Props {
  patientId: string;
  episodeId?: string;
  onSuccess: () => void;
}

export default function PrescriptionForm({ patientId, episodeId, onSuccess }: Props) {
  const createP = useCreatePrescription(patientId);
  const [created, setCreated] = useState<PrescriptionResponse | null>(null);

  const { control, handleSubmit, watch, formState: { errors } } = useForm<PrescriptionCreateDTO>({
    defaultValues: {
      patientId,
      episodeId,
      isAuthority: false,
      isS8: false,
      isElectronic: true,
      repeats: 0,
      prescriptionType: 'standard',
      prescriptionCategory: 'outpatient',
      prescribedDate: new Date().toISOString().slice(0, 10),
    },
  });

  const isS8 = watch('isS8');
  const isElectronic = watch('isElectronic');
  const createErrorMessage = getErxAwareErrorMessage(
    createP.error,
    'Failed to create prescription.',
  );

  const onSubmit = (data: PrescriptionCreateDTO) => {
    createP.mutate(data, {
      onSuccess: (rx) => {
        setCreated(rx);
      },
    });
  };

  if (created) {
    return (
      <Box>
        <Alert severity="success" sx={{ mb: 2 }}>
          Prescription created (ID: {created.id.slice(0, 8)}…)
        </Alert>
        {isS8 && <SafeScriptPanel prescription={created} />}
        {isElectronic && (
          <Alert
            severity={created.erxToken ? 'success' : 'info'}
            icon={<ElectricBolt />}
            sx={{ mb: 2 }}
          >
            {created.erxToken
              ? `eScript token issued: ${created.erxToken}`
              : 'eScript submission pending — integration not yet active. Use paper prescription.'}
          </Alert>
        )}
        <Button variant="contained" sx={{ bgcolor: '#327C8D' }} onClick={onSuccess}>
          Done
        </Button>
      </Box>
    );
  }

  return (
    <Box component="form" onSubmit={handleSubmit(onSubmit)} sx={{ pt: 1 }}>
      {createP.isError && (
        <Alert role="alert" severity="error" sx={{ mb: 2 }}>{createErrorMessage}</Alert>
      )}
      {isS8 && (
        <Alert role="alert" severity="warning" icon={false} sx={{ mb: 2, bgcolor: '#FFF8F0', border: '1px solid #F0852C' }}>
          <Typography variant="body2" color="#F0852C" fontWeight={600}>
            Schedule 8 medication — SafeScript check required before dispensing.
          </Typography>
        </Alert>
      )}
      <Grid container spacing={2}>
        <Grid>
          <Controller
            name="genericName"
            control={control}
            rules={{ required: 'Generic name required' }}
            render={({ field }) => (
              <TextField
                {...field}
                label="Generic Name *"
                fullWidth
                error={!!errors.genericName}
                helperText={errors.genericName?.message}
              />
            )}
          />
        </Grid>
        <Grid>
          <Controller
            name="brandName"
            control={control}
            render={({ field }) => <TextField {...field} label="Brand Name" fullWidth />}
          />
        </Grid>
        <Grid>
          <Controller
            name="dose"
            control={control}
            rules={{ required: 'Dose required' }}
            render={({ field }) => (
              <TextField {...field} label="Dose *" fullWidth error={!!errors.dose} helperText={errors.dose?.message} />
            )}
          />
        </Grid>
        <Grid>
          <Controller
            name="route"
            control={control}
            rules={{ required: true }}
            render={({ field }) => <TextField {...field} label="Route *" fullWidth />}
          />
        </Grid>
        <Grid>
          <Controller
            name="frequency"
            control={control}
            rules={{ required: true }}
            render={({ field }) => <TextField {...field} label="Frequency *" fullWidth />}
          />
        </Grid>
        <Grid>
          <Controller
            name="quantity"
            control={control}
            rules={{ required: true, min: 1 }}
            render={({ field }) => (
              <TextField
                {...field}
                label="Quantity *"
                type="number"
                fullWidth
                onChange={(e) => field.onChange(Number(e.target.value))}
              />
            )}
          />
        </Grid>
        <Grid>
          <Controller
            name="repeats"
            control={control}
            render={({ field }) => (
              <TextField
                {...field}
                label="Repeats"
                type="number"
                fullWidth
                onChange={(e) => field.onChange(Number(e.target.value))}
              />
            )}
          />
        </Grid>
        <Grid>
          <Controller
            name="prescribedDate"
            control={control}
            render={({ field }) => (
              <TextField {...field} label="Prescribed Date" type="date" fullWidth InputLabelProps={{ shrink: true }} />
            )}
          />
        </Grid>
        <Grid>
          <Controller
            name="pbsItemCode"
            control={control}
            render={({ field }) => <TextField {...field} label="PBS Item Code" fullWidth />}
          />
        </Grid>
        <Grid>
          <Controller
            name="authorityCode"
            control={control}
            render={({ field }) => <TextField {...field} label="Authority Code" fullWidth />}
          />
        </Grid>
        <Grid>
          <Controller
            name="prescriptionCategory"
            control={control}
            render={({ field }) => (
              <TextField
                {...field}
                select
                label="Prescription Setting"
                fullWidth
              >
                <MenuItem value="outpatient">Outpatient</MenuItem>
                <MenuItem value="inpatient">Inpatient (Hospital)</MenuItem>
                <MenuItem value="discharge">Discharge</MenuItem>
              </TextField>
            )}
          />
        </Grid>
        <Grid>
          <Controller
            name="directions"
            control={control}
            render={({ field }) => (
              <TextField {...field} label="Patient Directions" fullWidth multiline rows={2} />
            )}
          />
        </Grid>
        <Grid size={12} sx={{ display: 'flex', gap: 2, flexWrap: 'wrap' }}>
          <Controller
            name="isS8"
            control={control}
            render={({ field }) => (
              <FormControlLabel
                control={<Switch checked={field.value} onChange={(e) => field.onChange(e.target.checked)} />}
                label={<Typography variant="body2" color={isS8 ? '#F0852C' : undefined}>Schedule 8</Typography>}
              />
            )}
          />
          <Controller
            name="isAuthority"
            control={control}
            render={({ field }) => (
              <FormControlLabel
                control={<Switch checked={field.value} onChange={(e) => field.onChange(e.target.checked)} />}
                label="Authority Required"
              />
            )}
          />
          <Controller
            name="isElectronic"
            control={control}
            render={({ field }) => (
              <FormControlLabel
                control={<Switch checked={field.value} onChange={(e) => field.onChange(e.target.checked)} />}
                label={
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                    <ElectricBolt fontSize="small" sx={{ color: '#327C8D' }} />
                    <Typography variant="body2">Electronic (eScript)</Typography>
                  </Box>
                }
              />
            )}
          />
        </Grid>
        <Grid size={12} sx={{ display: 'flex', justifyContent: 'flex-end', gap: 1 }}>
          <Button onClick={onSuccess}>Cancel</Button>
          <Button
            type="submit"
            variant="contained"
            disabled={createP.isPending}
            sx={{ bgcolor: '#327C8D' }}
          >
            {createP.isPending ? 'Creating…' : 'Create Prescription'}
          </Button>
        </Grid>
      </Grid>
    </Box>
  );
}
