// apps/web/src/features/patients/components/registration/Step2Identifiers.tsx
import {
    Box,
    FormControl,
    Grid,
    InputLabel,
    MenuItem,
    Select,
    TextField,
    Typography
} from '@mui/material';
import { Controller, useFormContext } from 'react-hook-form';
import { DateDigitInput, DigitInput } from '../../../../shared/components/ui/DigitInput';
import type { RegistrationWizardData } from '../../types/patientTypes';

export const Step2Identifiers: React.FC = () => {
  const { control, register } = useFormContext<RegistrationWizardData>();

  return (
    <Box>
      <Typography variant="h6" fontWeight={600} fontFamily="Albert Sans, sans-serif" sx={{ mb: 3 }}>
        Identifiers
      </Typography>

      {/* Medicare */}
      <Typography variant="subtitle2" color="text.secondary" fontFamily="Albert Sans, sans-serif" sx={{ mb: 1.5 }}>
        Medicare
      </Typography>
      <Grid container spacing={2} sx={{ mb: 3 }}>
        <Grid size={{ xs: 12, sm: 5 }}>
          <Controller name="medicareNumber" control={control}
            rules={{ validate: (v: string | undefined) => {
              if (!v) return true;
              const digits = v.replace(/\D/g, '');
              if (digits.length !== 10 && digits.length !== 11) return 'Must be 10-11 digits';
              return true;
            }}}
            render={({ field, fieldState }) => (
              <DigitInput label="Medicare Number" value={field.value ?? ''} onChange={field.onChange}
                length={10} grouping={[4, 5, 1]} error={fieldState.error?.message} />
            )} />
        </Grid>
        <Grid size={{ xs: 4, sm: 2 }}>
          <Controller name="medicareReference" control={control}
            render={({ field }) => (
              <DigitInput label="IRN" value={field.value ?? ''} onChange={field.onChange} length={1} />
            )} />
        </Grid>
        <Grid size={{ xs: 8, sm: 3 }}>
          <Controller name="medicareExpiry" control={control}
            render={({ field }) => (
              <DateDigitInput label="Expiry (MM/YYYY)" value={field.value ?? ''} onChange={field.onChange} />
            )} />
        </Grid>
      </Grid>

      {/* DVA */}
      <Typography variant="subtitle2" color="text.secondary" fontFamily="Albert Sans, sans-serif" sx={{ mb: 1.5 }}>
        DVA (Department of Veterans&apos; Affairs)
      </Typography>
      <Grid container spacing={2} sx={{ mb: 3 }}>
        <Grid size={{ xs: 12, sm: 4 }}>
          <TextField {...register('dvaNumber')} label="DVA Number" fullWidth size="small" />
        </Grid>
        <Grid size={{ xs: 12, sm: 4 }}>
          <Controller
            name="dvaCardType"
            control={control}
            render={({ field }) => (
              <FormControl fullWidth size="small">
                <InputLabel>DVA Card Type</InputLabel>
                <Select {...field} label="DVA Card Type" sx={{ minWidth: 180 }}>
                  <MenuItem value="">None</MenuItem>
                  <MenuItem value="gold">Gold — All Conditions</MenuItem>
                  <MenuItem value="white">White — Specific Conditions</MenuItem>
                  <MenuItem value="orange">Orange — Pharmaceutical Only</MenuItem>
                </Select>
              </FormControl>
            )}
          />
        </Grid>
        <Grid size={{ xs: 12, sm: 4 }}>
          <TextField {...register('dvaExpiry')} label="DVA Expiry" type="date" fullWidth size="small" slotProps={{ inputLabel: { shrink: true } }} />
        </Grid>
      </Grid>

      {/* Healthcare Card */}
      <Typography variant="subtitle2" color="text.secondary" fontFamily="Albert Sans, sans-serif" sx={{ mb: 1.5 }}>
        Concession Cards
      </Typography>
      <Grid container spacing={2} sx={{ mb: 3 }}>
        <Grid size={{ xs: 12, sm: 4 }}>
          <TextField {...register('healthcareCardNumber')} label="Healthcare Card Number" fullWidth size="small" />
        </Grid>
        <Grid size={{ xs: 12, sm: 3 }}>
          <TextField {...register('healthcareCardExpiry')} label="Healthcare Card Expiry" type="date" fullWidth size="small" slotProps={{ inputLabel: { shrink: true } }} />
        </Grid>
        <Grid size={{ xs: 12, sm: 4 }}>
          <TextField {...register('pensionCardNumber')} label="Pension Card Number" fullWidth size="small" />
        </Grid>
        <Grid size={{ xs: 12, sm: 3 }}>
          <TextField {...register('pensionCardExpiry')} label="Pension Card Expiry" type="date" fullWidth size="small" slotProps={{ inputLabel: { shrink: true } }} />
        </Grid>
      </Grid>

      {/* Other Identifiers */}
      <Typography variant="subtitle2" color="text.secondary" fontFamily="Albert Sans, sans-serif" sx={{ mb: 1.5 }}>
        Other Identifiers
      </Typography>
      <Grid container spacing={2}>
        <Grid size={{ xs: 12, sm: 6 }}>
          <TextField {...register('ihiNumber')} label="IHI Number" fullWidth size="small" placeholder="Individual Healthcare Identifier" />
        </Grid>
        <Grid size={{ xs: 12, sm: 6 }}>
          <TextField {...register('mrn')} label="MRN (Override)" fullWidth size="small" helperText="Leave blank to auto-generate" />
        </Grid>
      </Grid>
    </Box>
  );
};
